// Ported from openDAW packages/studio/core @10088021 (AGPL-3.0-or-later, © André Michelle)
/**
 * .agents/scripts/scdaw-engine.js
 *
 * Real-time Web Audio API transport, lookahead scheduler, graph manager,
 * and offline WAV rendering engine.
 * Exposes the global singleton `globalThis.__scdaw`.
 */

import { State } from "./scdaw-signals.js";
import {
  PPQN,
  createProject,
  validateProject,
  applyCommand,
  computeEventsInRange,
  resolveTrackNotes,
  pulsesToSeconds,
  secondsToPulses,
  encodeWav,
  decodeWavHeader,
  peakAndRms,
  audibleLength,
  serializeProject,
  deserializeProject,
  createHistory,
} from "./scdaw.js";
import { encodeZip } from "./scdaw-zip.js";
import { encodeMidiFile, midiToProject } from "./scdaw-midi.js";
import { encodeDawProject, decodeDawProject } from "./scdaw-dawproject.js";
import { triggerInstrumentVoice } from "./scdaw-instruments.js";
import {
  writeConversationFile,
  readConversationFile,
  listConversations,
  listConversationFiles,
  DEFAULT_GROUP_ID,
} from "./scdaw-fs.js";

export class DawEngine extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = options;
    this.history = createHistory(50);

    const initialProject =
      this._restoreSavedProject() || createProject("basic-beat");
    const initialTrackId = initialProject.tracks[0]?.id || null;

    this.project = new State(initialProject);
    this.selectedTrackId = new State(initialTrackId);
    this.state = new State({
      audio: "locked",
      isLeader: false,
      playing: false,
      positionPpqn: 0,
      bar: 1,
      beat: 1,
      step: 0,
      bpm: initialProject.bpm,
      trackCount: initialProject.tracks.length,
      selectedTrackId: initialTrackId,
      lastBounce: null,
      lastError: null,
    });

    this.ctx = null;
    this.graph = null;
    this._worker = null;
    this._intervalId = null;
    this._lastSchedulePpqn = 0;
    this._lastScheduleAudioTime = 0;
    this._activeVoices = new Set();

    this._initAudioContext();
    this._initSchedulerClock();
    this._updateGraph();
  }

  _restoreSavedProject() {
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem("scdaw:project");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (validateProject(parsed).valid) {
            return parsed;
          }
        }
      }
    } catch (_) {}
    return null;
  }

  _persistProject(p) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("scdaw:project", JSON.stringify(p));
      }
    } catch (_) {}
  }

  _initAudioContext() {
    if (this.options.audioContext) {
      this.ctx = this.options.audioContext;
      this._updateAudioState();
      return;
    }
    const AudioCtx =
      typeof window !== "undefined"
        ? window.AudioContext || window.webkitAudioContext
        : null;

    if (AudioCtx) {
      try {
        this.ctx = new AudioCtx();
        this._updateAudioState();
        this.ctx.addEventListener?.("statechange", () =>
          this._updateAudioState(),
        );
      } catch (err) {
        this._updateState({ audio: "unsupported", lastError: err.message });
      }
    } else {
      this._updateState({ audio: "unsupported" });
    }
  }

  _updateAudioState() {
    if (!this.ctx) {
      this._updateState({ audio: "unsupported" });
      return;
    }
    const s = this.ctx.state;
    const mapped =
      s === "running" ? "running" : s === "suspended" ? "locked" : s;
    this._updateState({ audio: mapped });
  }

  _initSchedulerClock() {
    if (
      typeof Worker !== "undefined" &&
      typeof Blob !== "undefined" &&
      typeof URL !== "undefined"
    ) {
      try {
        const code = `
          let timer = null;
          self.onmessage = (e) => {
            if (e.data === "start") {
              if (!timer) timer = setInterval(() => self.postMessage("tick"), 25);
            } else if (e.data === "stop") {
              if (timer) { clearInterval(timer); timer = null; }
            }
          };
        `;
        const blob = new Blob([code], { type: "application/javascript" });
        this._worker = new Worker(URL.createObjectURL(blob));
        this._worker.onmessage = () => this._onClockTick();
        return;
      } catch (_) {}
    }
    // Fallback: standard setInterval
  }

  _updateGraph() {
    if (!this.ctx) return;
    const p = this.project.get();

    if (!this.graph) {
      const masterGain = this.ctx.createGain();
      masterGain.gain.setValueAtTime(
        p.master.volume ?? 0.8,
        this.ctx.currentTime,
      );

      const masterCompressor = this.ctx.createDynamicsCompressor();
      masterCompressor.threshold.setValueAtTime(-3, this.ctx.currentTime);
      masterCompressor.ratio.setValueAtTime(12, this.ctx.currentTime);

      const masterAnalyser = this.ctx.createAnalyser();
      masterAnalyser.fftSize = 1024;

      masterGain.connect(masterCompressor);
      masterCompressor.connect(masterAnalyser);
      masterAnalyser.connect(this.ctx.destination);

      this.graph = {
        masterGain,
        masterCompressor,
        masterAnalyser,
        tracks: new Map(),
      };
    } else {
      this.graph.masterGain.gain.setValueAtTime(
        p.master.volume ?? 0.8,
        this.ctx.currentTime,
      );
    }

    // Synchronize track nodes
    const activeIds = new Set(p.tracks.map((t) => t.id));
    for (const [id, nodes] of this.graph.tracks) {
      if (!activeIds.has(id)) {
        nodes.gain.disconnect();
        this.graph.tracks.delete(id);
      }
    }

    const hasSolo = p.tracks.some((t) => t.solo);
    for (const track of p.tracks) {
      let nodes = this.graph.tracks.get(track.id);
      if (!nodes) {
        const gain = this.ctx.createGain();
        const panner =
          typeof this.ctx.createStereoPanner === "function"
            ? this.ctx.createStereoPanner()
            : null;
        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 512;

        if (panner) {
          gain.connect(panner);
          panner.connect(analyser);
        } else {
          gain.connect(analyser);
        }
        analyser.connect(this.graph.masterGain);

        nodes = { gain, panner, analyser };
        this.graph.tracks.set(track.id, nodes);
      }

      // Update volume & pan
      const effectiveVol =
        track.mute || (hasSolo && !track.solo) ? 0 : track.volume;
      nodes.gain.gain.setValueAtTime(effectiveVol, this.ctx.currentTime);
      if (nodes.panner && nodes.panner.pan) {
        nodes.panner.pan.setValueAtTime(track.pan || 0, this.ctx.currentTime);
      }
    }
  }

  _updateState(patch) {
    const current = this.state.get();
    this.state.set({ ...current, ...patch });
  }

  getState() {
    return structuredClone(this.state.get());
  }

  getProject() {
    return structuredClone(this.project.get());
  }

  selectTrack(trackId) {
    if (!trackId) return this.selectedTrackId.get();
    const p = this.project.get();
    const exists = p.tracks.some((t) => t.id === trackId);
    if (!exists) return this.selectedTrackId.get();
    this.selectedTrackId.set(trackId);
    this._updateState({ selectedTrackId: trackId });
    return trackId;
  }

  _ensureValidSelectedTrack(p) {
    if (!p || !Array.isArray(p.tracks)) return;
    const current = this.selectedTrackId.get();
    if (!current || !p.tracks.some((t) => t.id === current)) {
      const nextId = p.tracks[0]?.id || null;
      this.selectedTrackId.set(nextId);
      this._updateState({ selectedTrackId: nextId });
    }
  }

  async unlockAudio() {
    if (this.ctx && typeof this.ctx.resume === "function") {
      await this.ctx.resume();
      this._updateAudioState();
      return this.state.get().audio;
    }
    return "unsupported";
  }

  async play() {
    if (this.ctx && this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch (_) {}
    }
    this._updateAudioState();

    this._lastScheduleAudioTime = this.ctx
      ? this.ctx.currentTime
      : Date.now() / 1000;
    this._updateState({ playing: true });

    if (this._worker) {
      this._worker.postMessage("start");
    } else if (!this._intervalId) {
      this._intervalId = setInterval(() => this._onClockTick(), 25);
    }
  }

  async stop() {
    this._updateState({
      playing: false,
      positionPpqn: 0,
      bar: 1,
      beat: 1,
      step: 0,
    });
    this._lastSchedulePpqn = 0;

    if (this._worker) {
      this._worker.postMessage("stop");
    }
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  panic() {
    this.stop();
    for (const voice of this._activeVoices) {
      try {
        if (typeof voice.stop === "function") voice.stop(0);
        if (typeof voice.disconnect === "function") voice.disconnect();
      } catch (_) {}
    }
    this._activeVoices.clear();
  }

  _onClockTick() {
    const s = this.state.get();
    if (!s.playing) return;

    const p = this.project.get();
    const bpm = p.bpm || 120;
    const totalPulses = (p.lengthBars || 1) * PPQN.Bar;

    const nowAudio = this.ctx ? this.ctx.currentTime : Date.now() / 1000;
    const deltaSec = Math.max(0.001, nowAudio - this._lastScheduleAudioTime);
    this._lastScheduleAudioTime = nowAudio;

    const deltaPulses = secondsToPulses(deltaSec, bpm);
    let fromPpqn = this._lastSchedulePpqn;
    let toPpqn = fromPpqn + deltaPulses;

    // Schedule audio voices in lookahead window (100ms)
    const lookaheadPulses = secondsToPulses(0.1, bpm);
    const events = computeEventsInRange(
      p,
      fromPpqn,
      (fromPpqn + lookaheadPulses) % totalPulses,
    );

    if (this.ctx && this.graph) {
      for (const ev of events) {
        const nodes = this.graph.tracks.get(ev.trackId);
        if (nodes) {
          const deltaEvPulses =
            (ev.position - fromPpqn + totalPulses) % totalPulses;
          const evTime = Math.max(
            nowAudio,
            nowAudio + pulsesToSeconds(deltaEvPulses, bpm),
          );
          const voice = triggerInstrumentVoice(
            this.ctx,
            nodes.gain,
            ev,
            evTime,
            bpm,
          );
          if (voice) {
            this._activeVoices.add(voice);
            if (voice.onended !== undefined) {
              const origEnded = voice.onended;
              voice.onended = () => {
                this._activeVoices.delete(voice);
                if (typeof origEnded === "function") origEnded();
              };
            }
          }
        }
      }
    }

    const nextPos = toPpqn % totalPulses;
    this._lastSchedulePpqn = nextPos;

    const bar = Math.floor(nextPos / PPQN.Bar) + 1;
    const beat = Math.floor((nextPos % PPQN.Bar) / PPQN.Quarter) + 1;
    const step = Math.floor(nextPos / PPQN.SemiQuaver);

    this._updateState({
      positionPpqn: nextPos,
      bar,
      beat,
      step,
    });
  }

  getLevels() {
    if (!this.graph) {
      return {
        master: { peakDb: -100, rmsDb: -100, clipping: false },
        tracks: {},
      };
    }

    const buf = new Float32Array(512);
    this.graph.masterAnalyser.getFloatTimeDomainData(buf);
    const master = peakAndRms(buf);

    const tracks = {};
    for (const [id, nodes] of this.graph.tracks) {
      const tBuf = new Float32Array(256);
      nodes.analyser.getFloatTimeDomainData(tBuf);
      tracks[id] = peakAndRms(tBuf);
    }

    return { master, tracks };
  }

  async bounce(options = {}) {
    const {
      loops = 1,
      bitDepth = 24,
      sampleRate = 44100,
      tailSeconds = 0.5,
      trimSilence = true,
      saveToWorkspace = true,
      saveToOpfs = true,
      conversationId = DEFAULT_GROUP_ID,
      filename = null,
    } = options;
    const p = this.project.get();
    const bpm = p.bpm || 120;
    const totalPulses = (p.lengthBars || 1) * PPQN.Bar;
    const bouncePulses = loops * totalPulses;
    const durationSec = pulsesToSeconds(bouncePulses, bpm);
    const totalFrames = Math.ceil((durationSec + tailSeconds) * sampleRate);

    const OfflineCtxClass =
      this.options.offlineAudioContextClass ||
      (typeof window !== "undefined"
        ? window.OfflineAudioContext || window.webkitOfflineAudioContext
        : null);

    if (!OfflineCtxClass) {
      throw new Error(
        "OfflineAudioContext is not supported in this environment",
      );
    }

    const offlineCtx = new OfflineCtxClass(2, totalFrames, sampleRate);

    // Build offline graph
    const masterGain = offlineCtx.createGain();
    masterGain.gain.setValueAtTime(p.master.volume ?? 0.8, 0);

    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-3, 0);
    compressor.ratio.setValueAtTime(12, 0);

    masterGain.connect(compressor);
    compressor.connect(offlineCtx.destination);

    const trackGains = new Map();
    const hasSolo = p.tracks.some((t) => t.solo);
    for (const track of p.tracks) {
      const effectiveVol =
        track.mute || (hasSolo && !track.solo) ? 0 : track.volume;
      const gain = offlineCtx.createGain();
      gain.gain.setValueAtTime(effectiveVol, 0);

      const panner =
        typeof offlineCtx.createStereoPanner === "function"
          ? offlineCtx.createStereoPanner()
          : null;

      if (panner) {
        gain.connect(panner);
        panner.pan.setValueAtTime(track.pan || 0, 0);
        panner.connect(masterGain);
      } else {
        gain.connect(masterGain);
      }
      trackGains.set(track.id, gain);
    }

    // Schedule voices using resolved notes (honoring MIDI FX and swing)
    for (const track of p.tracks) {
      if (track.mute || (hasSolo && !track.solo)) continue;
      const gainNode = trackGains.get(track.id);
      const resolvedNotes = resolveTrackNotes(p, track, {
        loops,
        bakeMidiFx: true,
        bakeSwing: true,
      });

      for (const note of resolvedNotes) {
        const when = pulsesToSeconds(note.position, bpm);
        triggerInstrumentVoice(
          offlineCtx,
          gainNode,
          {
            trackKind: track.kind || track.type,
            trackParams: track.params,
            trackVolume: track.volume,
            trackPan: track.pan,
            note,
          },
          when,
          bpm,
        );
      }
    }

    const renderedBuffer = await offlineCtx.startRendering();
    let left = renderedBuffer.getChannelData(0);
    let right =
      renderedBuffer.numberOfChannels > 1
        ? renderedBuffer.getChannelData(1)
        : left;

    if (trimSilence) {
      const minFrames = Math.ceil(durationSec * sampleRate);
      const actualFrames = audibleLength(
        [left, right],
        minFrames,
        renderedBuffer.length,
      );
      if (actualFrames < renderedBuffer.length) {
        left = left.subarray(0, actualFrames);
        right = right.subarray(0, actualFrames);
      }
    }

    const stats = peakAndRms(left);
    const wavBuffer = encodeWav([left, right], sampleRate, { bitDepth });
    const resolvedFilename = filename || `${p.name || "daw"}-bounce.wav`;

    if (saveToOpfs) {
      try {
        await writeConversationFile(
          conversationId,
          resolvedFilename,
          wavBuffer,
        );
      } catch (err) {
        console.warn("Failed to write bounce to conversation files:", err);
        throw err;
      }
    }

    if (
      saveToWorkspace &&
      typeof document !== "undefined" &&
      typeof Blob !== "undefined" &&
      typeof URL !== "undefined"
    ) {
      try {
        const blob = new Blob([wavBuffer], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = resolvedFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (_) {}
    }

    const bounceMeta = {
      bytes: wavBuffer.byteLength,
      durationSec: left.length / sampleRate,
      peakDb: stats.peakDb,
      rmsDb: stats.rmsDb,
      channels: 2,
      sampleRate,
      bitDepth,
      loops,
      name: p.name,
      wavBuffer,
      timestamp: new Date().toISOString(),
    };

    this._updateState({ lastBounce: bounceMeta });
    return bounceMeta;
  }

  async bounceStems(options = {}) {
    const {
      loops = 1,
      tap = "post-fader", // "post-fader" | "pre-fader" | "pre-fx"
      bitDepth = 24,
      sampleRate = 44100,
      tailSeconds = 1.0,
      trimSilence = true,
      bundleZip = true,
      includeMaster = true,
      includeMidi = true,
      includeProject = true,
      saveToWorkspace = true,
      saveToOpfs = true,
      conversationId = DEFAULT_GROUP_ID,
      filename = null,
    } = options;
    const p = this.project.get();
    const bpm = p.bpm || 120;
    const totalPulses = (p.lengthBars || 1) * PPQN.Bar;
    const bouncePulses = loops * totalPulses;
    const durationSec = pulsesToSeconds(bouncePulses, bpm);
    const totalFrames = Math.ceil((durationSec + tailSeconds) * sampleRate);
    const minFrames = Math.ceil(durationSec * sampleRate);

    const OfflineCtxClass =
      this.options.offlineAudioContextClass ||
      (typeof window !== "undefined"
        ? window.OfflineAudioContext || window.webkitOfflineAudioContext
        : null);

    if (!OfflineCtxClass) {
      throw new Error(
        "OfflineAudioContext is not supported in this environment",
      );
    }

    const stems = [];

    // 1. Render Master stem if requested
    if (includeMaster) {
      const masterCtx = new OfflineCtxClass(2, totalFrames, sampleRate);
      const masterGain = masterCtx.createGain();
      masterGain.gain.setValueAtTime(p.master.volume ?? 0.8, 0);

      const compressor = masterCtx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-3, 0);
      compressor.ratio.setValueAtTime(12, 0);

      masterGain.connect(compressor);
      compressor.connect(masterCtx.destination);

      for (const track of p.tracks) {
        if (track.mute) continue;
        const gain = masterCtx.createGain();
        const effectiveVol = tap === "pre-fader" ? 1.0 : (track.volume ?? 0.8);
        gain.gain.setValueAtTime(effectiveVol, 0);

        const panner =
          typeof masterCtx.createStereoPanner === "function"
            ? masterCtx.createStereoPanner()
            : null;

        if (panner && tap !== "pre-fader") {
          gain.connect(panner);
          panner.pan.setValueAtTime(track.pan || 0, 0);
          panner.connect(masterGain);
        } else {
          gain.connect(masterGain);
        }

        const resolvedNotes = resolveTrackNotes(p, track, {
          loops,
          bakeMidiFx: tap !== "pre-fx",
          bakeSwing: true,
        });

        for (const note of resolvedNotes) {
          const when = pulsesToSeconds(note.position, bpm);
          triggerInstrumentVoice(
            masterCtx,
            gain,
            {
              trackKind: track.kind || track.type,
              trackParams: track.params,
              trackVolume: tap === "pre-fader" ? 1.0 : track.volume,
              trackPan: tap === "pre-fader" ? 0 : track.pan,
              note,
            },
            when,
            bpm,
          );
        }
      }

      const renderedMaster = await masterCtx.startRendering();
      let left = renderedMaster.getChannelData(0);
      let right =
        renderedMaster.numberOfChannels > 1
          ? renderedMaster.getChannelData(1)
          : left;

      if (trimSilence) {
        const actualFrames = audibleLength(
          [left, right],
          minFrames,
          renderedMaster.length,
        );
        if (actualFrames < renderedMaster.length) {
          left = left.subarray(0, actualFrames);
          right = right.subarray(0, actualFrames);
        }
      }

      const stats = peakAndRms(left);
      const wavBuffer = encodeWav([left, right], sampleRate, { bitDepth });

      stems.push({
        name: "00_Master.wav",
        trackId: "master",
        trackName: "Master",
        bytes: wavBuffer.byteLength,
        durationSec: left.length / sampleRate,
        peakDb: stats.peakDb,
        rmsDb: stats.rmsDb,
        bitDepth,
        wavBuffer,
      });
    }

    // 2. Render individual track stems
    for (let i = 0; i < p.tracks.length; i++) {
      const track = p.tracks[i];
      const trackCtx = new OfflineCtxClass(2, totalFrames, sampleRate);
      const gain = trackCtx.createGain();
      const effectiveVol = tap === "pre-fader" ? 1.0 : (track.volume ?? 0.8);
      gain.gain.setValueAtTime(effectiveVol, 0);

      const panner =
        typeof trackCtx.createStereoPanner === "function"
          ? trackCtx.createStereoPanner()
          : null;

      if (panner && tap !== "pre-fader") {
        gain.connect(panner);
        panner.pan.setValueAtTime(track.pan || 0, 0);
        panner.connect(trackCtx.destination);
      } else {
        gain.connect(trackCtx.destination);
      }

      const resolvedNotes = resolveTrackNotes(p, track, {
        loops,
        bakeMidiFx: tap !== "pre-fx",
        bakeSwing: true,
      });

      for (const note of resolvedNotes) {
        const when = pulsesToSeconds(note.position, bpm);
        triggerInstrumentVoice(
          trackCtx,
          gain,
          {
            trackKind: track.kind || track.type,
            trackParams: track.params,
            trackVolume: tap === "pre-fader" ? 1.0 : track.volume,
            trackPan: tap === "pre-fader" ? 0 : track.pan,
            note,
          },
          when,
          bpm,
        );
      }

      const renderedTrack = await trackCtx.startRendering();
      let left = renderedTrack.getChannelData(0);
      let right =
        renderedTrack.numberOfChannels > 1
          ? renderedTrack.getChannelData(1)
          : left;

      if (trimSilence) {
        const actualFrames = audibleLength(
          [left, right],
          minFrames,
          renderedTrack.length,
        );
        if (actualFrames < renderedTrack.length) {
          left = left.subarray(0, actualFrames);
          right = right.subarray(0, actualFrames);
        }
      }

      const stats = peakAndRms(left);
      const wavBuffer = encodeWav([left, right], sampleRate, { bitDepth });
      const safeName = (track.name || `Track_${i + 1}`).replace(
        /[^a-zA-Z0-9_-]/g,
        "_",
      );
      const filename = `${String(i + 1).padStart(2, "0")}_${safeName}.wav`;

      stems.push({
        name: filename,
        trackId: track.id,
        trackName: track.name,
        bytes: wavBuffer.byteLength,
        durationSec: left.length / sampleRate,
        peakDb: stats.peakDb,
        rmsDb: stats.rmsDb,
        bitDepth,
        wavBuffer,
      });
    }

    let zipBuffer = null;
    const baseProjectName = (p.name || "daw").replace(/[^a-zA-Z0-9_-]/g, "_");
    const zipName = `${baseProjectName}-stems.zip`;

    if (bundleZip) {
      const zipFiles = [];
      for (const stem of stems) {
        zipFiles.push({ name: stem.name, data: stem.wavBuffer });
      }

      if (includeMidi) {
        const midiBytes = encodeMidiFile(p, {
          loops,
          bakeMidiFx: true,
          bakeSwing: true,
        });
        zipFiles.push({ name: `${baseProjectName}.mid`, data: midiBytes });
      }

      if (includeProject) {
        const jsonStr = serializeProject(p);
        zipFiles.push({
          name: `${baseProjectName}.scdaw.json`,
          data: new TextEncoder().encode(jsonStr),
        });
      }

      zipBuffer = encodeZip(zipFiles);
      const resolvedZipName = filename || zipName;

      if (saveToOpfs && zipBuffer) {
        try {
          await writeConversationFile(
            conversationId,
            resolvedZipName,
            zipBuffer,
          );
        } catch (err) {
          console.warn("Failed to write stems to conversation files:", err);
          throw err;
        }
      }

      if (
        saveToWorkspace &&
        typeof document !== "undefined" &&
        typeof Blob !== "undefined" &&
        typeof URL !== "undefined"
      ) {
        try {
          const blob = new Blob([zipBuffer], { type: "application/zip" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = resolvedZipName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (_) {}
      }
    }

    return {
      stems,
      zipBuffer,
      zipBytes: zipBuffer ? zipBuffer.byteLength : null,
      zipName,
      durationSec,
      sampleRate,
      bitDepth,
      tap,
    };
  }

  exportMidi(options = {}) {
    const p = this.project.get();
    const midiBytes = encodeMidiFile(p, options);
    const baseName = (p.name || "daw").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = options.filename || `${baseName}.mid`;
    const conversationId = options.conversationId || DEFAULT_GROUP_ID;

    if (options.saveToOpfs !== false) {
      try {
        writeConversationFile(conversationId, filename, midiBytes);
      } catch (err) {
        console.warn("Failed to write MIDI to conversation files:", err);
      }
    }

    if (
      options.saveToWorkspace !== false &&
      typeof document !== "undefined" &&
      typeof Blob !== "undefined" &&
      typeof URL !== "undefined"
    ) {
      try {
        const blob = new Blob([midiBytes], { type: "audio/midi" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (_) {}
    }

    return {
      name: filename,
      bytes: midiBytes.byteLength,
      buffer: midiBytes,
      conversationId,
    };
  }

  importMidi(input, options = {}) {
    const imported = midiToProject(input, options);
    if (options.targetTrackId) {
      // Find track notes and update only target track
      const sourceNotes = imported.tracks[0]?.notes || [];
      return this.sendCommand("set_notes", {
        trackId: options.targetTrackId,
        notes: sourceNotes,
      });
    }

    this.history.push(this.project.get());
    this.project.set(imported);
    this._ensureValidSelectedTrack(imported);
    this._updateGraph();
    this._persistProject(imported);
    this._updateState({
      trackCount: imported.tracks.length,
      bpm: imported.bpm,
    });
    return { ok: true, project: imported };
  }

  exportProject(options = {}) {
    const p = this.project.get();
    const baseName = (p.name || "daw").replace(/[^a-zA-Z0-9_-]/g, "_");
    const conversationId = options.conversationId || DEFAULT_GROUP_ID;

    if (options.format === "dawproject") {
      const zipBuffer = encodeDawProject(p, options);
      const filename = options.filename || `${baseName}.dawproject`;

      if (options.saveToOpfs !== false) {
        try {
          writeConversationFile(conversationId, filename, zipBuffer);
        } catch (_) {}
      }

      if (
        options.saveToWorkspace !== false &&
        typeof document !== "undefined" &&
        typeof Blob !== "undefined" &&
        typeof URL !== "undefined"
      ) {
        try {
          const blob = new Blob([zipBuffer], { type: "application/zip" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (_) {}
      }

      return {
        name: filename,
        buffer: zipBuffer,
        bytes: zipBuffer.byteLength,
        format: "dawproject",
        conversationId,
      };
    }

    const jsonStr = serializeProject(p);
    const filename = options.filename || `${baseName}.scdaw.json`;

    if (options.saveToOpfs !== false) {
      try {
        writeConversationFile(conversationId, filename, jsonStr);
      } catch (_) {}
    }

    if (
      options.saveToWorkspace !== false &&
      typeof document !== "undefined" &&
      typeof Blob !== "undefined" &&
      typeof URL !== "undefined"
    ) {
      try {
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (_) {}
    }

    return {
      name: filename,
      content: jsonStr,
      bytes: new TextEncoder().encode(jsonStr).byteLength,
      format: "json",
      conversationId,
    };
  }

  async saveProject(options = {}) {
    const p = this.project.get();
    const baseName = (p.name || "daw").replace(/[^a-zA-Z0-9_-]/g, "_");
    const conversationId = options.conversationId || DEFAULT_GROUP_ID;
    const format = options.format || "json";
    const saveToOpfs = options.saveToOpfs !== false;
    let filename = options.filename;
    let data;
    let bytes = 0;

    if (format === "dawproject") {
      filename = filename || `${baseName}.dawproject`;
      data = encodeDawProject(p, options);
      bytes = data.byteLength;
    } else {
      filename = filename || `${baseName}.scdaw.json`;
      data = serializeProject(p);
      bytes = new TextEncoder().encode(data).byteLength;
    }

    let fsResult = null;
    if (saveToOpfs) {
      fsResult = await writeConversationFile(conversationId, filename, data);
    }

    if (
      options.download &&
      typeof document !== "undefined" &&
      typeof Blob !== "undefined" &&
      typeof URL !== "undefined"
    ) {
      try {
        const mime =
          format === "dawproject" ? "application/zip" : "application/json";
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } catch (_) {}
    }

    return {
      ok: true,
      name: filename,
      conversationId,
      bytes,
      format,
      fsResult,
    };
  }

  async loadProjectFromFs(options = {}) {
    const conversationId = options.conversationId || DEFAULT_GROUP_ID;
    const filename = options.filename;
    if (!filename) {
      throw new Error("loadProjectFromFs requires a filename");
    }

    const fileData = await readConversationFile(conversationId, filename);
    const lowerName = filename.toLowerCase();

    if (lowerName.endsWith(".mid") || lowerName.endsWith(".midi")) {
      return this.importMidi(fileData.buffer, options);
    }

    return await this.importProjectFile(
      fileData.buffer || fileData.text,
      options,
    );
  }

  async listConversations() {
    return await listConversations();
  }

  async listConversationFiles(conversationId = DEFAULT_GROUP_ID) {
    return await listConversationFiles(conversationId);
  }

  async importProjectFile(contentOrBuffer, options = {}) {
    let imported;

    if (
      contentOrBuffer instanceof Uint8Array ||
      contentOrBuffer instanceof ArrayBuffer
    ) {
      const u8 =
        contentOrBuffer instanceof Uint8Array
          ? contentOrBuffer
          : new Uint8Array(contentOrBuffer);
      // Check for ZIP magic 'PK' (0x50, 0x4B)
      if (u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b) {
        imported = await decodeDawProject(contentOrBuffer, options);
      } else if (
        u8.length >= 4 &&
        u8[0] === 0x4d &&
        u8[1] === 0x54 &&
        u8[2] === 0x68 &&
        u8[3] === 0x64
      ) {
        // SMF MIDI magic 'MThd'
        return this.importMidi(contentOrBuffer, options);
      } else {
        const jsonStr = new TextDecoder().decode(contentOrBuffer);
        imported = deserializeProject(jsonStr);
      }
    } else if (typeof contentOrBuffer === "string") {
      imported = deserializeProject(contentOrBuffer);
    } else if (
      typeof contentOrBuffer === "object" &&
      contentOrBuffer !== null
    ) {
      imported = deserializeProject(JSON.stringify(contentOrBuffer));
    } else {
      throw new Error("Invalid project file content");
    }

    this.history.push(this.project.get());
    this.project.set(imported);
    this._ensureValidSelectedTrack(imported);
    this._updateGraph();
    this._persistProject(imported);
    this._updateState({
      trackCount: imported.tracks.length,
      bpm: imported.bpm,
    });
    return { ok: true, project: imported };
  }

  async sendCommand(name, params = {}) {
    if (name === "play") {
      await this.play();
      return { ok: true, state: this.getState() };
    }
    if (name === "stop") {
      await this.stop();
      return { ok: true, state: this.getState() };
    }
    if (name === "panic") {
      this.panic();
      return { ok: true, state: this.getState() };
    }
    if (name === "bounce") {
      const meta = await this.bounce(params);
      return { ok: true, bounce: meta };
    }
    if (name === "bounce_stems") {
      const stemsResult = await this.bounceStems(params);
      return { ok: true, ...stemsResult };
    }
    if (name === "export_midi") {
      const midiResult = this.exportMidi(params);
      return { ok: true, ...midiResult };
    }
    if (name === "import_midi") {
      return this.importMidi(params.buffer || params.data, params);
    }
    if (name === "export_project") {
      const projResult = this.exportProject(params);
      return { ok: true, ...projResult };
    }
    if (name === "save_project") {
      return await this.saveProject(params);
    }
    if (name === "load_project" && params.filename) {
      return await this.loadProjectFromFs(params);
    }
    if (name === "list_conversations") {
      const conversations = await this.listConversations();
      return { ok: true, conversations };
    }
    if (name === "list_files") {
      const files = await this.listConversationFiles(params.conversationId);
      return { ok: true, files };
    }
    if (name === "import_project") {
      if (params.filename && !params.content && !params.data) {
        return await this.loadProjectFromFs(params);
      }
      return this.importProjectFile(params.content || params.data, params);
    }
    if (name === "undo") {
      const prev = this.history.undo();
      if (!prev) return { ok: false, message: "Nothing to undo" };
      this.project.set(prev);
      this._ensureValidSelectedTrack(prev);
      this._updateGraph();
      this._persistProject(prev);
      this._updateState({ trackCount: prev.tracks.length });
      return { ok: true, undone: true, project: prev };
    }

    if (
      name === "reset_project" ||
      name === "new_project" ||
      (name === "reset" && (!params.scope || params.scope === "project"))
    ) {
      if (this.state.get().playing) {
        await this.stop();
      }
      this.panic();
      this.history.clear();
      this._lastSchedulePpqn = 0;
      this._lastScheduleAudioTime = 0;

      const { project: next, result } = applyCommand(
        this.project.get(),
        name,
        params,
      );
      this.project.set(next);
      this._ensureValidSelectedTrack(next);
      this._updateGraph();
      this._persistProject(next);
      this._updateState({
        playing: false,
        positionPpqn: 0,
        bar: 1,
        beat: 1,
        step: 0,
        bpm: next.bpm,
        trackCount: next.tracks.length,
        lastError: null,
      });

      return result;
    }

    // Mutating commands: snapshot current project before applying
    const current = this.project.get();
    this.history.push(current);

    const { project: next, result } = applyCommand(current, name, params);
    this.project.set(next);
    this._ensureValidSelectedTrack(next);
    this._updateGraph();
    this._persistProject(next);
    this._updateState({ trackCount: next.tracks.length });

    return result;
  }

  async resetProject(options = {}) {
    return await this.sendCommand("reset_project", options);
  }

  async newProject(options = {}) {
    return await this.sendCommand("new_project", options);
  }
}

if (!globalThis.__scdaw) {
  globalThis.__scdaw = new DawEngine();
}

export const scdaw = globalThis.__scdaw;
