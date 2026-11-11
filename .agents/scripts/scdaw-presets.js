/**
 * .agents/scripts/scdaw-presets.js
 *
 * Curated synthesizer presets, drum kits, and genre-specific multi-track pattern generators.
 */

import { PPQN, stepToPpqn } from "./scdaw.js";

export const INSTRUMENT_PRESETS = Object.freeze({
  "init-saw": {
    waveform: "sawtooth",
    cutoff: 4500,
    resonance: 1.0,
    filterEnvAmount: 0,
    filterDecay: 0.2,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.5,
    release: 0.15,
  },
  "techno-bass": {
    waveform: "sawtooth",
    osc2Waveform: "square",
    osc2Octave: -1,
    osc2Detune: 8,
    osc2Mix: 0.45,
    subMix: 0.35,
    cutoff: 350,
    resonance: 6.0,
    filterEnvAmount: 3200,
    filterDecay: 0.12,
    attack: 0.008,
    decay: 0.16,
    sustain: 0.25,
    release: 0.08,
    drive: 0.35,
  },
  "acid-303": {
    waveform: "sawtooth",
    cutoff: 280,
    resonance: 18.0,
    filterEnvAmount: 4800,
    filterDecay: 0.14,
    attack: 0.005,
    decay: 0.22,
    sustain: 0.15,
    release: 0.08,
    glide: 0.05,
    drive: 0.4,
  },
  "pop-pluck": {
    waveform: "triangle",
    osc2Waveform: "sawtooth",
    osc2Octave: 0,
    osc2Detune: 12,
    osc2Mix: 0.3,
    subMix: 0.0,
    cutoff: 2600,
    resonance: 2.5,
    filterEnvAmount: 1800,
    filterDecay: 0.18,
    attack: 0.005,
    decay: 0.22,
    sustain: 0.1,
    release: 0.12,
  },
  "warm-pad": {
    waveform: "sawtooth",
    osc2Waveform: "sawtooth",
    osc2Octave: 0,
    osc2Detune: 18,
    osc2Mix: 0.5,
    subMix: 0.2,
    cutoff: 850,
    resonance: 1.5,
    filterEnvAmount: 600,
    filterDecay: 0.6,
    attack: 0.35,
    decay: 0.5,
    sustain: 0.8,
    release: 0.6,
  },
  "sub-808": {
    waveform: "sine",
    cutoff: 220,
    resonance: 1.0,
    filterEnvAmount: 300,
    filterDecay: 0.1,
    attack: 0.005,
    decay: 0.45,
    sustain: 0.6,
    release: 0.25,
    drive: 0.25,
  },
  "supersaw-lead": {
    waveform: "sawtooth",
    osc2Waveform: "sawtooth",
    osc2Octave: 0,
    osc2Detune: 25,
    osc2Mix: 0.55,
    subMix: 0.15,
    cutoff: 4200,
    resonance: 1.8,
    filterEnvAmount: 400,
    filterDecay: 0.25,
    attack: 0.01,
    decay: 0.3,
    sustain: 0.65,
    release: 0.2,
  },
  // --- 808 Sub Bass Presets ---
  "clean-808": {
    instrument: "808",
    preset: "clean",
    glide: 0.06,
    drive: 1.15,
    tone: 0.6,
    decay: 0.85,
  },
  "dist-808": {
    instrument: "808",
    preset: "dist",
    glide: 0.08,
    drive: 1.75,
    tone: 0.8,
    decay: 1.1,
  },
  "growl-808": {
    instrument: "808",
    preset: "growl",
    glide: 0.05,
    drive: 1.55,
    tone: 0.7,
    decay: 0.9,
  },
  // --- Cubed TB-303 Acid Bassline Presets ---
  "cubed-acid-classic": {
    instrument: "cubed",
    waveform: "sawtooth",
    tuning: 0,
    cutoff: 360,
    resonance: 16.0,
    envMod: 3800,
    decay: 0.24,
    accent: 1.4,
  },
  "cubed-rubber-bass": {
    instrument: "cubed",
    waveform: "square",
    tuning: 0,
    cutoff: 240,
    resonance: 6.0,
    envMod: 1400,
    decay: 0.35,
    accent: 1.2,
  },
  "cubed-squelch-lead": {
    instrument: "cubed",
    waveform: "sawtooth",
    tuning: 1200,
    cutoff: 600,
    resonance: 22.0,
    envMod: 5400,
    decay: 0.18,
    accent: 1.6,
  },
  // --- Pluck Karplus-Strong Presets ---
  "pluck-guitarish": {
    instrument: "pluck",
    preset: "guitarish",
    tone: 0.7,
    decay: 0.45,
    drive: 1.05,
    width: 0.7,
  },
  "pluck-koto-dark": {
    instrument: "pluck",
    preset: "koto_dark",
    tone: 0.4,
    decay: 0.28,
    drive: 1.1,
    width: 0.9,
  },
  "pluck-short-bell": {
    instrument: "pluck",
    preset: "short_bell",
    tone: 0.9,
    decay: 0.2,
    drive: 1.2,
    width: 0.6,
  },
  "pluck-dark-pluck": {
    instrument: "pluck",
    preset: "dark_pluck",
    tone: 0.45,
    decay: 0.3,
    drive: 1.15,
    width: 0.75,
  },
  // --- Tubular DX7 6-Op FM Presets ---
  "tubular-electric-piano": {
    instrument: "tubular",
    algorithm: 5,
    feedback: 4.0,
    modIndex: 2.2,
    attack: 0.005,
    decay: 0.8,
    sustain: 0.3,
    release: 0.4,
  },
  "tubular-tubular-bell": {
    instrument: "tubular",
    algorithm: 1,
    feedback: 6.0,
    modIndex: 4.5,
    attack: 0.002,
    decay: 1.4,
    sustain: 0.1,
    release: 0.8,
  },
  "tubular-solid-bass": {
    instrument: "tubular",
    algorithm: 16,
    feedback: 5.0,
    modIndex: 3.0,
    attack: 0.008,
    decay: 0.35,
    sustain: 0.4,
    release: 0.15,
  },
  // --- Neon Casio CZ-101 Phase Distortion Presets ---
  "neon-cz-glass-keys": {
    instrument: "neon",
    mode: "ring",
    wave1: "resonant-saw",
    wave2: "sine",
    dcw: 0.65,
    detune: 14,
    attack: 0.01,
    release: 0.45,
  },
  "neon-cz-resonant-lead": {
    instrument: "neon",
    mode: "normal",
    wave1: "resonant-saw",
    wave2: "saw",
    dcw: 0.8,
    detune: 8,
    attack: 0.02,
    release: 0.25,
  },
  "neon-cz-noise-sweep": {
    instrument: "neon",
    mode: "noise",
    wave1: "saw",
    wave2: "pulse",
    dcw: 0.5,
    detune: 20,
    attack: 0.15,
    release: 0.6,
  },
  // --- Noise Pad Atmospheric Presets ---
  "noise-air-pad": {
    instrument: "noise-pad",
    preset: "air_pad",
    attack: 0.7,
    decay: 0.6,
    sustain: 0.75,
    release: 0.9,
    tone: 0.42,
    texture: 0.15,
    width: 1.0,
  },
  "noise-vinyl-hiss-pad": {
    instrument: "noise-pad",
    preset: "vinyl_hiss_pad",
    attack: 0.25,
    decay: 0.5,
    sustain: 0.55,
    release: 0.8,
    tone: 0.28,
    texture: 0.65,
    width: 0.85,
  },
  "noise-dark-wind": {
    instrument: "noise-pad",
    preset: "dark_wind",
    attack: 0.9,
    decay: 0.7,
    sustain: 0.6,
    release: 1.2,
    tone: 0.18,
    texture: 0.35,
    width: 1.1,
  },
  // --- Korpus Physical Modeling Presets ---
  "korpus-marimba-strike": {
    instrument: "korpus",
    exciter: "strike",
    intensity: 0.7,
    materialA: "marimba",
    materialB: "off",
    coupling: 0.0,
    damping: 0.45,
  },
  "korpus-bowed-glass": {
    instrument: "korpus",
    exciter: "bow",
    intensity: 0.65,
    materialA: "bell",
    materialB: "plate",
    coupling: 0.4,
    damping: 0.25,
  },
  "korpus-pan-flute": {
    instrument: "korpus",
    exciter: "wind",
    intensity: 0.6,
    materialA: "wire",
    materialB: "off",
    coupling: 0.0,
    damping: 0.35,
  },
  // --- Nano Micro-Sampler Presets ---
  "nano-vocal-chop": {
    instrument: "nano",
    rootKey: 60,
    attack: 0.005,
    release: 0.15,
    loop: false,
    reverse: false,
  },
  "nano-lofi-keys": {
    instrument: "nano",
    rootKey: 60,
    attack: 0.015,
    release: 0.35,
    loop: false,
    reverse: false,
  },
  // --- SoundFont General MIDI Presets ---
  "soundfont-grand-piano": {
    instrument: "soundfont",
    bank: 0,
    program: 0,
    channel: 0,
  },
  "soundfont-violin": {
    instrument: "soundfont",
    bank: 0,
    program: 40,
    channel: 0,
  },
  "soundfont-acoustic-guitar": {
    instrument: "soundfont",
    bank: 0,
    program: 24,
    channel: 0,
  },
  "soundfont-trumpet": {
    instrument: "soundfont",
    bank: 0,
    program: 56,
    channel: 0,
  },
});

