/**
 * .agents/scripts/scdaw-presets.js
 *
 * Curated synthesizer presets, drum kits, and genre-specific multi-track pattern generators.
 */

import { PPQN, stepToPpqn } from "./scdaw.js";

export const INSTRUMENT_PRESETS = Object.freeze({
  "init-saw": {
    waveform: "sawtooth",
    cutoff: 1200,
    resonance: 2.0,
    filterEnvAmount: 1000,
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
    cutoff: 3800,
    resonance: 2.8,
    filterEnvAmount: 2200,
    filterDecay: 0.25,
    attack: 0.01,
    decay: 0.3,
    sustain: 0.65,
    release: 0.2,
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

  const bassTrack = {
    id: "trk_bass",
    name: "Bass",
    kind: "synth",
    defaultPitch: 36,
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    params: {
      ...(INSTRUMENT_PRESETS[
        genre === "techno-bass" ? "techno-bass" : "init-saw"
      ] || INSTRUMENT_PRESETS["techno-bass"]),
    },
    notes: [],
  };

  const melodicTrack = {
    id: "trk_lead",
    name: genre === "pop" ? "Pluck" : "Lead",
    kind: "synth",
    defaultPitch: 60,
    volume: 0.72,
    pan: 0.15,
    mute: false,
    solo: false,
    params: {
      ...(genre === "pop"
        ? INSTRUMENT_PRESETS["pop-pluck"]
        : genre === "synthwave"
          ? INSTRUMENT_PRESETS["warm-pad"]
          : INSTRUMENT_PRESETS["supersaw-lead"]),
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
  } else {
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
