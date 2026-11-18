/**
 * .agents/scripts/scdaw-midi-io.js
 *
 * Web MIDI API integration, hot-plug device enumeration, MIDI Learn,
 * MIDI Output, and Software QWERTY MIDI Keyboard fallback.
 * Gracefully degrades when navigator.requestMIDIAccess is unavailable or denied.
 */

import { State } from "./scdaw-signals.js";
import { parseMidiMessage, encodeMidiMessage } from "./scdaw-midi.js";
import { resolveMidiMappingDefaults } from "./scdaw.js";

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
    this._recentPortMessages = new Map();
    this._crossPortDedupWindowMs = options.crossPortDedupWindowMs ?? 80;
    this._disabledInputIds = new Set();
    this._softTakeoverState = new Map();
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
      lastMessage: null,
      disabledInputIds: [],
      softTakeover: false,
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
      enabled:
        port.type === "input" ? !this._disabledInputIds.has(port.id) : true,
    };
  }

  setInputPortEnabled(portId, enabled) {
    if (!portId) return;
    if (enabled) {
      this._disabledInputIds.delete(portId);
    } else {
      this._disabledInputIds.add(portId);
      this._releaseHeldForDevice(portId);
    }
    const cur = this.state.get();
    const inputs = (cur.inputs || []).map((p) =>
      p.id === portId ? { ...p, enabled: Boolean(enabled) } : p,
    );
    this._updateState({
      inputs,
      disabledInputIds: [...this._disabledInputIds],
    });
  }

  setSoftTakeover(enabled) {
    this._softTakeoverState.clear();
    this._updateState({ softTakeover: Boolean(enabled) });
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

  _scheduleCommit(key, commitFn) {
    const existingTimer = this._commitTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this._commitTimers.delete(key);
      commitFn?.();
    }, 150);
    if (typeof timer?.unref === "function") timer.unref();
    this._commitTimers.set(key, timer);
  }

  _checkSoftTakeover(key, scaled, currentValue, min, max, mapping) {
    const enabled = Boolean(
      mapping?.softTakeover ?? this.state.get().softTakeover,
    );
    if (!enabled) return true;

    const span = Math.max(1e-6, Math.abs(max - min));
    const threshold = span * 0.03;
    let entry = this._softTakeoverState.get(key);
    if (!entry) {
      entry = { engaged: false, lastScaled: null };
      this._softTakeoverState.set(key, entry);
    }

    if (Math.abs(scaled - currentValue) <= threshold) {
      entry.engaged = true;
      entry.lastScaled = scaled;
      return true;
    }

    if (entry.engaged) {
      if (
        entry.lastScaled !== null &&
        Math.abs(currentValue - entry.lastScaled) > threshold * 3
      ) {
        entry.engaged = false;
      } else {
        entry.lastScaled = scaled;
        return true;
      }
    }

    if (
      entry.lastScaled !== null &&
      ((entry.lastScaled <= currentValue && scaled >= currentValue) ||
        (entry.lastScaled >= currentValue && scaled <= currentValue))
    ) {
      entry.engaged = true;
      entry.lastScaled = scaled;
      return true;
    }

    entry.lastScaled = scaled;
    return false;
  }

  _applyMappedCc(mapping, value) {
    const project = this.engine?.project?.get?.();
    const resolved = resolveMidiMappingDefaults(mapping, project);
    const norm = clamp(value / 127, 0, 1);
    const min = Number(resolved.min ?? 0);
    const max = Number(resolved.max ?? 1);
    let scaled;
    if (resolved.scaling === "exponential" && min > 0 && max > 0) {
      scaled = min * Math.pow(max / min, norm);
    } else {
      scaled = min + (max - min) * norm;
    }

    const paramName = resolved.param;
    const mode = resolved.mode || "continuous";
    let targetTrackId = resolved.trackId;
    if (targetTrackId === "selected") {
      targetTrackId = this.engine?.selectedTrackId?.get?.();
    }

    // 1. Transport targets
    if (targetTrackId === "transport") {
      const pressed = value >= 64;
      if (paramName === "play") {
        if (mode === "trigger" && !pressed) return;
        this.engine?.play?.();
        return;
      }
      if (paramName === "stop") {
        if (mode === "trigger" && !pressed) return;
        this.engine?.stop?.();
        return;
      }
      if (paramName === "pause") {
        if (mode === "trigger" && !pressed) return;
        this.engine?.pause?.();
        return;
      }
      if (paramName === "panic") {
        if (mode === "trigger" && !pressed) return;
        this.engine?.panic?.();
        return;
      }
      if (paramName === "toggle_play") {
        if (mode === "toggle") {
          if (!pressed) return;
          if (this.engine?.getState?.().playing) this.engine?.pause?.();
          else this.engine?.play?.();
        } else if (mode === "momentary") {
          if (pressed) this.engine?.play?.();
          else this.engine?.pause?.();
        } else if (pressed) {
          this.engine?.play?.();
        }
        return;
      }
      if (paramName === "record") {
        if (mode === "toggle") {
          if (!pressed) return;
          if (this.engine?.getState?.().recording)
            this.engine?.stopRecording?.();
          else this.engine?.startRecording?.();
        } else if (mode === "momentary") {
          if (pressed) this.engine?.startRecording?.();
          else this.engine?.stopRecording?.();
        }
        return;
      }
      if (paramName === "metronome") {
        const cur = Boolean(project?.metronome?.enabled);
        let nextEnabled;
        if (mode === "toggle") {
          if (!pressed) return;
          nextEnabled = !cur;
        } else if (mode === "momentary") {
          nextEnabled = pressed;
        } else {
          nextEnabled = scaled >= (min + max) / 2;
        }
        this.engine?.sendCommand?.("set_metronome", { enabled: nextEnabled });
        return;
      }
      if (paramName === "bpm" || paramName === "swing") {
        const curVal = Number(
          project?.[paramName] ?? (paramName === "bpm" ? 120 : 0),
        );
        if (
          !this._checkSoftTakeover(
            `transport:${paramName}`,
            scaled,
            curVal,
            min,
            max,
            mapping,
          )
        ) {
          return;
        }
        this.engine?.setLiveTransportParam?.({ [paramName]: scaled });
        this._scheduleCommit("__transport__", () =>
          this.engine?.commitLiveTransportParam?.(),
        );
        return;
      }
      return;
    }

    // 2. Master bus targets
    if (targetTrackId === "master") {
      const mParam = paramName || "volume";
      const curVal = Number(
        project?.master?.[mParam] ?? (mParam === "volume" ? 0.8 : 0),
      );
      if (
        !this._checkSoftTakeover(
          `master:${mParam}`,
          scaled,
          curVal,
          min,
          max,
          mapping,
        )
      ) {
        return;
      }
      this.engine?.setLiveMasterParam?.({ [mParam]: scaled });
      this._scheduleCommit("__master__", () =>
        this.engine?.commitLiveMasterParam?.(),
      );
      return;
    }

    // 3. Track targets
    const track = project?.tracks?.find?.((t) => t.id === targetTrackId);
    if (!track) return;

    const isTopLevelBool =
      paramName === "mute" || paramName === "solo" || paramName === "recordArm";
    const isTopLevelCont = paramName === "volume" || paramName === "pan";

    const applyTrackPatch = (val) => {
      if (isTopLevelBool || isTopLevelCont) {
        this.engine?.setLiveTrackParam?.(targetTrackId, { [paramName]: val });
      } else {
        this.engine?.setLiveTrackParam?.(targetTrackId, {
          params: { [paramName]: val },
        });
      }
    };

    if (mode === "toggle" || mode === "momentary" || mode === "trigger") {
      const pressed = value >= 64;
      if ((mode === "toggle" || mode === "trigger") && !pressed) return;

      const curVal = isTopLevelBool
        ? Boolean(track[paramName])
        : isTopLevelCont
          ? Number(track[paramName] ?? 0)
          : track.params?.[paramName];

      let nextVal;
      if (isTopLevelBool || typeof curVal === "boolean") {
        if (mode === "toggle") nextVal = !curVal;
        else if (mode === "momentary") nextVal = pressed;
        else nextVal = true;
      } else {
        if (mode === "toggle") {
          const numCur = Number(curVal ?? min);
          nextVal = Math.abs(numCur - max) < Math.abs(numCur - min) ? min : max;
        } else if (mode === "momentary") {
          nextVal = pressed ? max : min;
        } else {
          nextVal = max;
        }
      }

      applyTrackPatch(nextVal);
      this.engine?.commitLiveTrackParam?.(targetTrackId);
      return;
    }

    const curVal = isTopLevelBool
      ? Number(Boolean(track[paramName]))
      : isTopLevelCont
        ? Number(track[paramName] ?? (paramName === "volume" ? 0.8 : 0))
        : Number(track.params?.[paramName] ?? min);

    if (
      !this._checkSoftTakeover(
        `${targetTrackId}:${paramName}`,
        scaled,
        curVal,
        min,
        max,
        mapping,
      )
    ) {
      return;
    }

    applyTrackPatch(scaled);
    this._scheduleCommit(targetTrackId, () =>
      this.engine?.commitLiveTrackParam?.(targetTrackId),
    );
  }

  _handleMidiMessage(port, ev) {
    if (port?.id && this._disabledInputIds.has(port.id)) return;
    const raw = ev?.data;
    const msg = parseMidiMessage(raw);
    if (!msg || msg.type === "ignore") return;

    if (raw && raw.length >= 2 && (raw[0] & 0xf0) < 0xf0) {
      const sig = `${raw[0]}:${raw[1] ?? 0}:${raw[2] ?? 0}`;
      const nowPerf =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const prev = this._recentPortMessages.get(sig);
      if (
        prev &&
        prev.portId !== port?.id &&
        nowPerf - prev.timeMs < this._crossPortDedupWindowMs
      ) {
        return;
      }
      this._recentPortMessages.set(sig, { portId: port?.id, timeMs: nowPerf });
      if (this._recentPortMessages.size > 128) {
        for (const [k, v] of this._recentPortMessages.entries()) {
          if (nowPerf - v.timeMs >= this._crossPortDedupWindowMs) {
            this._recentPortMessages.delete(k);
          }
        }
      }
    }

    this._updateState({
      lastActivityAt: Date.now(),
      lastMessage: {
        portId: port?.id || "",
        portName: port?.name || port?.id || "MIDI Input",
        type: msg.type,
        channel: msg.channel ?? 0,
        controller: msg.controller ?? null,
        pitch: msg.pitch ?? null,
        value:
          msg.type === "cc"
            ? msg.value
            : msg.type === "pitch-bend"
              ? msg.value
              : Math.round((msg.velocity ?? 0) * 127),
        timestamp: Date.now(),
      },
    });

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
        const resolved = resolveMidiMappingDefaults(
          target,
          this.engine?.project?.get?.(),
        );
        this.engine?.sendCommand?.("set_midi_learn_mapping", {
          deviceId: target.deviceId !== undefined ? target.deviceId : port.id,
          channel: target.channel !== undefined ? target.channel : msg.channel,
          cc: msg.controller,
          trackId: resolved.trackId,
          param: resolved.param,
          min: resolved.min,
          max: resolved.max,
          scaling: resolved.scaling,
          mode: resolved.mode,
          replaceTarget: Boolean(target.replaceTarget),
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
      const appliedTargets = new Set();
      for (const m of mappings) {
        if (
          m.cc === msg.controller &&
          (m.channel === undefined ||
            m.channel === null ||
            m.channel === "" ||
            m.channel === "omni" ||
            Number(m.channel) === msg.channel) &&
          (!m.deviceId || m.deviceId === port.id)
        ) {
          const targetKey = `${m.trackId || "transport"}:${m.param}:${m.mode || ""}`;
          if (appliedTargets.has(targetKey)) continue;
          appliedTargets.add(targetKey);
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

  startMidiLearn(target = {}) {
    const resolved = resolveMidiMappingDefaults(
      target,
      this.engine?.project?.get?.(),
    );
    const normalizedTarget = {
      ...target,
      ...resolved,
    };
    this._learningTarget = normalizedTarget;
    this._updateState({ learning: { active: true, target: normalizedTarget } });
    return normalizedTarget;
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
