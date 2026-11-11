// Ported concepts from claw-daw (MIT, © 2026 soya) and openDAW packages/lib/dsp (AGPL-3.0, © André Michelle)
/**
 * .agents/scripts/scdaw-compose.js
 *
 * High-level song composition engine: compiles structured SongSpec descriptions
 * (sections, chord progressions, genre feel, energy curves, and instrumentation)
 * into complete multi-bar, multi-track ShadowClaw DAW projects.
 * Zero DOM and zero Web Audio dependencies.
 */

import { PPQN, barPulses, beatsPerBar } from "./scdaw.js";
import { resolveGmProgram } from "./scdaw-soundfont.js";

// --- Music Theory Constants (openDAW & claw-daw) ---

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const NOTE_TO_SEMITONE = {
  C: 0,
  "B#": 0,
  "C#": 1,
  DB: 1,
  D: 2,
  "D#": 3,
  EB: 3,
  E: 4,
  FB: 4,
  F: 5,
  "E#": 5,
  "F#": 6,
  GB: 6,
  G: 7,
  "G#": 8,
  AB: 8,
  A: 9,
  "A#": 10,
  BB: 10,
  B: 11,
  CB: 11,
};

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  blues: [0, 3, 5, 6, 7, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
};

export const CHORD_INTERVALS = {
  major: [0, 4, 7],
  "": [0, 4, 7],
  5: [0, 7], // power chord
  m: [0, 3, 7],
  min: [0, 3, 7],
  minor: [0, 3, 7],
  7: [0, 4, 7, 10], // dominant 7
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  add9: [0, 4, 7, 14],
  9: [0, 4, 7, 10, 14],
};

export const STYLE_PRESETS = Object.freeze({
  "straight-rock": {
    feel: "straight-rock",
    defaultBpm: 122,
    mode: "mixolydian",
    drumKit: "rock-kit",
    bassType: "rock-groove",
    swing: 0.0,
  },
  "blues-rock": {
    feel: "blues-rock",
    defaultBpm: 118,
    mode: "blues",
    drumKit: "rock-kit",
    bassType: "walking",
    swing: 0.12,
  },
  funk: {
    feel: "funk",
    defaultBpm: 108,
    mode: "dorian",
    drumKit: "funk-kit",
    bassType: "syncopated",
    swing: 0.15,
  },
  house: {
    feel: "four-on-floor",
    defaultBpm: 124,
    mode: "minor",
    drumKit: "house-kit",
    bassType: "offbeat",
    swing: 0.08,
  },
  trap: {
    feel: "trap",
    defaultBpm: 140,
    mode: "minor",
    drumKit: "trap-kit",
    bassType: "sub-808",
    swing: 0.0,
  },
  lofi: {
    feel: "lofi",
    defaultBpm: 84,
    mode: "dorian",
    drumKit: "lofi-kit",
    bassType: "laidback",
    swing: 0.22,
  },
});

// Simple Mulberry32 deterministic pseudo-random number generator
export function createRng(seed = 42) {
  let s = Math.floor(Math.abs(Number(seed) || 42)) + 1;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Parses a chord symbol (e.g. "E", "Am7", "B/D#", "G7", "E5")
 * into root MIDI number, constituent pitches, and bass note.
 */
export function parseChord(chordStr, baseOctave = 4) {
  if (!chordStr || typeof chordStr !== "string") {
    return {
      rootName: "C",
      root: 60,
      pitches: [60, 64, 67],
      bass: 36,
      quality: "major",
    };
  }

  const raw = chordStr.trim();
  const [mainPart, slashBass] = raw.split("/");

  // Regex matches note name (A-G with optional # or b) and quality suffix
  const match = mainPart.match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!match) {
    return {
      rootName: "C",
      root: 60,
      pitches: [60, 64, 67],
      bass: 36,
      quality: "major",
    };
  }

  const rootName = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  const rootSemi = NOTE_TO_SEMITONE[rootName.toUpperCase()] ?? 0;
  const quality = match[2].trim().toLowerCase();

  const intervals = CHORD_INTERVALS[quality] || CHORD_INTERVALS["major"];
  const rootPitch = (baseOctave + 1) * 12 + rootSemi;

  const pitches = intervals.map((interval) => rootPitch + interval);

  let bassPitch;
  if (slashBass) {
    const bassName = slashBass.trim().toUpperCase();
    const bassSemi = NOTE_TO_SEMITONE[bassName] ?? rootSemi;
    bassPitch = 48 + bassSemi; // Bass octave 3 (e.g. D#3 = 51)
  } else {
    bassPitch = 36 + rootSemi; // Bass octave 2 (e.g. E2 = 40, C2 = 36)
  }

  return {
    rootName,
    root: rootPitch,
    pitches,
    bass: bassPitch,
    quality: quality || "major",
  };
}

