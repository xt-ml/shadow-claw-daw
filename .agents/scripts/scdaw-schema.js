/**
 * .agents/scripts/scdaw-schema.js
 *
 * Formal parameter definitions, constraints, defaults, and value mappers.
 * Ported concepts from openDAW forge-boxes and Defaults.ts.
 */

export const MASTER_SCHEMA = Object.freeze({
  volume: { default: 0.8, min: 0.0, max: 1.0, step: 0.01, unit: "linear" },
});

export const TRACK_MIX_SCHEMA = Object.freeze({
  volume: { default: 0.8, min: 0.0, max: 1.5, step: 0.01, unit: "linear" },
  pan: { default: 0.0, min: -1.0, max: 1.0, step: 0.02, unit: "pan" },
  mute: { default: false, type: "boolean" },
  solo: { default: false, type: "boolean" },
});

export const SYNTH_PARAM_SCHEMA = Object.freeze({
  waveform: {
    default: "sawtooth",
    type: "enum",
    values: ["sine", "triangle", "sawtooth", "square"],
  },
  cutoff: {
    default: 1200,
    min: 20,
    max: 20000,
    step: 1,
    unit: "Hz",
    scaling: "exponential",
  },
  resonance: {
    default: 2.0,
    min: 0.1,
    max: 30.0,
    step: 0.1,
    unit: "Q",
  },
  attack: {
    default: 0.01,
    min: 0.005,
    max: 2.0,
    step: 0.005,
    unit: "s",
  },
  decay: {
    default: 0.15,
    min: 0.01,
    max: 3.0,
    step: 0.01,
    unit: "s",
  },
  sustain: {
    default: 0.5,
    min: 0.0,
    max: 1.0,
    step: 0.01,
    unit: "ratio",
  },
  release: {
    default: 0.15,
    min: 0.02,
    max: 4.0,
    step: 0.01,
    unit: "s",
  },
  detune: {
    default: 0,
    min: -1200,
    max: 1200,
    step: 1,
    unit: "cents",
  },
});

export const DRUM_PARAM_SCHEMA = Object.freeze({});

export const FX_SCHEMAS = Object.freeze({
  fold: Object.freeze({
    driveDb: { default: 0, min: 0, max: 24, step: 0.5, unit: "dB" },
    mix: { default: 1.0, min: 0, max: 1.0, step: 0.01, unit: "" },
  }),
  crusher: Object.freeze({
    bits: { default: 16, min: 4, max: 16, step: 1, unit: "bits" },
    downsample: { default: 1, min: 1, max: 32, step: 1, unit: "x" },
    mix: { default: 1.0, min: 0, max: 1.0, step: 0.01, unit: "" },
  }),
  stereoTool: Object.freeze({
    width: { default: 1.0, min: 0, max: 2.0, step: 0.01, unit: "" },
    pan: { default: 0.0, min: -1.0, max: 1.0, step: 0.01, unit: "pan" },
  }),
  delay: Object.freeze({
    timeStepsL: { default: 3, min: 1, max: 16, step: 1, unit: "steps" },
    timeStepsR: { default: 4, min: 1, max: 16, step: 1, unit: "steps" },
    feedback: { default: 0.35, min: 0, max: 0.9, step: 0.01, unit: "" },
    wet: { default: 0.3, min: 0, max: 1.0, step: 0.01, unit: "" },
  }),
  reverb: Object.freeze({
    decay: { default: 1.5, min: 0.1, max: 5.0, step: 0.1, unit: "s" },
    damping: { default: 0.5, min: 0, max: 1.0, step: 0.01, unit: "" },
    wet: { default: 0.25, min: 0, max: 1.0, step: 0.01, unit: "" },
  }),
  compressor: Object.freeze({
    threshold: { default: -12, min: -60, max: 0, step: 1, unit: "dB" },
    ratio: { default: 4, min: 1, max: 20, step: 0.5, unit: "" },
    wet: { default: 1.0, min: 0, max: 1.0, step: 0.01, unit: "" },
  }),
  revamp: Object.freeze({
    lowGainDb: { default: 0, min: -18, max: 18, step: 0.5, unit: "dB" },
    midGainDb: { default: 0, min: -18, max: 18, step: 0.5, unit: "dB" },
    highGainDb: { default: 0, min: -18, max: 18, step: 0.5, unit: "dB" },
  }),
  arpeggio: Object.freeze({
    mode: {
      default: "up",
      type: "enum",
      values: ["up", "down", "up-down", "random"],
    },
    rateSteps: { default: 1, min: 1, max: 4, step: 1, unit: "steps" },
    gate: { default: 0.8, min: 0.1, max: 1.0, step: 0.05, unit: "" },
  }),
  pitch: Object.freeze({
    semitones: { default: 0, min: -24, max: 24, step: 1, unit: "st" },
  }),
  velocity: Object.freeze({
    drive: { default: 0, min: -1.0, max: 1.0, step: 0.01, unit: "" },
    random: { default: 0, min: 0, max: 0.5, step: 0.01, unit: "" },
  }),
});

