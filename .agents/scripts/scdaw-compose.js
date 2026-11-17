// Ported concepts from claw-daw (MIT, © 2026 soya) and openDAW packages/lib/dsp (AGPL-3.0, © André Michelle)
/**
 * .agents/scripts/scdaw-compose.js
 *
 * High-level song composition engine: compiles structured SongSpec descriptions
 * (sections, chord progressions, genre feel, energy curves, and instrumentation)
 * into complete multi-bar, multi-track ShadowClaw DAW projects.
 * Zero DOM and zero Web Audio dependencies.
 */

import { PPQN, barPulses, beatsPerBar, stepsPerBar } from "./scdaw.js";
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
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  blues: [0, 3, 5, 6, 7, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  whole_tone: [0, 2, 4, 6, 8, 10],
  hirajoshi: [0, 2, 3, 7, 8],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const CHORD_INTERVALS = {
  major: [0, 4, 7],
  "": [0, 4, 7],
  5: [0, 7], // power chord
  m: [0, 3, 7],
  min: [0, 3, 7],
  minor: [0, 3, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10], // dominant 7
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  aug7: [0, 4, 8, 10],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  sus2: [0, 2, 7],
  add2: [0, 2, 4, 7],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  11: [0, 4, 7, 10, 14, 17],
  13: [0, 4, 7, 10, 14, 21],
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
  waltz: {
    feel: "waltz",
    defaultBpm: 96,
    signature: [3, 4],
    mode: "major",
    drumKit: "jazz-kit",
    bassType: "waltz",
    swing: 0.0,
  },
  ballad: {
    feel: "ballad",
    defaultBpm: 60,
    signature: [6, 8],
    mode: "major",
    drumKit: "jazz-kit",
    bassType: "legato",
    swing: 0.0,
    legato: true,
  },
  choral: {
    feel: "choral",
    defaultBpm: 56,
    signature: [4, 4],
    mode: "major",
    drumKit: "none",
    bassType: "legato",
    swing: 0.0,
    legato: true,
  },
  "jazz-swing": {
    feel: "jazz-swing",
    defaultBpm: 132,
    mode: "dorian",
    drumKit: "jazz-kit",
    bassType: "walking",
    swing: 0.3,
  },
  bossa: {
    feel: "bossa",
    defaultBpm: 120,
    mode: "major",
    drumKit: "jazz-kit",
    bassType: "bossa",
    swing: 0.0,
  },
  march: {
    feel: "march",
    defaultBpm: 112,
    signature: [2, 4],
    mode: "major",
    drumKit: "rock-kit",
    bassType: "march",
    swing: 0.0,
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
  signature = [4, 4],
) {
  const notes = [];
  const barPulseCount = barPulses(signature);
  const barSteps = stepsPerBar(signature);
  const quarter = PPQN.Quarter;
  const sixteenth = PPQN.SemiQuaver;
  const eighth = Math.round(PPQN.Quarter / 2);

  if (feel === "choral") {
    return notes;
  }

  const isShuffle =
    feel.includes("shuffle") ||
    feel.includes("blues") ||
    feel === "blues-rock" ||
    feel === "lofi" ||
    feel === "jazz-swing";

  // Downbeat crash cymbal (pitch 49) at the very start of a section with higher energy or song start
  if (isSongStart || energy >= 0.6) {
    notes.push({
      position: sectionStartPulse,
      duration: Math.min(barPulseCount, quarter * 2),
      pitch: 49, // Crash Cymbal 1
      velocity: 0.9 + rng() * 0.1,
    });
  }

  const isCompound68 = signature[1] === 8 && signature[0] % 3 === 0;
  const isWaltz34 = signature[0] === 3 && signature[1] === 4;

  for (let b = 0; b < sectionBars; b++) {
    const barOffset = sectionStartPulse + b * barPulseCount;
    const isLastBar = b === sectionBars - 1;

    if (isCompound68) {
      // Compound meter (e.g. 6/8, 9/8, 12/8): pulse in eighth notes grouped by 3
      const eighthCount = signature[0];
      for (let e = 0; e < eighthCount; e++) {
        const pos = barOffset + e * eighth;
        const isDottedBeat = e % 3 === 0;
        notes.push({
          position: pos,
          duration: eighth,
          pitch: 42,
          velocity: isDottedBeat ? 0.78 : 0.56,
        });
        if (e === 0) {
          notes.push({
            position: pos,
            duration: eighth,
            pitch: 36,
            velocity: 0.92,
          });
        } else if (e === 3 || (eighthCount >= 9 && e % 6 === 3)) {
          notes.push({
            position: pos,
            duration: eighth,
            pitch: 38,
            velocity: 0.85,
          });
        }
      }
      continue;
    }

    if (isWaltz34) {
      for (let beat = 0; beat < 3; beat++) {
        const pos = barOffset + beat * quarter;
        notes.push({
          position: pos,
          duration: eighth,
          pitch: 42,
          velocity: beat === 0 ? 0.8 : 0.6,
        });
        notes.push({
          position: pos,
          duration: quarter,
          pitch: beat === 0 ? 36 : 38,
          velocity: beat === 0 ? 0.92 : 0.72,
        });
      }
      continue;
    }

    if (isShuffle) {
      // Swung eighth-note shuffle hat pattern
      for (let s = 0; s < barSteps; s += 2) {
        if (isLastBar && barSteps >= 16 && s >= barSteps - 4 && energy >= 0.5)
          continue;
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
      for (let s = 0; s < barSteps; s++) {
        const hatPos = barOffset + s * sixteenth;
        // Skip the last 4 16ths if playing a fill on the last bar
        if (isLastBar && barSteps >= 16 && s >= barSteps - 4 && energy >= 0.5)
          continue;

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
        if (s % 4 === 2) {
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

    if (isLastBar && energy >= 0.5 && barPulseCount >= quarter * 4) {
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
      const numBeats = Math.max(1, Math.floor(barPulseCount / quarter));
      for (let beatIdx = 0; beatIdx < numBeats; beatIdx++) {
        const beatPos = barOffset + beatIdx * quarter;
        const isKickBeat = beatIdx % 2 === 0;
        notes.push({
          position: beatPos,
          duration: quarter,
          pitch: isKickBeat ? 36 : 38,
          velocity: 0.92 + rng() * 0.06,
        });
        if (
          isKickBeat &&
          beatIdx >= 2 &&
          energy >= 0.7 &&
          rng() < 0.6 &&
          beatPos + sixteenth * 2 < barOffset + barPulseCount
        ) {
          notes.push({
            position: beatPos + sixteenth * 2,
            duration: sixteenth * 2,
            pitch: 36,
            velocity: 0.85,
          });
        }
      }

      // Ghost notes on snare for funk/shuffle groove
      if (
        (feel.includes("shuffle") || feel.includes("funk")) &&
        quarter + sixteenth * 2 < barPulseCount
      ) {
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
  signature = [4, 4],
  legato = false,
) {
  const notes = [];
  const barPulseCount = barPulses(signature);
  const quarter = PPQN.Quarter;
  const durFactor =
    legato || feel === "choral" || feel === "ballad" ? 1.0 : 0.9;
  const isCompound68 = signature[1] === 8 && signature[0] % 3 === 0;

  for (let b = 0; b < sectionBars; b++) {
    const barOffset = sectionStartPulse + b * barPulseCount;
    const barChord = chords[b % chords.length] || chords[0];
    const barChords = barChord.chordsInBar || [barChord];

    if (barChords.length >= 2) {
      // Multi-chord bar: divide barPulses evenly across chords
      const subDur = Math.max(
        PPQN.SemiQuaver,
        Math.floor(barPulseCount / barChords.length),
      );
      for (let cIdx = 0; cIdx < barChords.length && cIdx < 4; cIdx++) {
        const c = barChords[cIdx];
        const rootBass = c.bass || 40;
        const subOffset = barOffset + cIdx * subDur;

        notes.push({
          position: subOffset,
          duration: Math.round(
            (subDur >= quarter * 2 ? quarter : subDur) * durFactor,
          ),
          pitch: rootBass,
          velocity: 0.9,
        });

        if (subDur >= quarter * 2) {
          const beat2Pitch =
            rng() < 0.4 ? rootBass + 7 : rng() < 0.3 ? rootBass + 12 : rootBass;
          notes.push({
            position: subOffset + quarter,
            duration: Math.round((subDur - quarter) * durFactor),
            pitch: beat2Pitch,
            velocity: 0.82,
          });
        }
      }
    } else if (isCompound68) {
      // Compound 6/8 or 12/8: dotted quarter beats (1440 pulses per beat)
      const rootBass = barChord.bass || 40;
      const dq = Math.round(quarter * 1.5); // 1440
      const compoundBeats = Math.max(1, Math.round(barPulseCount / dq));
      for (let cb = 0; cb < compoundBeats; cb++) {
        const pitch =
          cb === 0 ? rootBass : cb % 2 === 1 ? rootBass + 7 : rootBass;
        notes.push({
          position: barOffset + cb * dq,
          duration: Math.round(dq * durFactor),
          pitch,
          velocity: cb === 0 ? 0.9 : 0.82,
        });
      }
    } else {
      // Single chord across the entire bar
      const rootBass = barChord.bass || 40;
      const numBeats = Math.max(1, Math.floor(barPulseCount / quarter));

      for (let beatIdx = 0; beatIdx < numBeats; beatIdx++) {
        const pos = barOffset + beatIdx * quarter;
        let pitch = rootBass;
        let vel = 0.85;

        if (beatIdx === 0) {
          vel = 0.9;
        } else if (beatIdx === 1) {
          pitch = rng() < 0.3 ? rootBass + 12 : rootBass;
          vel = 0.8;
        } else if (beatIdx === 2) {
          pitch = rng() < 0.4 ? rootBass + 7 : rootBass;
          vel = 0.85;
        } else if (beatIdx === numBeats - 1) {
          const nextBarChord = chords[(b + 1) % chords.length] || chords[0];
          const nextRoot =
            (nextBarChord.chordsInBar?.[0] || nextBarChord).bass || 40;
          if (nextRoot > rootBass) pitch = nextRoot - 1;
          else if (nextRoot < rootBass) pitch = nextRoot + 1;
          vel = 0.78;
        }

        notes.push({
          position: pos,
          duration: Math.round(quarter * durFactor),
          pitch,
          velocity: vel,
        });
      }
    }
  }

  return notes;
}

/**
 * Generates rhythm guitar / keyboard chord comping with strum offsets.
 * Respects sub-bar chord changes, non-4/4 signatures, and legato phrasing.
 */
function generateCompingForSection(
  sectionStartPulse,
  sectionBars,
  chords,
  energy = 0.7,
  feel = "straight-rock",
  rng,
  signature = [4, 4],
  legato = false,
) {
  const notes = [];
  const barPulseCount = barPulses(signature);
  const quarter = PPQN.Quarter;
  const isLegato = legato || feel === "choral" || feel === "ballad";
  const isCompound68 = signature[1] === 8 && signature[0] % 3 === 0;
  const dq = Math.round(quarter * 1.5); // 1440

  for (let b = 0; b < sectionBars; b++) {
    const barOffset = sectionStartPulse + b * barPulseCount;
    const barChord = chords[b % chords.length] || chords[0];
    const barChords = barChord.chordsInBar || [barChord];

    const stepPulse = isCompound68 ? dq : quarter;
    const strumCount = Math.max(1, Math.round(barPulseCount / stepPulse));
    const strumRhythms = Array.from(
      { length: strumCount },
      (_, idx) => idx * stepPulse,
    );

    for (let sIdx = 0; sIdx < strumRhythms.length; sIdx++) {
      const strumPos = strumRhythms[sIdx];
      let activeChord = barChords[0];
      if (barChords.length === 2) {
        activeChord =
          sIdx < Math.ceil(strumCount / 2) ? barChords[0] : barChords[1];
      } else if (barChords.length >= 3) {
        activeChord = barChords[sIdx % barChords.length];
      }
      const pitches = activeChord.pitches || [60, 64, 67];

      const isUpstroke = !isLegato && sIdx % 2 === 1;
      const orderedPitches = isUpstroke ? [...pitches].reverse() : [...pitches];
      const strumOffsetTicks = isLegato ? 0 : 12;
      const noteDuration = isLegato ? stepPulse : Math.round(stepPulse * 0.85);

      for (let i = 0; i < orderedPitches.length; i++) {
        const notePitch = orderedPitches[i];
        const notePos = barOffset + strumPos + i * strumOffsetTicks;
        if (notePos >= barOffset + barPulseCount) continue;
        notes.push({
          position: notePos,
          duration: noteDuration,
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
      const dp = durPart.toLowerCase();
      if (dp === "32")
        durTicks = Math.round(PPQN.Quarter / 8); // 120
      else if (dp === "16")
        durTicks = PPQN.SemiQuaver; // 240
      else if (dp === "16." || dp === "ds")
        durTicks = Math.round(PPQN.SemiQuaver * 1.5); // 360
      else if (dp === "8")
        durTicks = Math.round(PPQN.Quarter / 2); // 480
      else if (dp === "8." || dp === "de")
        durTicks = Math.round(PPQN.Quarter * 0.75); // 720
      else if (dp === "4" || dp === "q")
        durTicks = PPQN.Quarter; // 960
      else if (dp === "4." || dp === "dq")
        durTicks = Math.round(PPQN.Quarter * 1.5); // 1440
      else if (dp === "2" || dp === "h")
        durTicks = PPQN.Quarter * 2; // 1920
      else if (dp === "2." || dp === "dh")
        durTicks = PPQN.Quarter * 3; // 2880
      else if (dp === "1" || dp === "w")
        durTicks = PPQN.Bar; // 3840
      else if (dp.endsWith("t")) {
        const base = parseInt(dp, 10);
        if (base === 4)
          durTicks = Math.round((PPQN.Quarter * 2) / 3); // 640
        else if (base === 8)
          durTicks = Math.round(PPQN.Quarter / 3); // 320
        else if (base === 16) durTicks = Math.round(PPQN.Quarter / 6); // 160
      } else if (!isNaN(Number(dp))) {
        const num = Number(dp);
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
  signature = [4, 4],
) {
  const notes = [];
  const barPulseCount = barPulses(signature);
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

      const pos1 =
        barOffset +
        Math.min(quarter + sixteenth * 2, Math.floor(barPulseCount / 2));
      notes.push({
        position: pos1,
        duration: sixteenth * 2,
        pitch: p1,
        velocity: 0.85 + rng() * 0.1,
      });
      const pos2 =
        barOffset + Math.min(quarter * 3, Math.max(0, barPulseCount - quarter));
      if (pos2 > pos1 && pos2 < barOffset + barPulseCount) {
        notes.push({
          position: pos2,
          duration: Math.min(quarter, barOffset + barPulseCount - pos2),
          pitch: p2,
          velocity: 0.9,
        });
      }
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
  const barPulseCount = barPulses(signature);
  const legato = Boolean(spec.legato);
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
      signature,
    );
    drumNotes.push(...drums);

    // 2. Bass: custom riff motif if provided, otherwise procedural walker
    if (parsedBassMotifNotes.length > 0) {
      const motifDuration = parsedBassMotifNotes.reduce(
        (max, n) => Math.max(max, n.relPulse + n.duration),
        barPulseCount,
      );
      const sectionPulses = sec.bars * barPulseCount;
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
        signature,
        legato,
      );
      bassNotes.push(...bass);
    }

    // 3. Rhythm Guitar / Keys: custom rhythm motif if provided, otherwise comping
    if (parsedRhythmMotifNotes.length > 0) {
      const motifDuration = parsedRhythmMotifNotes.reduce(
        (max, n) => Math.max(max, n.relPulse + n.duration),
        barPulseCount,
      );
      const sectionPulses = sec.bars * barPulseCount;
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
        signature,
        legato,
      );
      rhythmNotes.push(...rhythm);
    }

    // 4. Lead Guitar / Motif
    if (hasLead) {
      if (parsedMotifNotes.length > 0) {
        const motifDuration = parsedMotifNotes.reduce(
          (max, n) => Math.max(max, n.relPulse + n.duration),
          barPulseCount,
        );
        const sectionPulses = sec.bars * barPulseCount;
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
          signature,
        );
        leadNotes.push(...lead);
      }
    }

    currentPulse += sec.bars * barPulseCount;
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