/**
 * Parses a chord progression string (bar-delimited or space-separated)
 * into an array of chord definitions. Supports multiple chords per bar (e.g. "F Bb | C Bb").
 */
export function parseProgression(progStr, baseOctave = 4) {
  if (!progStr || typeof progStr !== "string") {
    const defaultChord = parseChord("C", baseOctave);
    defaultChord.chordsInBar = [defaultChord];
    return [defaultChord];
  }

  let tokens;
  if (progStr.includes("|")) {
    tokens = progStr.split("|");
  } else if (progStr.includes("-")) {
    tokens = progStr.split("-");
  } else {
    tokens = progStr.split(/\s+/);
  }

  const cleaned = tokens.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    const defaultChord = parseChord("C", baseOctave);
    defaultChord.chordsInBar = [defaultChord];
    return [defaultChord];
  }

  return cleaned.map((barText) => {
    const chordTokens = barText.split(/\s+/).filter(Boolean);
    if (chordTokens.length > 1) {
      const parsedChords = chordTokens.map((c) => parseChord(c, baseOctave));
      const primary = { ...parsedChords[0] };
      primary.chordsInBar = parsedChords;
      return primary;
    }
    const single = parseChord(barText, baseOctave);
    single.chordsInBar = [single];
    return single;
  });
}

/**
 * Generates drum notes for a given section.
 * Includes crash downbeat, backbeat kick/snare, closed/open hats, and boundary fills.
 */
