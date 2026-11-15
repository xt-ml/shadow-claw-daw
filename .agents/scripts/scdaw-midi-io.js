/**
 * .agents/scripts/scdaw-midi-io.js
 *
 * Web MIDI API integration, hot-plug device enumeration, MIDI Learn,
 * MIDI Output, and Software QWERTY MIDI Keyboard fallback.
 * Gracefully degrades when navigator.requestMIDIAccess is unavailable or denied.
 */

import { State } from "./scdaw-signals.js";
import { parseMidiMessage, encodeMidiMessage } from "./scdaw-midi.js";

const QWERTY_SEMITONE_MAP = Object.freeze({
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ";": 16,
  "'": 17,
});

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export class SoftwareMidiInput {
  constructor(engine) {
    this.engine = engine;
    this.octave = 4;
    this.velocity = 0.8;
    this._heldKeys = new Map();
    this._heldPitches = new Map();
  }

  setOctave(oct) {
    this.octave = clamp(Math.round(Number(oct) || 4), 0, 8);
    return this.octave;
  }

  shiftOctave(delta) {
    return this.setOctave(this.octave + delta);
  }

  setVelocity(vel) {
    this.velocity = clamp(Number(vel) || 0.8, 0.05, 1);
    return this.velocity;
  }

  noteOn(pitch, velocity = this.velocity, trackId = null) {
    const p = clamp(Math.round(pitch), 0, 127);
    const targetId = trackId || this.engine?.selectedTrackId?.get();
    if (!targetId || !this.engine) return null;
    this._heldPitches.set(`${targetId}:${p}`, { trackId: targetId, pitch: p });
    return this.engine.liveNoteOn(targetId, p, velocity);
  }

  noteOff(pitch, trackId = null) {
    const p = clamp(Math.round(pitch), 0, 127);
    const targetId = trackId || this.engine?.selectedTrackId?.get();
    if (!targetId || !this.engine) return;
    this._heldPitches.delete(`${targetId}:${p}`);
    this.engine.liveNoteOff(targetId, p);
  }

  keyDown(key, { repeat = false, trackId = null } = {}) {
    if (repeat || !key) return null;
    const normalized = String(key).toLowerCase();
    if (!(normalized in QWERTY_SEMITONE_MAP)) return null;
    if (this._heldKeys.has(normalized)) return null;

    const offset = QWERTY_SEMITONE_MAP[normalized];
    const pitch = clamp((this.octave + 1) * 12 + offset, 0, 127);
    const targetId = trackId || this.engine?.selectedTrackId?.get();
    this._heldKeys.set(normalized, { pitch, trackId: targetId });
    this.noteOn(pitch, this.velocity, targetId);
    return pitch;
  }

  keyUp(key, { trackId = null } = {}) {
    if (!key) return;
    const normalized = String(key).toLowerCase();
    const entry = this._heldKeys.get(normalized);
    if (!entry) return;
    this._heldKeys.delete(normalized);
    this.noteOff(entry.pitch, trackId || entry.trackId);
  }

  releaseAll() {
    for (const entry of this._heldKeys.values()) {
      this.engine?.liveNoteOff?.(entry.trackId, entry.pitch);
    }
    this._heldKeys.clear();
    for (const entry of this._heldPitches.values()) {
      this.engine?.liveNoteOff?.(entry.trackId, entry.pitch);
    }
    this._heldPitches.clear();
  }
}

export class MidiIoManager {
  constructor(engine, options = {}) {
    this.engine = engine;
    this._navigator =
      options.navigatorObj !== undefined
        ? options.navigatorObj
        : typeof navigator !== "undefined"
          ? navigator
          : null;
    this._access = null;
    this._heldByDevice = new Map();
    this._learningTarget = null;
    this._commitTimers = new Map();
    this.software = new SoftwareMidiInput(engine);

    const hasWebMidi = Boolean(
      this._navigator &&
      typeof this._navigator.requestMIDIAccess === "function",
    );
    this.state = new State({
      supported: hasWebMidi,
      status: hasWebMidi ? "idle" : "unsupported",
      sysexEnabled: false,
      inputs: [],
      outputs: [],
      learning: { active: false, target: null },
      lastActivityAt: 0,
      lastNote: null,
    });
  }

