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

export const SYNTH_808_SCHEMA = Object.freeze({
  preset: {
    default: "clean",
    type: "enum",
    values: ["clean", "dist", "growl", "grit"],
  },
  glide: { default: 0.05, min: 0.0, max: 0.5, step: 0.01, unit: "s" },
  drive: { default: 1.15, min: 0.5, max: 3.0, step: 0.05, unit: "x" },
  tone: { default: 0.6, min: 0.1, max: 1.0, step: 0.05, unit: "ratio" },
  decay: { default: 0.8, min: 0.1, max: 3.0, step: 0.05, unit: "s" },
});

export const CUBED_SCHEMA = Object.freeze({
  waveform: {
    default: "sawtooth",
    type: "enum",
    values: ["sawtooth", "square"],
  },
  tuning: { default: 0, min: -1200, max: 1200, step: 1, unit: "cents" },
  cutoff: {
    default: 450,
    min: 40,
    max: 10000,
    step: 10,
    unit: "Hz",
    scaling: "exponential",
  },
  resonance: { default: 8.0, min: 0.5, max: 25.0, step: 0.5, unit: "Q" },
  envMod: { default: 2400, min: 0, max: 8000, step: 50, unit: "Hz" },
  decay: { default: 0.25, min: 0.05, max: 2.0, step: 0.01, unit: "s" },
  accent: { default: 1.3, min: 1.0, max: 2.5, step: 0.1, unit: "x" },
});

export const PLUCK_SCHEMA = Object.freeze({
  preset: {
    default: "guitarish",
    type: "enum",
    values: ["guitarish", "koto_dark", "short_bell", "dark_pluck"],
  },
  tone: { default: 0.65, min: 0.1, max: 1.0, step: 0.05, unit: "ratio" },
  decay: { default: 0.4, min: 0.05, max: 1.0, step: 0.05, unit: "s" },
  drive: { default: 1.1, min: 0.5, max: 3.0, step: 0.1, unit: "x" },
  width: { default: 0.75, min: 0.0, max: 1.0, step: 0.05, unit: "ratio" },
});

export const TUBULAR_SCHEMA = Object.freeze({
  algorithm: { default: 1, min: 1, max: 32, step: 1, unit: "algo" },
  feedback: { default: 4.0, min: 0.0, max: 7.0, step: 1, unit: "level" },
  modIndex: { default: 2.5, min: 0.0, max: 10.0, step: 0.1, unit: "ratio" },
  attack: { default: 0.01, min: 0.002, max: 2.0, step: 0.01, unit: "s" },
  decay: { default: 0.5, min: 0.05, max: 4.0, step: 0.05, unit: "s" },
  sustain: { default: 0.4, min: 0.0, max: 1.0, step: 0.05, unit: "ratio" },
  release: { default: 0.3, min: 0.02, max: 4.0, step: 0.05, unit: "s" },
});

export const NEON_SCHEMA = Object.freeze({
  mode: {
    default: "normal",
    type: "enum",
    values: ["normal", "ring", "noise"],
  },
  wave1: {
    default: "resonant-saw",
    type: "enum",
    values: ["saw", "square", "resonant-saw", "resonant-tri"],
  },
  wave2: {
    default: "saw",
    type: "enum",
    values: ["saw", "square", "pulse", "sine"],
  },
  dcw: { default: 0.5, min: 0.0, max: 1.0, step: 0.01, unit: "ratio" },
  detune: { default: 8, min: -1200, max: 1200, step: 1, unit: "cents" },
  attack: { default: 0.02, min: 0.005, max: 2.0, step: 0.01, unit: "s" },
  release: { default: 0.25, min: 0.02, max: 4.0, step: 0.01, unit: "s" },
});

export const NOISE_PAD_SCHEMA = Object.freeze({
  preset: {
    default: "air_pad",
    type: "enum",
    values: ["air_pad", "vinyl_hiss_pad", "dark_wind", "cinematic_haze"],
  },
  attack: { default: 0.6, min: 0.05, max: 3.0, step: 0.05, unit: "s" },
  decay: { default: 0.6, min: 0.05, max: 3.0, step: 0.05, unit: "s" },
  sustain: { default: 0.7, min: 0.0, max: 1.0, step: 0.05, unit: "ratio" },
  release: { default: 0.9, min: 0.1, max: 5.0, step: 0.1, unit: "s" },
  tone: { default: 0.4, min: 0.1, max: 1.0, step: 0.05, unit: "ratio" },
  texture: { default: 0.25, min: 0.0, max: 1.0, step: 0.05, unit: "ratio" },
  width: { default: 0.9, min: 0.0, max: 1.5, step: 0.05, unit: "ratio" },
});