function generateDrumsForSection(
  sectionStartPulse,
  sectionBars,
  energy = 0.7,
  feel = "straight-rock",
  rng,
  isSongStart = false,
) {
  const notes = [];
  const barPulseCount = PPQN.Bar;
  const quarter = PPQN.Quarter;
  const sixteenth = PPQN.SemiQuaver;

  const isShuffle =
    feel.includes("shuffle") ||
    feel.includes("blues") ||
    feel === "blues-rock" ||
    feel === "lofi";

  // Downbeat crash cymbal (pitch 49) at the very start of a section with higher energy or song start
  if (isSongStart || energy >= 0.6) {
    notes.push({
      position: sectionStartPulse,
      duration: quarter * 2,
      pitch: 49, // Crash Cymbal 1
      velocity: 0.9 + rng() * 0.1,
    });
  }

  for (let b = 0; b < sectionBars; b++) {
    const barOffset = sectionStartPulse + b * barPulseCount;
    const isLastBar = b === sectionBars - 1;

    if (isShuffle) {
      // Swung eighth-note shuffle hat pattern (steps 0, 2, 4, 6, 8, 10, 12, 14)
      for (let s = 0; s < 16; s += 2) {
        if (isLastBar && s >= 12 && energy >= 0.5) continue;
        const hatPos = barOffset + s * sixteenth;
        const isQuarter = s % 4 === 0;
        let hatPitch = 42; // Closed Hat
        let hatVel = isQuarter ? 0.75 + rng() * 0.15 : 0.55 + rng() * 0.1;

        if ((s === 6 || s === 14) && rng() < 0.25 * energy) {
          hatPitch = 46; // Open Hat accent
          hatVel += 0.15;
        }

        notes.push({
          position: hatPos,
          duration: sixteenth * 2,
          pitch: hatPitch,
          velocity: Math.min(1.0, hatVel),
        });
      }
    } else {
      // 16th hat pattern across the bar
      for (let s = 0; s < 16; s++) {
        const hatPos = barOffset + s * sixteenth;
        // Skip the last 4 16ths if playing a fill on the last bar
        if (isLastBar && s >= 12 && energy >= 0.5) continue;

        const isQuarter = s % 4 === 0;
        const isEighth = s % 2 === 0;
        let hatPitch = 42; // Closed Hat
        let hatVel = 0.55 + rng() * 0.15;

        if (isQuarter) {
          hatVel += 0.2;
        } else if (isEighth) {
          hatVel += 0.1;
        }

        // Open hat accents on offbeats occasionally
        if (s === 2 || s === 6 || s === 10 || s === 14) {
          if (rng() < 0.25 * energy) {
            hatPitch = 46; // Open Hat
            hatVel += 0.15;
          }
        }

        notes.push({
          position: hatPos,
          duration: sixteenth,
          pitch: hatPitch,
          velocity: Math.min(1.0, hatVel),
        });
      }
    }

    if (isLastBar && energy >= 0.5) {
      // 1-bar ending drum fill (snare + toms buildup)
      notes.push({
        position: barOffset + 0,
        duration: quarter,
        pitch: 36,
        velocity: 0.95,
      }); // Kick
      notes.push({
        position: barOffset + quarter,
        duration: quarter,
        pitch: 38,
        velocity: 0.9,
      }); // Snare
      notes.push({
        position: barOffset + quarter * 2,
        duration: sixteenth * 2,
        pitch: 36,
        velocity: 0.95,
      }); // Kick
      notes.push({
        position: barOffset + quarter * 2 + sixteenth * 2,
        duration: sixteenth * 2,
        pitch: 48,
        velocity: 0.85,
      }); // High Tom

      // Rapid snare / tom turnaround on beat 4
      notes.push({
        position: barOffset + quarter * 3,
        duration: sixteenth,
        pitch: 38,
        velocity: 0.95,
      });
      notes.push({
        position: barOffset + quarter * 3 + sixteenth,
        duration: sixteenth,
        pitch: 38,
        velocity: 0.9,
      });
      notes.push({
        position: barOffset + quarter * 3 + sixteenth * 2,
        duration: sixteenth,
        pitch: 45,
        velocity: 0.95,
      }); // Mid Tom
      notes.push({
        position: barOffset + quarter * 3 + sixteenth * 3,
        duration: sixteenth,
        pitch: 41,
        velocity: 1.0,
      }); // Low Tom
    } else {
      // Standard rock groove:
      // Kick on Beat 1 (0) and Beat 3 (quarter * 2), plus optional push on 3.5
      notes.push({
        position: barOffset + 0,
        duration: quarter,
        pitch: 36,
        velocity: 0.95 + rng() * 0.05,
      });
      notes.push({
        position: barOffset + quarter * 2,
        duration: quarter,
        pitch: 36,
        velocity: 0.9 + rng() * 0.05,
      });

      if (energy >= 0.7 && rng() < 0.6) {
        notes.push({
          position: barOffset + quarter * 2 + sixteenth * 2,
          duration: sixteenth * 2,
          pitch: 36,
          velocity: 0.85,
        });
      }

      // Snare backbeat on Beat 2 (quarter) and Beat 4 (quarter * 3)
      notes.push({
        position: barOffset + quarter,
        duration: quarter,
        pitch: 38,
        velocity: 0.95 + rng() * 0.05,
      });
      notes.push({
        position: barOffset + quarter * 3,
        duration: quarter,
        pitch: 38,
        velocity: 0.95 + rng() * 0.05,
      });

      // Ghost notes on snare for funk/shuffle groove
      if (feel.includes("shuffle") || feel.includes("funk")) {
        notes.push({
          position: barOffset + quarter + sixteenth * 2,
          duration: sixteenth,
          pitch: 38,
          velocity: 0.45,
        });
      }
    }
  }

  return notes;
}

/**
 * Generates bass notes locked to chord roots, kicking with the drum rhythm.
 * Supports bars with multiple chords (e.g. 2 chords per bar).
 */