  _updateState(patch) {
    this.state.set({
      ...this.state.get(),
      ...patch,
    });
  }

  async init({ sysex = false } = {}) {
    if (
      !this._navigator ||
      typeof this._navigator.requestMIDIAccess !== "function"
    ) {
      this._updateState({ supported: false, status: "unsupported" });
      return "unsupported";
    }

    try {
      const access = await this._navigator.requestMIDIAccess({ sysex });
      this._access = access;
      access.onstatechange = () => this._syncPorts();
      this._syncPorts();
      this._updateState({
        supported: true,
        status: "ready",
        sysexEnabled: Boolean(access.sysexEnabled),
      });
      return "ready";
    } catch (_) {
      this._updateState({ supported: false, status: "denied" });
      return "denied";
    }
  }

  _serializePort(port) {
    return {
      id: port.id,
      name: port.name || "Unknown MIDI Device",
      manufacturer: port.manufacturer || "",
      type: port.type,
      state: port.state || "connected",
      connection: port.connection || "closed",
    };
  }

  _releaseHeldForDevice(deviceId) {
    const held = this._heldByDevice.get(deviceId);
    if (!held) return;
    for (const key of held) {
      const sep = key.lastIndexOf(":");
      const trackId = key.slice(0, sep);
      const pitch = Number(key.slice(sep + 1));
      this.engine?.liveNoteOff?.(trackId, pitch, { fromMidi: false });
    }
    this._heldByDevice.delete(deviceId);
  }

  _syncPorts() {
    if (!this._access) return;
    const inputs = [];
    const activeInputIds = new Set();

    for (const port of this._access.inputs.values()) {
      if (port.state === "disconnected") continue;
      activeInputIds.add(port.id);
      inputs.push(this._serializePort(port));
      port.onmidimessage = (ev) => this._handleMidiMessage(port, ev);
    }

    // Release any held notes from inputs that disconnected
    for (const deviceId of [...this._heldByDevice.keys()]) {
      if (!activeInputIds.has(deviceId)) {
        this._releaseHeldForDevice(deviceId);
      }
    }

    const outputs = [];
    for (const port of this._access.outputs.values()) {
      if (port.state === "disconnected") continue;
      outputs.push(this._serializePort(port));
    }

    this._updateState({ inputs, outputs });
  }

  _resolveTargetTracks(deviceId, channel) {
    const p = this.engine?.project?.get?.();
    if (!p || !Array.isArray(p.tracks)) return [];
    const selectedId = this.engine?.selectedTrackId?.get?.();

    const matched = [];
    for (const track of p.tracks) {
      const routing = track.midiInput || {
        deviceId: null,
        channel: "omni",
        enabled: true,
      };
      if (routing.enabled === false) continue;

      const deviceMatches = routing.deviceId
        ? routing.deviceId === deviceId
        : track.id === selectedId || Boolean(track.recordArm);
      if (!deviceMatches) continue;

      const ch = routing.channel;
      const channelMatches =
        ch === undefined ||
        ch === null ||
        ch === "omni" ||
        Number(ch) === channel + 1 ||
        Number(ch) === channel;
      if (!channelMatches) continue;

      matched.push(track);
    }
    return matched;
  }