export const DAWPROJECT_UNITS = Object.freeze({
  LINEAR: "linear",
  NORMALIZED: "normalized",
  PERCENT: "percent",
  DECIBEL: "decibel",
  HERTZ: "hertz",
  SEMITONES: "semitones",
  SECONDS: "seconds",
  BEATS: "beats",
  BPM: "bpm",
});

export const DEVICE_ROLES = Object.freeze({
  NOTE_FX: "noteFX",
  INSTRUMENT: "instrument",
  AUDIO_FX: "audioFX",
});

export const CHANNEL_ROLES = Object.freeze({
  REGULAR: "regular",
  MASTER: "master",
  EFFECT: "effect",
  SUBMIX: "submix",
  VCA: "vca",
});

export const ParameterEncoder = Object.freeze({
  bool(id, value, name) {
    return { id, name, value: Boolean(value), type: "boolean" };
  },
  linear(id, value, min = 0, max = 1, name) {
    return {
      id,
      name,
      value: Number(value),
      min,
      max,
      unit: DAWPROJECT_UNITS.LINEAR,
    };
  },
  normalized(id, value, min = 0, max = 1, name) {
    return {
      id,
      name,
      value: Number(value),
      min,
      max,
      unit: DAWPROJECT_UNITS.NORMALIZED,
    };
  },
});

export const ParameterDecoder = Object.freeze({
  readValue(schema) {
    if (!schema) return 0;
    if (schema.unit === DAWPROJECT_UNITS.LINEAR) {
      return schema.value;
    }
    if (schema.unit === DAWPROJECT_UNITS.NORMALIZED) {
      const min = schema.min ?? 0;
      const max = schema.max ?? 1;
      return schema.value * (max - min) + min;
    }
    return schema.value ?? 0;
  },
});

export function migrateProject(project) {
  if (!project || typeof project !== "object") return project;
  const next = structuredClone(project);
  next.version = 2;
  next.meta = {
    title: next.name || "Untitled",
    artist: "ShadowClaw",
    year: new Date().getFullYear().toString(),
    genre: "Electronic",
    website: "https://xt-ml.github.io/shadow-claw-daw/",
    comment: "Created with ShadowClaw DAW",
    ...(next.meta || {}),
  };
  if (!next.master) next.master = { volume: 0.8 };
  if (!Array.isArray(next.tracks)) next.tracks = [];

  for (const track of next.tracks) {
    if (!track.id) {
      track.id = `trk_${Math.random().toString(36).slice(2, 8)}`;
    }
    if (!track.color) {
      track.color = track.kind === "drums" ? "#f59e0b" : "#80d4db";
    }
    if (!track.channelRole) {
      track.channelRole = CHANNEL_ROLES.REGULAR;
    }
    if (!Array.isArray(track.fx)) track.fx = [];
    if (!Array.isArray(track.midiFx)) track.midiFx = [];
    if (!Array.isArray(track.notes)) track.notes = [];
    if (track.volume === undefined) track.volume = 0.8;
    if (track.pan === undefined) track.pan = 0.0;
    if (track.mute === undefined) track.mute = false;
    if (track.solo === undefined) track.solo = false;
  }
  return next;
}

export function getDefaultParams(kind) {
  if (kind === "synth") {
    const defaults = {};
    for (const [key, def] of Object.entries(SYNTH_PARAM_SCHEMA)) {
      defaults[key] = def.default;
    }
    return defaults;
  }
  if (FX_SCHEMAS[kind]) {
    const defaults = {};
    for (const [key, def] of Object.entries(FX_SCHEMAS[kind])) {
      defaults[key] = def.default;
    }
    return defaults;
  }
  return {};
}