function generateBassForSection(
  sectionStartPulse,
  sectionBars,
  chords,
  energy = 0.7,
  feel = "straight-rock",
  rng,
) {
  const notes = [];
  const barPulseCount = PPQN.Bar;
  const quarter = PPQN.Quarter;
  const sixteenth = PPQN.SemiQuaver;

  for (let b = 0; b < sectionBars; b++) {
    const barOffset = sectionStartPulse + b * barPulseCount;
    const barChord = chords[b % chords.length] || chords[0];
    const barChords = barChord.chordsInBar || [barChord];

    if (barChords.length >= 2) {
      // Multi-chord bar (e.g. F Bb): allocate chords across the bar
      const subLength = barChords.length === 2 ? 2 : 1; // beats per chord
      for (let cIdx = 0; cIdx < barChords.length && cIdx < 4; cIdx++) {
        const c = barChords[cIdx];
        const rootBass = c.bass || 40;
        const subOffset = barOffset + cIdx * subLength * quarter;

        // Downbeat of chord
        notes.push({
          position: subOffset + 0,
          duration: Math.round(quarter * 0.9),
          pitch: rootBass,
          velocity: 0.9,
        });

        if (subLength === 2) {
          // Second beat of 2-beat chord: play root, 5th, or octave
          const beat2Pitch =
            rng() < 0.4 ? rootBass + 7 : rng() < 0.3 ? rootBass + 12 : rootBass;
          notes.push({
            position: subOffset + quarter,
            duration: Math.round(quarter * 0.8),
            pitch: beat2Pitch,
            velocity: 0.82,
          });
        }
      }
    } else {
      // Single chord across the entire bar
      const rootBass = barChord.bass || 40;

      // Beat 1: Root note
      notes.push({
        position: barOffset + 0,
        duration: Math.round(quarter * 0.9),
        pitch: rootBass,
        velocity: 0.9,
      });

      // Beat 2: Root octave or fifth
      const beat2Pitch = rng() < 0.3 ? rootBass + 12 : rootBass;
      notes.push({
        position: barOffset + quarter,
        duration: Math.round(quarter * 0.8),
        pitch: beat2Pitch,
        velocity: 0.8,
      });

      // Beat 3: Sync with kick (root or 5th)
      const fifthPitch = rootBass + 7;
      const beat3Pitch = rng() < 0.4 ? fifthPitch : rootBass;
      notes.push({
        position: barOffset + quarter * 2,
        duration: Math.round(quarter * 0.9),
        pitch: beat3Pitch,
        velocity: 0.85,
      });

      // Beat 4: Passing tone to next chord
      const nextBarChord = chords[(b + 1) % chords.length] || chords[0];
      const nextRoot =
        (nextBarChord.chordsInBar?.[0] || nextBarChord).bass || 40;
      let passingPitch = rootBass;
      if (nextRoot > rootBass) {
        passingPitch = nextRoot - 1; // Leading tone from below
      } else if (nextRoot < rootBass) {
        passingPitch = nextRoot + 1; // Passing tone from above
      }

      notes.push({
        position: barOffset + quarter * 3,
        duration: Math.round(quarter * 0.75),
        pitch: passingPitch,
        velocity: 0.78,
      });
    }
  }

  return notes;
}

/**
 * Generates rhythm guitar / keyboard chord comping with strum offsets.
 * Respects sub-bar chord changes.
 */
function generateCompingForSection(
  sectionStartPulse,
  sectionBars,
  chords,
  energy = 0.7,
  feel = "straight-rock",
  rng,
) {
  const notes = [];
  const barPulseCount = PPQN.Bar;
  const quarter = PPQN.Quarter;
  const sixteenth = PPQN.SemiQuaver;

  for (let b = 0; b < sectionBars; b++) {
    const barOffset = sectionStartPulse + b * barPulseCount;
    const barChord = chords[b % chords.length] || chords[0];
    const barChords = barChord.chordsInBar || [barChord];

    // Rhythm comping: strum on beats 1, 2, 3, 4
    const strumRhythms = [0, quarter, quarter * 2, quarter * 3];

    for (let sIdx = 0; sIdx < strumRhythms.length; sIdx++) {
      const strumPos = strumRhythms[sIdx];
      let activeChord = barChords[0];
      if (barChords.length === 2) {
        activeChord = sIdx < 2 ? barChords[0] : barChords[1];
      } else if (barChords.length >= 3) {
        activeChord = barChords[sIdx % barChords.length];
      }
      const pitches = activeChord.pitches || [60, 64, 67];

      // Downstroke vs Upstroke alternation
      const isUpstroke = strumPos === quarter || strumPos === quarter * 3;
      const orderedPitches = isUpstroke ? [...pitches].reverse() : [...pitches];
      const strumOffsetTicks = 12; // ~15ms spread at 120bpm

      for (let i = 0; i < orderedPitches.length; i++) {
        const notePitch = orderedPitches[i];
        const notePos = barOffset + strumPos + i * strumOffsetTicks;
        notes.push({
          position: notePos,
          duration: Math.round(quarter * 0.85),
          pitch: notePitch,
          velocity: Math.min(1.0, 0.75 + rng() * 0.1),
        });
      }
    }
  }

  return notes;
}