  _applyMappedCc(mapping, value) {
    const norm = clamp(value / 127, 0, 1);
    const min = Number(mapping.min ?? 0);
    const max = Number(mapping.max ?? 1);
    let scaled;
    if (mapping.scaling === "exponential" && min > 0 && max > 0) {
      scaled = min * Math.pow(max / min, norm);
    } else {
      scaled = min + (max - min) * norm;
    }

    const paramName = mapping.param;
    if (paramName === "volume" || paramName === "pan") {
      this.engine.setLiveTrackParam(mapping.trackId, { [paramName]: scaled });
    } else {
      this.engine.setLiveTrackParam(mapping.trackId, {
        params: { [paramName]: scaled },
      });
    }

    const existingTimer = this._commitTimers.get(mapping.trackId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this._commitTimers.delete(mapping.trackId);
      this.engine?.commitLiveTrackParam?.(mapping.trackId);
    }, 150);
    if (typeof timer?.unref === "function") timer.unref();
    this._commitTimers.set(mapping.trackId, timer);
  }

  _handleMidiMessage(port, ev) {
    const msg = parseMidiMessage(ev?.data);
    if (!msg || msg.type === "ignore") return;

    this._updateState({ lastActivityAt: Date.now() });

    if (msg.type === "note-on" || msg.type === "note-off") {
      const targets = this._resolveTargetTracks(port.id, msg.channel);
      let held = this._heldByDevice.get(port.id);
      if (!held) {
        held = new Set();
        this._heldByDevice.set(port.id, held);
      }
      for (const track of targets) {
        const key = `${track.id}:${msg.pitch}`;
        if (msg.type === "note-on") {
          held.add(key);
          this.engine.liveNoteOn(track.id, msg.pitch, msg.velocity, {
            fromMidi: false,
          });
          this._updateState({ lastNote: msg.pitch });
        } else {
          held.delete(key);
          this.engine.liveNoteOff(track.id, msg.pitch, { fromMidi: false });
        }
      }
      return;
    }

    if (msg.type === "cc") {
      if (this._learningTarget) {
        const target = this._learningTarget;
        this._learningTarget = null;
        this._updateState({ learning: { active: false, target: null } });
        this.engine?.sendCommand?.("set_midi_learn_mapping", {
          deviceId: port.id,
          channel: msg.channel,
          cc: msg.controller,
          trackId: target.trackId,
          param: target.param,
          min: target.min ?? 0,
          max: target.max ?? 1,
          scaling: target.scaling || "linear",
        });
        return;
      }

      const targets = this._resolveTargetTracks(port.id, msg.channel);
      if (msg.controller === 64) {
        for (const track of targets) {
          this.engine?.setSustainPedal?.(track.id, msg.value >= 64);
        }
      } else if (msg.controller === 123 || msg.controller === 120) {
        this.engine?.panic?.();
      }

      const p = this.engine?.project?.get?.();
      const mappings = p?.midiMappings || [];
      for (const m of mappings) {
        if (
          m.cc === msg.controller &&
          (m.channel === undefined ||
            m.channel === null ||
            m.channel === "omni" ||
            m.channel === msg.channel) &&
          (!m.deviceId || m.deviceId === port.id)
        ) {
          this._applyMappedCc(m, msg.value);
        }
      }
      return;
    }

    if (msg.type === "pitch-bend") {
      const targets = this._resolveTargetTracks(port.id, msg.channel);
      for (const track of targets) {
        this.engine?.setPitchBend?.(track.id, msg.value);
      }
    }
  }

  startMidiLearn(target) {
    this._learningTarget = target;
    this._updateState({ learning: { active: true, target } });
  }

  cancelMidiLearn() {
    this._learningTarget = null;
    this._updateState({ learning: { active: false, target: null } });
  }

  _resolveOutputForTrack(trackId) {
    if (!this._access) return null;
    const p = this.engine?.project?.get?.();
    const track = p?.tracks?.find((t) => t.id === trackId);
    const outCfg = track?.midiOutput;
    if (!outCfg?.enabled || !outCfg.deviceId) return null;
    const port = this._access.outputs.get(outCfg.deviceId);
    if (!port || port.state === "disconnected") return null;
    const channel = clamp((Number(outCfg.channel) || 1) - 1, 0, 15);
    return { port, channel };
  }

  sendNoteOn(trackId, pitch, velocity = 0.8) {
    const out = this._resolveOutputForTrack(trackId);
    if (!out) return false;
    const bytes = encodeMidiMessage({
      type: "note-on",
      channel: out.channel,
      pitch,
      velocity,
    });
    out.port.send(bytes);
    return true;
  }

  sendNoteOff(trackId, pitch) {
    const out = this._resolveOutputForTrack(trackId);
    if (!out) return false;
    const bytes = encodeMidiMessage({
      type: "note-off",
      channel: out.channel,
      pitch,
      velocity: 0,
    });
    out.port.send(bytes);
    return true;
  }

  sendAllNotesOff(trackId) {
    const out = this._resolveOutputForTrack(trackId);
    if (!out) return false;
    const bytes = encodeMidiMessage({
      type: "cc",
      channel: out.channel,
      controller: 123,
      value: 0,
    });
    out.port.send(bytes);
    return true;
  }
}

export function createMidiIo(engine, options = {}) {
  return new MidiIoManager(engine, options);
}