export const KORPUS_SCHEMA = Object.freeze({
  exciter: {
    default: "strike",
    type: "enum",
    values: ["strike", "breath", "bow", "pick", "wind"],
  },
  intensity: { default: 0.6, min: 0.0, max: 1.0, step: 0.05, unit: "ratio" },
  materialA: {
    default: "marimba",
    type: "enum",
    values: ["marimba", "bell", "membrane", "plate", "wire"],
  },
  materialB: {
    default: "plate",
    type: "enum",
    values: ["bell", "plate", "wire", "membrane", "off"],
  },
  coupling: { default: 0.3, min: 0.0, max: 1.0, step: 0.05, unit: "ratio" },
  damping: { default: 0.5, min: 0.05, max: 1.0, step: 0.05, unit: "ratio" },
});

export const NANO_SCHEMA = Object.freeze({
  rootKey: { default: 60, min: 0, max: 127, step: 1, unit: "key" },
  attack: { default: 0.005, min: 0.001, max: 2.0, step: 0.005, unit: "s" },
  release: { default: 0.2, min: 0.01, max: 5.0, step: 0.01, unit: "s" },
  loop: { default: false, type: "boolean" },
  reverse: { default: false, type: "boolean" },
});

export const SOUNDFONT_SCHEMA = Object.freeze({
  soundfont: { default: "", type: "string" },
  bank: { default: 0, min: 0, max: 128, step: 1, unit: "bank" },
  program: { default: 0, min: 0, max: 127, step: 1, unit: "program" },
  channel: { default: 0, min: 0, max: 15, step: 1, unit: "channel" },
});

export const INSTRUMENT_SCHEMAS = Object.freeze({
  vaporisateur: SYNTH_PARAM_SCHEMA,
  synth: SYNTH_PARAM_SCHEMA,
  playfield: DRUM_PARAM_SCHEMA,
  drums: DRUM_PARAM_SCHEMA,
  808: SYNTH_808_SCHEMA,
  cubed: CUBED_SCHEMA,
  pluck: PLUCK_SCHEMA,
  tubular: TUBULAR_SCHEMA,
  neon: NEON_SCHEMA,
  "noise-pad": NOISE_PAD_SCHEMA,
  korpus: KORPUS_SCHEMA,
  nano: NANO_SCHEMA,
  soundfont: SOUNDFONT_SCHEMA,
});

export const AUTOMATABLE_PARAMS = Object.freeze({
  volume: Object.freeze({
    scope: "track",
    default: 0.8,
    min: 0.0,
    max: 1.5,
    unit: "linear",
    label: "Volume",
  }),
  pan: Object.freeze({
    scope: "track",
    default: 0.0,
    min: -1.0,
    max: 1.0,
    unit: "pan",
    label: "Pan",
  }),
  cutoff: Object.freeze({
    scope: "synth",
    default: 1200,
    min: 20,
    max: 20000,
    unit: "Hz",
    label: "Cutoff",
  }),
  resonance: Object.freeze({
    scope: "synth",
    default: 2.0,
    min: 0.1,
    max: 30.0,
    unit: "Q",
    label: "Resonance",
  }),
});

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
  if (!next.metronome || typeof next.metronome !== "object") {
    next.metronome = { enabled: false, volume: 0.8 };
  }
  if (!next.master) next.master = { volume: 0.8 };
  if (!Array.isArray(next.tracks)) next.tracks = [];

  for (const track of next.tracks) {
    if (!track.id) {
      track.id = `trk_${Math.random().toString(36).slice(2, 8)}`;
    }
    if (!track.color) {
      track.color =
        track.kind === "drums"
          ? "#f59e0b"
          : track.kind === "audio"
            ? "#a78bfa"
            : "#80d4db";
    }
    if (!track.channelRole) {
      track.channelRole = CHANNEL_ROLES.REGULAR;
    }
    if (!Array.isArray(track.fx)) track.fx = [];
    if (!Array.isArray(track.midiFx)) track.midiFx = [];
    if (!Array.isArray(track.notes)) track.notes = [];
    if (!Array.isArray(track.audioClips)) track.audioClips = [];
    if (!Array.isArray(track.sends)) track.sends = [];
    if (!track.automation || typeof track.automation !== "object") {
      track.automation = {};
    }
    if (track.recordArm === undefined) track.recordArm = false;
    if (track.volume === undefined) track.volume = 0.8;
    if (track.pan === undefined) track.pan = 0.0;
    if (track.mute === undefined) track.mute = false;
    if (track.solo === undefined) track.solo = false;
  }
  return next;
}

export function getDefaultParams(kind) {
  const normKind = String(kind || "").toLowerCase();
  const schema =
    INSTRUMENT_SCHEMAS[normKind] ||
    (normKind === "synth" ? SYNTH_PARAM_SCHEMA : null) ||
    FX_SCHEMAS[normKind];
  if (schema) {
    const defaults = {};
    for (const [key, def] of Object.entries(schema)) {
      defaults[key] = def.default;
    }
    return defaults;
  }
  return {};
}