export function parseMotif(motifStr, defaultOctave = 4) {
  if (!motifStr || typeof motifStr !== "string") return [];
  const tokens = motifStr.trim().split(/\s+/);
  const notes = [];
  let relPulse = 0;

  for (const token of tokens) {
    const [notePart, durPart] = token.split(":");
    let durTicks = PPQN.Quarter;
    if (durPart) {
      if (durPart === "16") durTicks = PPQN.SemiQuaver;
      else if (durPart === "8")
        durTicks = Math.round(PPQN.Quarter / 2); // 480
      else if (durPart === "4" || durPart === "q")
        durTicks = PPQN.Quarter; // 960
      else if (durPart === "2" || durPart === "h")
        durTicks = PPQN.Quarter * 2; // 1920
      else if (durPart === "1" || durPart === "w")
        durTicks = PPQN.Bar; // 3840
      else if (durPart.endsWith("t")) {
        const base = parseInt(durPart, 10);
        if (base === 8) durTicks = Math.round((PPQN.Quarter * 2) / 3);
        else if (base === 16) durTicks = Math.round(PPQN.Quarter / 3);
      } else if (!isNaN(Number(durPart))) {
        const num = Number(durPart);
        if (num > 16) durTicks = num;
      }
    }

    if (
      notePart.toLowerCase() === "r" ||
      notePart === "_" ||
      notePart.toLowerCase() === "rest"
    ) {
      relPulse += durTicks;
      continue;
    }

    const match = notePart.match(/^([A-Ga-g][#b]?)([0-8])?$/);
    if (!match) {
      if (!isNaN(Number(notePart))) {
        const pitch = Number(notePart);
        notes.push({
          relPulse,
          pitch,
          duration: durTicks,
          velocity: 0.85,
        });
        relPulse += durTicks;
      }
      continue;
    }

    const noteName =
      match[1].charAt(0).toUpperCase() + match[1].slice(1).toUpperCase();
    const oct = match[2] !== undefined ? parseInt(match[2], 10) : defaultOctave;
    const semi = NOTE_TO_SEMITONE[noteName] ?? 0;
    const pitch = (oct + 1) * 12 + semi;

    notes.push({
      relPulse,
      pitch,
      duration: durTicks,
      velocity: 0.85,
    });
    relPulse += durTicks;
  }
  return notes;
}

function generateLeadForSection(
  sectionStartPulse,
  sectionBars,
  scale = "mixolydian",
  key = "E",
  energy = 0.8,
  rng,
) {
  const notes = [];
  const barPulseCount = PPQN.Bar;
  const quarter = PPQN.Quarter;
  const sixteenth = PPQN.SemiQuaver;
  const rootSemi = NOTE_TO_SEMITONE[key.toUpperCase()] ?? 4; // E
  const scaleIntervals = SCALES[scale] || SCALES.mixolydian;
  const basePitch = 60 + rootSemi; // E4 = 64

  for (let b = 0; b < sectionBars; b++) {
    const barOffset = sectionStartPulse + b * barPulseCount;
    if (energy >= 0.6) {
      const idx1 = Math.floor(rng() * scaleIntervals.length);
      const idx2 = Math.floor(rng() * scaleIntervals.length);
      const p1 = basePitch + scaleIntervals[idx1];
      const p2 = basePitch + scaleIntervals[idx2];

      notes.push({
        position: barOffset + quarter + sixteenth * 2,
        duration: sixteenth * 2,
        pitch: p1,
        velocity: 0.85 + rng() * 0.1,
      });
      notes.push({
        position: barOffset + quarter * 3,
        duration: quarter,
        pitch: p2,
        velocity: 0.9,
      });
    }
  }
  return notes;
}

/**
 * Compiles a high-level SongSpec into a complete ShadowClaw DAW project.
 */
export function compileSong(spec = {}) {
  const title = spec.title || "Untitled Song";
  const bpm = Number(spec.bpm) || 120;
  const signature = Array.isArray(spec.signature) ? spec.signature : [4, 4];
  const rng = createRng(spec.seed ?? 42);

  const sections =
    Array.isArray(spec.sections) && spec.sections.length > 0
      ? spec.sections
      : [
          { name: "verse", bars: 4, chords: "C | C | F | G", energy: 0.6 },
          { name: "chorus", bars: 4, chords: "F | G | C | C", energy: 0.85 },
        ];

  const form =
    Array.isArray(spec.form) && spec.form.length > 0
      ? spec.form
      : sections.map((s) => s.name);

  // Map sections by name
  const sectionMap = new Map();
  for (const s of sections) {
    sectionMap.set(s.name.toLowerCase(), {
      ...s,
      chordsParsed: parseProgression(s.chords || "C"),
      bars: Number(s.bars) || 4,
      energy: Number(s.energy ?? 0.7),
    });
  }

  const drumNotes = [];
  const bassNotes = [];
  const rhythmNotes = [];
  const leadNotes = [];

  const parsedMotifNotes =
    spec.motifs?.lead || spec.riffs?.lead
      ? parseMotif(spec.motifs?.lead || spec.riffs?.lead, 4)
      : [];
  const hasLead = Boolean(
    spec.instruments?.lead || spec.motifs?.lead || spec.riffs?.lead,
  );

  const parsedBassMotifNotes =
    spec.motifs?.bass || spec.riffs?.bass
      ? parseMotif(spec.motifs?.bass || spec.riffs?.bass, 2)
      : [];

  const parsedRhythmMotifNotes =
    spec.motifs?.rhythm || spec.riffs?.rhythm
      ? parseMotif(spec.motifs?.rhythm || spec.riffs?.rhythm, 4)
      : [];

  let currentPulse = 0;
  let totalBars = 0;

  for (let fIdx = 0; fIdx < form.length; fIdx++) {
    const secName = String(form[fIdx]).toLowerCase();
    const sec = sectionMap.get(secName) || {
      name: secName,
      bars: 4,
      energy: 0.7,
      chordsParsed: [parseChord("C")],
    };

    const isFirst = fIdx === 0;

    // 1. Drums
    const drums = generateDrumsForSection(
      currentPulse,
      sec.bars,
      sec.energy,
      spec.feel || "straight-rock",
      rng,
      isFirst,
    );
    drumNotes.push(...drums);

    // 2. Bass: custom riff motif if provided, otherwise procedural walker
    if (parsedBassMotifNotes.length > 0) {
      const motifDuration = parsedBassMotifNotes.reduce(
        (max, n) => Math.max(max, n.relPulse + n.duration),
        PPQN.Bar,
      );
      const sectionPulses = sec.bars * PPQN.Bar;
      let motifCursor = 0;
      while (motifCursor < sectionPulses) {
        for (const m of parsedBassMotifNotes) {
          if (motifCursor + m.relPulse < sectionPulses) {
            bassNotes.push({
              position: currentPulse + motifCursor + m.relPulse,
              duration: m.duration,
              pitch: m.pitch,
              velocity: m.velocity,
            });
          }
        }
        motifCursor += motifDuration;
      }
    } else {
      const bass = generateBassForSection(
        currentPulse,
        sec.bars,
        sec.chordsParsed,
        sec.energy,
        spec.feel || "straight-rock",
        rng,
      );
      bassNotes.push(...bass);
    }

    // 3. Rhythm Guitar / Keys: custom rhythm motif if provided, otherwise comping
    if (parsedRhythmMotifNotes.length > 0) {
      const motifDuration = parsedRhythmMotifNotes.reduce(
        (max, n) => Math.max(max, n.relPulse + n.duration),
        PPQN.Bar,
      );
      const sectionPulses = sec.bars * PPQN.Bar;
      let motifCursor = 0;
      while (motifCursor < sectionPulses) {
        for (const m of parsedRhythmMotifNotes) {
          if (motifCursor + m.relPulse < sectionPulses) {
            rhythmNotes.push({
              position: currentPulse + motifCursor + m.relPulse,
              duration: m.duration,
              pitch: m.pitch,
              velocity: m.velocity,
            });
          }
        }
        motifCursor += motifDuration;
      }
    } else {
      const rhythm = generateCompingForSection(
        currentPulse,
        sec.bars,
        sec.chordsParsed,
        sec.energy,
        spec.feel || "straight-rock",
        rng,
      );
      rhythmNotes.push(...rhythm);
    }

    // 4. Lead Guitar / Motif
    if (hasLead) {
      if (parsedMotifNotes.length > 0) {
        const motifDuration = parsedMotifNotes.reduce(
          (max, n) => Math.max(max, n.relPulse + n.duration),
          PPQN.Bar,
        );
        const sectionPulses = sec.bars * PPQN.Bar;
        let motifCursor = 0;
        while (motifCursor < sectionPulses) {
          for (const m of parsedMotifNotes) {
            if (motifCursor + m.relPulse < sectionPulses) {
              leadNotes.push({
                position: currentPulse + motifCursor + m.relPulse,
                duration: m.duration,
                pitch: m.pitch,
                velocity: m.velocity,
              });
            }
          }
          motifCursor += motifDuration;
        }
      } else {
        const lead = generateLeadForSection(
          currentPulse,
          sec.bars,
          spec.mode || "mixolydian",
          spec.key || "E",
          sec.energy,
          rng,
        );
        leadNotes.push(...lead);
      }
    }

    currentPulse += sec.bars * PPQN.Bar;
    totalBars += sec.bars;
  }

  const instruments = spec.instruments || {};
  const isSoundfont = spec.soundfontProfile !== "synth";

  const bassProgram = resolveGmProgram(
    instruments.bass || "electric-bass-finger",
  );
  const rhythmProgram = resolveGmProgram(
    instruments.rhythm || "overdriven-guitar",
  );
  const leadProgram = resolveGmProgram(instruments.lead || "distortion-guitar");

  const tracks = [
    {
      id: "trk_drums",
      name: "Drums",
      kind: "drums",
      instrument:
        isSoundfont && instruments.drums !== "synth"
          ? "soundfont"
          : "playfield",
      volume: 0.85,
      pan: 0.0,
      mute: false,
      solo: false,
      params:
        isSoundfont && instruments.drums !== "synth" ? { kit: "rock-kit" } : {},
      notes: drumNotes,
    },
    {
      id: "trk_bass",
      name: "Bass",
      kind: "synth",
      instrument:
        isSoundfont && instruments.bass !== "synth"
          ? "soundfont"
          : instruments.bass || "synth",
      volume: 0.85,
      pan: 0.0,
      mute: false,
      solo: false,
      params:
        isSoundfont && instruments.bass !== "synth"
          ? { program: bassProgram }
          : {
              waveform: "sawtooth",
              cutoff: 800,
              resonance: 2.0,
              attack: 0.01,
              decay: 0.25,
              sustain: 0.6,
              release: 0.15,
            },
      notes: bassNotes,
    },
    {
      id: "trk_rhythm",
      name: "Rhythm Guitar",
      kind: "synth",
      instrument:
        isSoundfont && instruments.rhythm !== "synth"
          ? "soundfont"
          : instruments.rhythm || "synth",
      volume: 0.75,
      pan: -0.25,
      mute: false,
      solo: false,
      sends: [{ busId: "sendA", amount: 0.18, enabled: true }],
      fx: [
        {
          type: "filter",
          name: "Guitar HPF",
          params: { type: "highpass", cutoff: 80, resonance: 0.7 },
        },
      ],
      params:
        isSoundfont && instruments.rhythm !== "synth"
          ? { program: rhythmProgram }
          : {
              waveform: "sawtooth",
              cutoff: 3500,
              resonance: 1.5,
              attack: 0.01,
              decay: 0.3,
              sustain: 0.5,
              release: 0.2,
            },
      notes: rhythmNotes,
    },
  ];

  if (hasLead || leadNotes.length > 0) {
    tracks.push({
      id: "trk_lead",
      name: "Lead Guitar",
      kind: "synth",
      instrument:
        isSoundfont && instruments.lead !== "synth"
          ? "soundfont"
          : instruments.lead || "synth",
      volume: 0.8,
      pan: 0.25,
      mute: false,
      solo: false,
      sends: [{ busId: "sendA", amount: 0.22, enabled: true }],
      fx: [
        {
          type: "filter",
          name: "Lead HPF",
          params: { type: "highpass", cutoff: 80, resonance: 0.7 },
        },
      ],
      params:
        isSoundfont && instruments.lead !== "synth"
          ? { program: leadProgram }
          : {
              waveform: "sawtooth",
              cutoff: 4200,
              resonance: 1.8,
              attack: 0.02,
              decay: 0.3,
              sustain: 0.6,
              release: 0.25,
            },
      notes: leadNotes,
    });
  }

  return {
    version: 1,
    name: title,
    bpm,
    signature,
    lengthBars: Math.max(1, totalBars),
    swing: spec.swing || 0,
    metronome: { enabled: false, volume: 0.8 },
    master: {
      volume: 0.8,
      limiter: {
        enabled: true,
        ceilingDb: -0.3,
        releaseMs: 50,
      },
    },
    loop: { enabled: false, startPulse: 0, endPulse: currentPulse },
    tracks,
  };
}