export const GENRE_TEMPLATES = Object.freeze({
  "techno-bass": {
    bpm: 132,
    signature: [4, 4],
    lengthBars: 2,
    swing: 0,
  },
  pop: {
    bpm: 118,
    signature: [4, 4],
    lengthBars: 2,
    swing: 0.08,
  },
  house: {
    bpm: 124,
    signature: [4, 4],
    lengthBars: 2,
    swing: 0.15,
  },
  trap: {
    bpm: 140,
    signature: [4, 4],
    lengthBars: 2,
    swing: 0,
  },
  synthwave: {
    bpm: 110,
    signature: [4, 4],
    lengthBars: 2,
    swing: 0,
  },
  acid: {
    bpm: 135,
    signature: [4, 4],
    lengthBars: 2,
    swing: 0,
  },
  ambient: {
    bpm: 75,
    signature: [4, 4],
    lengthBars: 2,
    swing: 0,
  },
});

export function generateGenrePattern(genre = "techno-bass") {
  const g = GENRE_TEMPLATES[genre] || GENRE_TEMPLATES["techno-bass"];
  const numSteps = (g.lengthBars || 2) * 16;

  const drumsTrack = {
    id: "trk_drums",
    name: "Drums",
    kind: "drums",
    volume: 0.85,
    pan: 0,
    mute: false,
    solo: false,
    params: {},
    notes: [],
  };

  const bassInstrument =
    genre === "trap"
      ? "808"
      : genre === "acid"
        ? "cubed"
        : genre === "ambient"
          ? "noise-pad"
          : "synth";

  const bassPresetKey =
    genre === "trap"
      ? "clean-808"
      : genre === "acid"
        ? "cubed-acid-classic"
        : genre === "ambient"
          ? "noise-air-pad"
          : genre === "techno-bass"
            ? "techno-bass"
            : "init-saw";

  const melodicInstrument =
    genre === "trap"
      ? "pluck"
      : genre === "ambient"
        ? "korpus"
        : genre === "synthwave"
          ? "neon"
          : "synth";

  const melodicPresetKey =
    genre === "trap"
      ? "pluck-guitarish"
      : genre === "ambient"
        ? "korpus-bowed-glass"
        : genre === "pop"
          ? "pop-pluck"
          : genre === "synthwave"
            ? "neon-cz-glass-keys"
            : "supersaw-lead";

  const bassTrack = {
    id: "trk_bass",
    name: genre === "trap" ? "808 Sub" : genre === "acid" ? "303 Acid" : "Bass",
    kind: "synth",
    instrument: bassInstrument,
    defaultPitch: 36,
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    params: {
      ...(INSTRUMENT_PRESETS[bassPresetKey] ||
        INSTRUMENT_PRESETS["techno-bass"]),
    },
    notes: [],
  };

  const melodicTrack = {
    id: "trk_lead",
    name:
      genre === "pop"
        ? "Pluck"
        : genre === "trap"
          ? "Guitar Pluck"
          : genre === "ambient"
            ? "Bowed Glass"
            : "Lead",
    kind: "synth",
    instrument: melodicInstrument,
    defaultPitch: 60,
    volume: 0.72,
    pan: 0.15,
    mute: false,
    solo: false,
    params: {
      ...(INSTRUMENT_PRESETS[melodicPresetKey] ||
        INSTRUMENT_PRESETS["supersaw-lead"]),
    },
    notes: [],
  };

  if (genre === "techno-bass") {
    // 4-on-the-floor kick
    for (let s = 0; s < numSteps; s += 4) {
      drumsTrack.notes.push({
        position: stepToPpqn(s),
        duration: 240,
        pitch: 36,
        velocity: 1.0,
      });
    }
    // Off-beat open hats (steps 2, 6, 10, 14...)
    for (let s = 2; s < numSteps; s += 4) {
      drumsTrack.notes.push({
        position: stepToPpqn(s),
        duration: 240,
        pitch: 46,
        velocity: 0.75,
      });
    }
    // Rolling 16th closed hats (steps 1, 3, 5, 7...)
    for (let s = 0; s < numSteps; s++) {
      if (s % 2 === 1) {
        drumsTrack.notes.push({
          position: stepToPpqn(s),
          duration: 120,
          pitch: 42,
          velocity: 0.5,
        });
      }
    }
    // Clap on 4 and 12
    for (let b = 0; b < g.lengthBars; b++) {
      const base = b * 16;
      drumsTrack.notes.push({
        position: stepToPpqn(base + 4),
        duration: 240,
        pitch: 39,
        velocity: 0.85,
      });
      drumsTrack.notes.push({
        position: stepToPpqn(base + 12),
        duration: 240,
        pitch: 39,
        velocity: 0.85,
      });
    }
    // 16th rolling techno bassline in D minor (D1 = 26, D2 = 38, F2 = 41, G2 = 43)
    const bassRhythm = [
      { step: 1, pitch: 38, vel: 0.85 },
      { step: 2, pitch: 38, vel: 0.9 },
      { step: 3, pitch: 38, vel: 0.85 },
      { step: 5, pitch: 38, vel: 0.85 },
      { step: 6, pitch: 38, vel: 0.9 },
      { step: 7, pitch: 41, vel: 0.85 }, // F2
      { step: 9, pitch: 38, vel: 0.85 },
      { step: 10, pitch: 38, vel: 0.9 },
      { step: 11, pitch: 38, vel: 0.85 },
      { step: 13, pitch: 43, vel: 0.9 }, // G2
      { step: 14, pitch: 41, vel: 0.85 },
      { step: 15, pitch: 38, vel: 0.8 },
    ];
    for (let b = 0; b < g.lengthBars; b++) {
      const base = b * 16;
      for (const n of bassRhythm) {
        bassTrack.notes.push({
          position: stepToPpqn(base + n.step),
          duration: 200,
          pitch: n.pitch,
          velocity: n.vel,
        });
      }
    }
  } else if (genre === "pop" || genre === "house" || genre === "synthwave") {
    // Standard Pop / Starter pattern
    for (let b = 0; b < g.lengthBars; b++) {
      const base = b * 16;
      // Kick on 0, 8, 10
      drumsTrack.notes.push({
        position: stepToPpqn(base + 0),
        duration: 240,
        pitch: 36,
        velocity: 1.0,
      });
      drumsTrack.notes.push({
        position: stepToPpqn(base + 8),
        duration: 240,
        pitch: 36,
        velocity: 0.9,
      });
      drumsTrack.notes.push({
        position: stepToPpqn(base + 10),
        duration: 240,
        pitch: 36,
        velocity: 0.85,
      });
      // Snare on 4 and 12
      drumsTrack.notes.push({
        position: stepToPpqn(base + 4),
        duration: 240,
        pitch: 38,
        velocity: 0.9,
      });
      drumsTrack.notes.push({
        position: stepToPpqn(base + 12),
        duration: 240,
        pitch: 38,
        velocity: 0.9,
      });
      // 8th hats
      for (let s = 0; s < 16; s += 2) {
        drumsTrack.notes.push({
          position: stepToPpqn(base + s),
          duration: 200,
          pitch: 42,
          velocity: s % 4 === 0 ? 0.7 : 0.55,
        });
      }
      // Bass syncopated
      bassTrack.notes.push({
        position: stepToPpqn(base + 0),
        duration: 480,
        pitch: 36, // C2
        velocity: 0.9,
      });
      bassTrack.notes.push({
        position: stepToPpqn(base + 6),
        duration: 360,
        pitch: 36,
        velocity: 0.8,
      });
      bassTrack.notes.push({
        position: stepToPpqn(base + 10),
        duration: 360,
        pitch: 39, // Eb2
        velocity: 0.85,
      });
      bassTrack.notes.push({
        position: stepToPpqn(base + 14),
        duration: 240,
        pitch: 41, // F2
        velocity: 0.85,
      });
      // Melodic Pluck notes
      melodicTrack.notes.push({
        position: stepToPpqn(base + 2),
        duration: 240,
        pitch: 60, // C4
        velocity: 0.75,
      });
      melodicTrack.notes.push({
        position: stepToPpqn(base + 6),
        duration: 240,
        pitch: 63, // Eb4
        velocity: 0.8,
      });
      melodicTrack.notes.push({
        position: stepToPpqn(base + 10),
        duration: 240,
        pitch: 67, // G4
        velocity: 0.85,
      });
      melodicTrack.notes.push({
        position: stepToPpqn(base + 14),
        duration: 240,
        pitch: 70, // Bb4
        velocity: 0.8,
      });
    }
  } else if (genre === "acid") {
    for (let b = 0; b < g.lengthBars; b++) {
      const base = b * 16;
      // 4-on-the-floor kick
      for (let s = 0; s < 16; s += 4) {
        drumsTrack.notes.push({
          position: stepToPpqn(base + s),
          duration: 240,
          pitch: 36,
          velocity: 1.0,
        });
      }
      // Offbeat open hats
      for (let s = 2; s < 16; s += 4) {
        drumsTrack.notes.push({
          position: stepToPpqn(base + s),
          duration: 200,
          pitch: 46,
          velocity: 0.8,
        });
      }
      // Clap on 4 and 12
      drumsTrack.notes.push({
        position: stepToPpqn(base + 4),
        duration: 240,
        pitch: 39,
        velocity: 0.85,
      });
      drumsTrack.notes.push({
        position: stepToPpqn(base + 12),
        duration: 240,
        pitch: 39,
        velocity: 0.85,
      });

      // 303 Acid line with accents and slides
      const acidNotes = [
        { step: 0, pitch: 36, accent: true },
        { step: 1, pitch: 36, accent: false },
        { step: 2, pitch: 48, accent: false },
        { step: 3, pitch: 39, accent: true },
        { step: 5, pitch: 36, accent: false },
        { step: 6, pitch: 41, accent: true },
        { step: 7, pitch: 42, accent: false },
        { step: 8, pitch: 36, accent: true },
        { step: 10, pitch: 48, accent: true },
        { step: 12, pitch: 36, accent: true },
        { step: 14, pitch: 39, accent: false },
        { step: 15, pitch: 38, accent: false },
      ];
      for (const an of acidNotes) {
        bassTrack.notes.push({
          position: stepToPpqn(base + an.step),
          duration: 240,
          pitch: an.pitch,
          velocity: an.accent ? 1.0 : 0.75,
          accent: an.accent,
        });
      }
    }
  } else if (genre === "trap") {
    for (let b = 0; b < g.lengthBars; b++) {
      const base = b * 16;
      // Trap Kick
      drumsTrack.notes.push({
        position: stepToPpqn(base + 0),
        duration: 240,
        pitch: 36,
        velocity: 1.0,
      });
      drumsTrack.notes.push({
        position: stepToPpqn(base + 10),
        duration: 240,
        pitch: 36,
        velocity: 0.9,
      });
      // Half-time Snare on 8
      drumsTrack.notes.push({
        position: stepToPpqn(base + 8),
        duration: 240,
        pitch: 38,
        velocity: 0.95,
      });
      // Fast rolling hi-hats
      for (let s = 0; s < 16; s++) {
        drumsTrack.notes.push({
          position: stepToPpqn(base + s),
          duration: 120,
          pitch: 42,
          velocity: s % 2 === 0 ? 0.75 : 0.5,
        });
      }
      // 808 Sub with glide
      bassTrack.notes.push({
        position: stepToPpqn(base + 0),
        duration: 960,
        pitch: 36, // C2
        velocity: 1.0,
      });
      bassTrack.notes.push({
        position: stepToPpqn(base + 10),
        duration: 720,
        pitch: 39, // Eb2
        velocity: 0.9,
      });
      // Melodic Pluck
      melodicTrack.notes.push({
        position: stepToPpqn(base + 2),
        duration: 360,
        pitch: 63,
        velocity: 0.8,
      });
      melodicTrack.notes.push({
        position: stepToPpqn(base + 6),
        duration: 360,
        pitch: 67,
        velocity: 0.85,
      });
      melodicTrack.notes.push({
        position: stepToPpqn(base + 12),
        duration: 480,
        pitch: 70,
        velocity: 0.8,
      });
    }
  } else if (genre === "ambient") {
    for (let b = 0; b < g.lengthBars; b++) {
      const base = b * 16;
      // Soft ride / chime
      drumsTrack.notes.push({
        position: stepToPpqn(base + 0),
        duration: 480,
        pitch: 51,
        velocity: 0.4,
      });
      drumsTrack.notes.push({
        position: stepToPpqn(base + 8),
        duration: 480,
        pitch: 51,
        velocity: 0.35,
      });

      // Atmospheric Noise Pad chords
      bassTrack.notes.push({
        position: stepToPpqn(base + 0),
        duration: 1920,
        pitch: 36,
        velocity: 0.7,
      });
      bassTrack.notes.push({
        position: stepToPpqn(base + 0),
        duration: 1920,
        pitch: 43,
        velocity: 0.65,
      });

      // Korpus bowed glass bells
      melodicTrack.notes.push({
        position: stepToPpqn(base + 4),
        duration: 960,
        pitch: 67,
        velocity: 0.6,
      });
      melodicTrack.notes.push({
        position: stepToPpqn(base + 12),
        duration: 960,
        pitch: 72,
        velocity: 0.65,
      });
    }
  }

  return {
    version: 1,
    name: `${genre.charAt(0).toUpperCase() + genre.slice(1)} Groove`,
    bpm: g.bpm,
    signature: g.signature,
    lengthBars: g.lengthBars,
    swing: g.swing,
    master: { volume: 0.8 },
    tracks: [drumsTrack, bassTrack, melodicTrack],
  };
}
