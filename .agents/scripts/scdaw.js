// Ported from openDAW packages/lib/dsp @10088021 (AGPL-3.0-or-later, © André Michelle)
/**
 * .agents/scripts/scdaw.js
 *
 * Pure musical logic, PPQN timebase conversions, project schemas,
 * transactional reducers, WAV encoding, and signal telemetry.
 * Zero DOM and zero Web Audio dependencies.
 */

import {
  MASTER_SCHEMA,
  TRACK_MIX_SCHEMA,
  SYNTH_PARAM_SCHEMA,
  DRUM_PARAM_SCHEMA,
  INSTRUMENT_SCHEMAS,
  FX_SCHEMAS,
  AUTOMATABLE_PARAMS,
  getDefaultParams,
  migrateProject,
  validateAndFilterParams,
} from "./scdaw-schema.js";
import {
  INSTRUMENT_PRESETS,
  GENRE_TEMPLATES,
  generateGenrePattern,
} from "./scdaw-presets.js";
import { compileSong } from "./scdaw-compose.js";
import { analyzeAudioBuffer } from "./scdaw-dsp.js";

export {
  MASTER_SCHEMA,
  TRACK_MIX_SCHEMA,
  SYNTH_PARAM_SCHEMA,
  DRUM_PARAM_SCHEMA,
  AUTOMATABLE_PARAMS,
  getDefaultParams,
  migrateProject,
  INSTRUMENT_PRESETS,
  GENRE_TEMPLATES,
  generateGenrePattern,
  analyzeAudioBuffer,
};

export const PPQN = Object.freeze({
  Quarter: 960,
  Bar: 3840,
  SemiQuaver: 240,
});

export const GM_DRUMS = Object.freeze({
  kick: 36,
  snare: 38,
  clap: 39,
  hat: 42,
  closedhat: 42,
  openhat: 46,
});

export const GM_DRUM_NAMES = Object.freeze({
  36: "kick",
  38: "snare",
  39: "clap",
  42: "hat",
  46: "openhat",
});

const NOTE_NAMES = [
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

export function secondsToPulses(seconds, bpm) {
  return Math.round(((seconds * bpm) / 60) * PPQN.Quarter);
}

export function pulsesToSeconds(pulses, bpm) {
  return (pulses * 60) / PPQN.Quarter / bpm;
}

export function stepToPpqn(step) {
  return Math.round(step * PPQN.SemiQuaver);
}

export function ppqnToStep(ppqn) {
  return Math.floor(ppqn / PPQN.SemiQuaver);
}

export function parsePitch(pitchInput) {
  if (typeof pitchInput === "number") {
    return Math.max(0, Math.min(127, Math.round(pitchInput)));
  }
  const clean = String(pitchInput || "")
    .trim()
    .toLowerCase();
  if (GM_DRUMS[clean] !== undefined) {
    return GM_DRUMS[clean];
  }
  const match = clean.match(/^([a-g][#b]?)(-?\d+)$/);
  if (!match) {
    const num = Number(pitchInput);
    if (!Number.isNaN(num)) return Math.max(0, Math.min(127, Math.round(num)));
    return 60; // default C4
  }
  const name = match[1].toUpperCase();
  const octave = parseInt(match[2], 10);
  const semitones = {
    C: 0,
    "C#": 1,
    DB: 1,
    D: 2,
    "D#": 3,
    EB: 3,
    E: 4,
    F: 5,
    "F#": 6,
    GB: 6,
    G: 7,
    "G#": 8,
    AB: 8,
    A: 9,
    "A#": 10,
    BB: 10,
    B: 11,
  };
  const offset = semitones[name] ?? 0;
  return Math.max(0, Math.min(127, (octave + 1) * 12 + offset));
}

export function pitchToName(pitch, kind = "synth") {
  const p = Math.max(0, Math.min(127, Math.round(pitch)));
  if (kind === "drums" && GM_DRUM_NAMES[p]) {
    return GM_DRUM_NAMES[p];
  }
  const noteName = NOTE_NAMES[p % 12];
  const octave = Math.floor(p / 12) - 1;
  return `${noteName}${octave}`;
}

export function beatsPerBar(signature = [4, 4]) {
  const [num = 4, den = 4] = Array.isArray(signature) ? signature : [4, 4];
  return (num * 4) / den;
}

export function barPulses(signature = [4, 4]) {
  return Math.round(beatsPerBar(signature) * PPQN.Quarter);
}

export function parseDuration(dur) {
  if (typeof dur === "number") return Math.max(1, Math.round(dur));
  if (typeof dur !== "string") return PPQN.SemiQuaver;
  const s = dur.trim().toLowerCase();
  if (s === "1/16" || s === "16th" || s === "s") return PPQN.SemiQuaver; // 240
  if (s === "1/8" || s === "8th" || s === "e")
    return Math.round(PPQN.Quarter / 2); // 480
  if (
    s === "1/4" ||
    s === "4th" ||
    s === "q" ||
    s === "quarter" ||
    s === "1 beat"
  )
    return PPQN.Quarter; // 960
  if (s === "1/2" || s === "half" || s === "h" || s === "2 beats")
    return PPQN.Quarter * 2; // 1920
  if (
    s === "1/1" ||
    s === "whole" ||
    s === "w" ||
    s === "4 beats" ||
    s === "1 bar"
  )
    return PPQN.Bar; // 3840

  const matchBeats = s.match(/^([\d.]+)\s*beats?$/);
  if (matchBeats) {
    return Math.max(1, Math.round(parseFloat(matchBeats[1]) * PPQN.Quarter));
  }
  const matchBars = s.match(/^([\d.]+)\s*bars?$/);
  if (matchBars) {
    return Math.max(1, Math.round(parseFloat(matchBars[1]) * PPQN.Bar));
  }
  const num = parseFloat(s);
  return !isNaN(num) && num > 0 ? Math.round(num) : PPQN.SemiQuaver;
}

export function projectToScoreView(project) {
  const signature = project.signature || [4, 4];
  const bpBar = beatsPerBar(signature);
  const barPulseCount = Math.round(bpBar * PPQN.Quarter);

  const timebase = {
    ppqnPerQuarter: PPQN.Quarter,
    beatsPerBar: bpBar,
    stepsPerBar: bpBar * 4,
    lengthBars: project.lengthBars || 1,
    signature,
    bpm: project.bpm || 120,
  };

  const tracks = (project.tracks || []).map((trk) => {
    const score = (trk.notes || []).map((n) => {
      const pos = n.position || 0;
      const bar = Math.floor(pos / barPulseCount) + 1;
      const rem = pos % barPulseCount;
      const beat = Math.floor(rem / PPQN.Quarter) + 1;
      const beatOffset = rem % PPQN.Quarter;

      let durLabel = `${n.duration}p`;
      if (n.duration === PPQN.Quarter) durLabel = "1/4";
      else if (n.duration === Math.round(PPQN.Quarter / 2)) durLabel = "1/8";
      else if (n.duration === PPQN.SemiQuaver) durLabel = "1/16";
      else if (n.duration === PPQN.Quarter * 2) durLabel = "1/2";
      else if (n.duration === barPulseCount) durLabel = "1 bar";

      return {
        bar,
        beat:
          beatOffset > 0
            ? parseFloat((beat + beatOffset / PPQN.Quarter).toFixed(2))
            : beat,
        note: pitchToName(n.pitch, trk.kind),
        pitch: n.pitch,
        dur: durLabel,
        vel: parseFloat((n.velocity ?? 0.8).toFixed(2)),
      };
    });

    return {
      id: trk.id,
      name: trk.name,
      kind: trk.kind,
      instrument: trk.instrument || trk.kind,
      noteCount: trk.notes ? trk.notes.length : 0,
      score,
    };
  });

  return {
    timebase,
    title: project.name || project.title,
    tracks,
  };
}

export function createProject(template = "basic-beat") {
  if (typeof template === "object" && template !== null) {
    const base = createProject(template.template || "empty");
    return {
      ...base,
      ...template,
      name: template.name || template.title || base.name,
      bpm: typeof template.bpm === "number" ? template.bpm : base.bpm,
      signature: Array.isArray(template.signature)
        ? template.signature
        : base.signature,
      lengthBars:
        typeof template.lengthBars === "number"
          ? template.lengthBars
          : base.lengthBars,
      swing: typeof template.swing === "number" ? template.swing : base.swing,
      metronome: template.metronome
        ? { ...base.metronome, ...template.metronome }
        : base.metronome || { enabled: false, volume: 0.8 },
      master: template.master
        ? { ...base.master, ...template.master }
        : base.master,
      tracks: Array.isArray(template.tracks) ? template.tracks : base.tracks,
    };
  }

  if (template === "empty") {
    return {
      version: 1,
      name: "Empty Project",
      bpm: 120,
      signature: [4, 4],
      lengthBars: 1,
      swing: 0,
      metronome: { enabled: false, volume: 0.8 },
      master: { volume: 0.8 },
      tracks: [],
    };
  }

  if (template === "straight-beat") {
    return {
      version: 1,
      name: "Straight Beat",
      bpm: 120,
      signature: [4, 4],
      lengthBars: 1,
      swing: 0,
      metronome: { enabled: false, volume: 0.8 },
      master: { volume: 0.8 },
      tracks: [
        {
          id: "trk_drums",
          name: "Drums",
          kind: "drums",
          volume: 0.85,
          pan: 0,
          mute: false,
          solo: false,
          params: {},
          notes: [
            // Kick on beats 1 and 3
            { position: 0, duration: 240, pitch: 36, velocity: 1.0 },
            { position: 1920, duration: 240, pitch: 36, velocity: 0.95 },
            // Snare on beats 2 and 4
            { position: 960, duration: 240, pitch: 38, velocity: 0.9 },
            { position: 2880, duration: 240, pitch: 38, velocity: 0.9 },
            // Closed hat on every eighth note
            { position: 0, duration: 240, pitch: 42, velocity: 0.7 },
            { position: 480, duration: 240, pitch: 42, velocity: 0.6 },
            { position: 960, duration: 240, pitch: 42, velocity: 0.7 },
            { position: 1440, duration: 240, pitch: 42, velocity: 0.6 },
            { position: 1920, duration: 240, pitch: 42, velocity: 0.7 },
            { position: 2400, duration: 240, pitch: 42, velocity: 0.6 },
            { position: 2880, duration: 240, pitch: 42, velocity: 0.7 },
            { position: 3360, duration: 240, pitch: 42, velocity: 0.6 },
          ],
        },
        {
          id: "trk_bass",
          name: "Bass Synth",
          kind: "synth",
          defaultPitch: 36,
          volume: 0.75,
          pan: 0,
          mute: false,
          solo: false,
          params: {
            waveform: "sawtooth",
            cutoff: 800,
            resonance: 3,
            attack: 0.01,
            decay: 0.15,
            sustain: 0.4,
            release: 0.1,
          },
          notes: [
            // Root notes on off-beats
            { position: 480, duration: 480, pitch: 36, velocity: 0.85 }, // C2
            { position: 1440, duration: 480, pitch: 36, velocity: 0.8 },
            { position: 2400, duration: 480, pitch: 39, velocity: 0.85 }, // D#2
            { position: 3360, duration: 480, pitch: 41, velocity: 0.85 }, // F2
          ],
        },
      ],
    };
  }

  if (GENRE_TEMPLATES[template]) {
    return generateGenrePattern(template);
  }

  // "basic-beat" (Groovy starter with 20% swing & 16th hats)
  return {
    version: 1,
    name: "New Beat",
    bpm: 120,
    signature: [4, 4],
    lengthBars: 1,
    swing: 0.2,
    metronome: { enabled: false, volume: 0.8 },
    master: { volume: 0.8 },
    tracks: [
      {
        id: "trk_drums",
        name: "Drums",
        kind: "drums",
        volume: 0.85,
        pan: 0,
        mute: false,
        solo: false,
        params: {},
        notes: [
          // Kick on beats 1 and 3
          { position: 0, duration: 240, pitch: 36, velocity: 1.0 },
          { position: 1920, duration: 240, pitch: 36, velocity: 0.95 },
          // Snare on beats 2 and 4
          { position: 960, duration: 240, pitch: 38, velocity: 0.9 },
          { position: 2880, duration: 240, pitch: 38, velocity: 0.9 },
          // Closed hats across all 16 sixteenth steps (swung dynamically)
          { position: 0, duration: 240, pitch: 42, velocity: 0.75 },
          { position: 240, duration: 240, pitch: 42, velocity: 0.55 },
          { position: 480, duration: 240, pitch: 42, velocity: 0.7 },
          { position: 720, duration: 240, pitch: 42, velocity: 0.55 },
          { position: 960, duration: 240, pitch: 42, velocity: 0.75 },
          { position: 1200, duration: 240, pitch: 42, velocity: 0.55 },
          { position: 1440, duration: 240, pitch: 42, velocity: 0.7 },
          { position: 1680, duration: 240, pitch: 42, velocity: 0.55 },
          { position: 1920, duration: 240, pitch: 42, velocity: 0.75 },
          { position: 2160, duration: 240, pitch: 42, velocity: 0.55 },
          { position: 2400, duration: 240, pitch: 42, velocity: 0.7 },
          { position: 2640, duration: 240, pitch: 42, velocity: 0.55 },
          { position: 2880, duration: 240, pitch: 42, velocity: 0.75 },
          { position: 3120, duration: 240, pitch: 42, velocity: 0.55 },
          { position: 3360, duration: 240, pitch: 42, velocity: 0.7 },
          { position: 3600, duration: 240, pitch: 42, velocity: 0.55 },
        ],
      },
      {
        id: "trk_bass",
        name: "Bass Synth",
        kind: "synth",
        defaultPitch: 36,
        volume: 0.75,
        pan: 0,
        mute: false,
        solo: false,
        params: {
          waveform: "sawtooth",
          cutoff: 800,
          resonance: 3,
          attack: 0.01,
          decay: 0.15,
          sustain: 0.4,
          release: 0.1,
        },
        notes: [
          // Root notes on off-beats
          { position: 480, duration: 480, pitch: 36, velocity: 0.85 }, // C2
          { position: 1440, duration: 480, pitch: 36, velocity: 0.8 },
          { position: 2400, duration: 480, pitch: 39, velocity: 0.85 }, // D#2
          { position: 3360, duration: 480, pitch: 41, velocity: 0.85 }, // F2
        ],
      },
    ],
  };
}

export function validateProject(project) {
  const errors = [];
  if (!project || typeof project !== "object") {
    return { valid: false, errors: ["Project must be a non-null object"] };
  }
  if (
    typeof project.bpm !== "number" ||
    project.bpm < 40 ||
    project.bpm > 240
  ) {
    errors.push(`Invalid bpm: ${project.bpm} (must be between 40 and 240)`);
  }
  if (!Array.isArray(project.signature) || project.signature.length !== 2) {
    errors.push("Invalid signature (must be [nominator, denominator])");
  }
  if (
    typeof project.lengthBars !== "number" ||
    project.lengthBars < 1 ||
    project.lengthBars > 512
  ) {
    errors.push(
      `Invalid lengthBars: ${project.lengthBars} (must be between 1 and 512)`,
    );
  }
  if (
    typeof project.swing === "number" &&
    (project.swing < 0 || project.swing > 0.5)
  ) {
    errors.push(`Invalid swing: ${project.swing} (must be between 0 and 0.5)`);
  }
  if (
    project.loop !== undefined &&
    (typeof project.loop !== "object" || project.loop === null)
  ) {
    errors.push("Project loop must be an object");
  }
  if (!Array.isArray(project.tracks)) {
    errors.push("Project tracks must be an array");
  } else if (project.tracks.length > 64) {
    errors.push(`Too many tracks: ${project.tracks.length} (max 64)`);
  } else {
    for (const [idx, trk] of project.tracks.entries()) {
      if (!trk.id || typeof trk.id !== "string")
        errors.push(`Track[${idx}] missing id`);
      if (
        trk.kind !== "drums" &&
        trk.kind !== "synth" &&
        trk.kind !== "audio"
      ) {
        errors.push(`Track[${idx}] kind must be 'drums', 'synth', or 'audio'`);
      }
      if (!Array.isArray(trk.notes)) {
        errors.push(`Track[${idx}] notes must be an array`);
      } else if (trk.notes.length > 20000) {
        errors.push(
          `Track[${idx}] has too many notes (${trk.notes.length} > 20000)`,
        );
      }
      if (trk.audioClips !== undefined && !Array.isArray(trk.audioClips)) {
        errors.push(`Track[${idx}] audioClips must be an array`);
      }
      if (
        trk.automation !== undefined &&
        (typeof trk.automation !== "object" ||
          trk.automation === null ||
          Array.isArray(trk.automation))
      ) {
        errors.push(`Track[${idx}] automation must be an object`);
      }
      if (trk.sends !== undefined && !Array.isArray(trk.sends)) {
        errors.push(`Track[${idx}] sends must be an array`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeNotes(units, notes, signature = [4, 4]) {
  if (!Array.isArray(notes)) return [];
  const bpBar = beatsPerBar(signature);
  const barPulseCount = Math.round(bpBar * PPQN.Quarter);

  return notes.map((item) => {
    let position = 0;
    let duration = PPQN.SemiQuaver;

    if (units === "steps") {
      position = stepToPpqn(item.step ?? 0);
      duration =
        item.durationSteps !== undefined
          ? stepToPpqn(item.durationSteps)
          : item.dur !== undefined
            ? parseDuration(item.dur)
            : PPQN.SemiQuaver;
    } else if (units === "beats") {
      position = Math.round((item.beat ?? 0) * PPQN.Quarter);
      duration =
        item.durationBeats !== undefined
          ? Math.round(item.durationBeats * PPQN.Quarter)
          : item.dur !== undefined
            ? parseDuration(item.dur)
            : Math.round(0.25 * PPQN.Quarter);
    } else if (units === "bars" || item.bar !== undefined) {
      const barNum = item.bar !== undefined ? Number(item.bar) : 1;
      const barIdx = barNum >= 1 ? barNum - 1 : barNum;
      const beatNum = item.beat !== undefined ? Number(item.beat) : 1;
      const beatIdx = barNum >= 1 && beatNum >= 1 ? beatNum - 1 : beatNum;
      position = Math.round(barIdx * barPulseCount + beatIdx * PPQN.Quarter);
      duration =
        item.dur !== undefined
          ? parseDuration(item.dur)
          : item.duration !== undefined
            ? parseDuration(item.duration)
            : PPQN.SemiQuaver;
    } else {
      position = Math.round(item.position ?? 0);
      duration =
        item.dur !== undefined
          ? parseDuration(item.dur)
          : parseDuration(item.duration ?? PPQN.SemiQuaver);
    }

    const rawPitch = item.pitch !== undefined ? item.pitch : item.note;
    const pitch = parsePitch(rawPitch);

    let rawVelocity =
      item.velocity !== undefined
        ? Number(item.velocity)
        : item.vel !== undefined
          ? Number(item.vel)
          : 0.8;
    // Canonical velocity handling: if velocity is in legacy MIDI range > 1, rescale / 127
    if (rawVelocity > 1) {
      rawVelocity = rawVelocity / 127;
    }
    const velocity = Math.max(0, Math.min(1, rawVelocity));

    return { position, duration, pitch, velocity };
  });
}

export function automationValueAt(
  track,
  paramName,
  ppqn,
  defaultValue = undefined,
) {
  if (!track || !track.automation) {
    return defaultValue !== undefined
      ? defaultValue
      : (track?.[paramName] ?? track?.params?.[paramName] ?? 0);
  }
  const points = track.automation[paramName];
  if (!Array.isArray(points) || points.length === 0) {
    return defaultValue !== undefined
      ? defaultValue
      : (track?.[paramName] ?? track?.params?.[paramName] ?? 0);
  }

  const timeInBeats = ppqn / PPQN.Quarter;

  if (timeInBeats <= points[0].time) {
    return points[0].value;
  }
  if (timeInBeats >= points[points.length - 1].time) {
    return points[points.length - 1].value;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (timeInBeats >= p0.time && timeInBeats <= p1.time) {
      if (p1.time === p0.time) return p0.value;
      const frac = (timeInBeats - p0.time) / (p1.time - p0.time);
      return p0.value + (p1.value - p0.value) * frac;
    }
  }

  return points[points.length - 1].value;
}

export function applyCommand(project, name, params = {}) {
  const next = structuredClone(project);

  switch (name) {
    case "new_project": {
      const template = params.template || "empty";
      const created = createProject(template);
      if (params.name) created.name = String(params.name);
      if (params.bpm) created.bpm = Number(params.bpm);

      let seededTracks = [];
      let totalNotes = 0;
      if (Array.isArray(created.tracks) && created.tracks.length > 0) {
        for (const trk of created.tracks) {
          const count = Array.isArray(trk.notes) ? trk.notes.length : 0;
          totalNotes += count;
          seededTracks.push({
            id: trk.id,
            name: trk.name,
            kind: trk.kind,
            noteCount: count,
            preset: trk.preset || trk.params?.preset || null,
          });
        }
      }

      if (params.clear) {
        for (const trk of created.tracks) {
          trk.notes = [];
        }
      }

      const warning =
        totalNotes > 0 && !params.clear
          ? `Template '${template}' seeded ${totalNotes} notes across ${seededTracks.length} tracks. Use clear: true or scdaw_clear_project_notes to start with blank tracks.`
          : undefined;

      return {
        project: created,
        result: {
          ok: true,
          name: created.name,
          template,
          trackCount: created.tracks.length,
          seededTracks,
          warning,
        },
      };
    }

    case "clear_project_notes": {
      let clearedNotesCount = 0;
      if (Array.isArray(next.tracks)) {
        for (const trk of next.tracks) {
          if (Array.isArray(trk.notes)) {
            clearedNotesCount += trk.notes.length;
            trk.notes = [];
          }
        }
      }
      return {
        project: next,
        result: {
          ok: true,
          clearedNotesCount,
          trackCount: next.tracks?.length || 0,
        },
      };
    }

    case "compose_song": {
      const composed = compileSong(params);
      const val = validateProject(composed);
      if (!val.valid) {
        throw new Error(
          `Failed to compile valid song: ${val.errors.join(", ")}`,
        );
      }
      return {
        project: composed,
        result: {
          ok: true,
          name: composed.name,
          bpm: composed.bpm,
          lengthBars: composed.lengthBars,
          trackCount: composed.tracks.length,
          tracks: composed.tracks.map((t) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            noteCount: t.notes.length,
          })),
        },
      };
    }

    case "describe_arrangement": {
      const p = next;
      const bpBar = beatsPerBar(p.signature || [4, 4]);
      const barPulseCount = Math.round(bpBar * PPQN.Quarter);
      const totalPulses = (p.lengthBars || 1) * barPulseCount;

      const trackSummaries = (p.tracks || []).map((t) => {
        const noteCount = t.notes ? t.notes.length : 0;
        const clipCount = t.audioClips ? t.audioClips.length : 0;
        return `- Track '${t.name}' (id: ${t.id}, kind: ${t.kind}, instrument: ${t.instrument || t.kind}): ${noteCount} notes, ${clipCount} audio clips, volume: ${t.volume}, pan: ${t.pan}`;
      });

      const summary = [
        `Song: "${p.name || "Untitled"}"`,
        `Tempo: ${p.bpm} BPM | Time Signature: ${(p.signature || [4, 4]).join("/")} | Length: ${p.lengthBars || 1} bars`,
        `Loop Region: ${p.loop?.enabled ? `Enabled (${p.loop.startPulse || 0} to ${p.loop.endPulse || totalPulses} pulses)` : "Off (linear playback)"}`,
        `Tracks (${(p.tracks || []).length}):`,
        ...trackSummaries,
      ].join("\n");

      return {
        project: next,
        result: {
          ok: true,
          summary,
          lengthBars: p.lengthBars,
          bpm: p.bpm,
          trackCount: p.tracks.length,
        },
      };
    }

    case "load_project": {
      const candidate = params.project;
      const val = validateProject(candidate);
      if (!val.valid) {
        throw new Error(`Invalid project: ${val.errors.join(", ")}`);
      }
      return { project: candidate, result: { ok: true, name: candidate.name } };
    }

    case "set_transport": {
      if (params.bpm !== undefined)
        next.bpm = Math.max(40, Math.min(240, Number(params.bpm)));
      if (params.signature !== undefined) next.signature = params.signature;
      if (params.lengthBars !== undefined)
        next.lengthBars = Math.max(1, Math.min(512, Number(params.lengthBars)));
      if (params.swing !== undefined)
        next.swing = Math.max(0, Math.min(0.5, Number(params.swing)));
      if (params.loop !== undefined) {
        if (typeof params.loop === "boolean") {
          next.loop = { ...(next.loop || {}), enabled: params.loop };
        } else if (typeof params.loop === "object" && params.loop !== null) {
          next.loop = { ...(next.loop || {}), ...params.loop };
        }
      }
      return {
        project: next,
        result: {
          bpm: next.bpm,
          signature: next.signature,
          lengthBars: next.lengthBars,
          swing: next.swing,
          loop: next.loop,
        },
      };
    }

    case "add_track": {
      if (next.tracks.length >= 64) {
        throw new Error("Cannot add track: maximum 64 tracks reached");
      }
      const kind =
        params.kind === "drums"
          ? "drums"
          : params.kind === "audio"
            ? "audio"
            : "synth";
      const id = `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const name =
        params.name ||
        (kind === "drums"
          ? "Drums"
          : kind === "audio"
            ? `Audio ${next.tracks.length + 1}`
            : `Synth ${next.tracks.length + 1}`);

      let initParams =
        kind === "synth"
          ? {
              waveform: "sawtooth",
              cutoff: 1000,
              resonance: 2,
              attack: 0.01,
              decay: 0.2,
              sustain: 0.5,
              release: 0.2,
            }
          : {};

      let ignoredParams = [];
      if (params.params && typeof params.params === "object") {
        const schema = INSTRUMENT_SCHEMAS[kind] || SYNTH_PARAM_SCHEMA;
        const res = validateAndFilterParams(schema, params.params);
        initParams = { ...initParams, ...res.filtered };
        ignoredParams = res.ignoredParams;
      }

      const newTrack = {
        id,
        name,
        kind,
        volume: 0.8,
        pan: 0,
        mute: false,
        solo: false,
        params: initParams,
        notes: [],
        audioClips: kind === "audio" ? [] : undefined,
        automation: {},
        sends: [],
      };
      next.tracks.push(newTrack);
      return {
        project: next,
        result: { trackId: id, name, kind, ignoredParams },
      };
    }

    case "remove_track": {
      const trackId = params.trackId || params.id;
      const initialLen = next.tracks.length;
      next.tracks = next.tracks.filter((t) => t.id !== trackId);
      if (next.tracks.length === initialLen) {
        throw new Error(`Track not found: ${trackId}`);
      }
      return { project: next, result: { removed: trackId } };
    }

    case "move_track": {
      const trackId = params.trackId || params.id;
      const currentIndex = next.tracks.findIndex((t) => t.id === trackId);
      if (currentIndex === -1) {
        throw new Error(`Track not found: ${trackId}`);
      }
      let targetIndex = currentIndex;
      if (params.direction === "up") {
        targetIndex = Math.max(0, currentIndex - 1);
      } else if (params.direction === "down") {
        targetIndex = Math.min(next.tracks.length - 1, currentIndex + 1);
      } else if (params.targetIndex !== undefined) {
        targetIndex = Math.max(
          0,
          Math.min(
            next.tracks.length - 1,
            Math.round(Number(params.targetIndex)),
          ),
        );
      }
      if (targetIndex !== currentIndex) {
        const [track] = next.tracks.splice(currentIndex, 1);
        next.tracks.splice(targetIndex, 0, track);
      }
      return {
        project: next,
        result: { trackId, fromIndex: currentIndex, toIndex: targetIndex },
      };
    }

    case "reorder_tracks": {
      const trackIds = Array.isArray(params.trackIds) ? params.trackIds : [];
      if (trackIds.length > 0) {
        const trackMap = new Map(next.tracks.map((t) => [t.id, t]));
        const reordered = [];
        for (const id of trackIds) {
          const t = trackMap.get(id);
          if (t) {
            reordered.push(t);
            trackMap.delete(id);
          }
        }
        for (const t of trackMap.values()) {
          reordered.push(t);
        }
        next.tracks = reordered;
      }
      return {
        project: next,
        result: { trackIds: next.tracks.map((t) => t.id) },
      };
    }

    case "set_track": {
      const trackId = params.trackId || params.id;
      const track = next.tracks.find((t) => t.id === trackId);
      if (!track) throw new Error(`Track not found: ${trackId}`);

      if (params.name !== undefined) track.name = String(params.name);
      if (params.volume !== undefined)
        track.volume = Math.max(0, Math.min(1.5, Number(params.volume)));
      if (params.pan !== undefined)
        track.pan = Math.max(-1, Math.min(1, Number(params.pan)));
      if (params.mute !== undefined) track.mute = Boolean(params.mute);
      if (params.solo !== undefined) track.solo = Boolean(params.solo);
      if (params.instrument !== undefined)
        track.instrument = String(params.instrument);

      let ignoredParams = [];
      if (params.params && typeof params.params === "object") {
        const instKey = (
          track.instrument ||
          track.kind ||
          "synth"
        ).toLowerCase();
        const schema = INSTRUMENT_SCHEMAS[instKey] || SYNTH_PARAM_SCHEMA;
        const res = validateAndFilterParams(schema, params.params);
        track.params = { ...track.params, ...res.filtered };
        ignoredParams = res.ignoredParams;
      }
      return { project: next, result: { ok: true, track, ignoredParams } };
    }

    case "set_instrument": {
      const trackId = params.trackId || params.id;
      const track = next.tracks.find((t) => t.id === trackId);
      if (!track) throw new Error(`Track not found: ${trackId}`);
      const inst = String(params.instrument || "synth").toLowerCase();
      track.instrument = inst;
      let ignoredParams = [];
      if (params.params && typeof params.params === "object") {
        const schema = INSTRUMENT_SCHEMAS[inst] || SYNTH_PARAM_SCHEMA;
        const res = validateAndFilterParams(schema, params.params);
        track.params = { ...track.params, ...res.filtered };
        ignoredParams = res.ignoredParams;
      }
      return {
        project: next,
        result: {
          ok: true,
          trackId,
          instrument: inst,
          track,
          ignoredParams,
        },
      };
    }

    case "write_notes": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);

      const normalized = normalizeNotes(
        params.units || "ppqn",
        params.notes || [],
        next.signature || [4, 4],
      );
      const mode = params.mode || "replace";

      if (mode === "replace") {
        track.notes = normalized;
      } else {
        // merge
        track.notes = [...track.notes, ...normalized];
      }
      // sort notes by position
      track.notes.sort((a, b) => a.position - b.position);
      return {
        project: next,
        result: { trackId: track.id, count: track.notes.length },
      };
    }

    case "clear_notes": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);

      if (params.fromStep !== undefined || params.toStep !== undefined) {
        const fromPpqn = stepToPpqn(params.fromStep ?? 0);
        const toPpqn = stepToPpqn(params.toStep ?? 128);
        track.notes = track.notes.filter(
          (n) => n.position < fromPpqn || n.position >= toPpqn,
        );
      } else {
        track.notes = [];
      }
      return {
        project: next,
        result: { trackId: track.id, remaining: track.notes.length },
      };
    }

    case "set_master": {
      if (params.volume !== undefined) {
        next.master.volume = Math.max(0, Math.min(1.0, Number(params.volume)));
      }
      return {
        project: next,
        result: { ok: true, volume: next.master.volume },
      };
    }

    case "reset_param": {
      const scope = params.scope || "track";
      const param = params.param;
      if (!param) throw new Error("reset_param requires param name");
      if (scope === "master") {
        const def = MASTER_SCHEMA[param]?.default;
        if (def === undefined)
          throw new Error(`Unknown master param: ${param}`);
        next.master[param] = def;
        return {
          project: next,
          result: { ok: true, scope, param, value: def },
        };
      }
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      if (scope === "track") {
        const def = TRACK_MIX_SCHEMA[param]?.default;
        if (def === undefined)
          throw new Error(`Unknown track mix param: ${param}`);
        track[param] = def;
        return {
          project: next,
          result: { ok: true, trackId: track.id, param, value: def },
        };
      }
      if (scope === "synth") {
        const def = SYNTH_PARAM_SCHEMA[param]?.default;
        if (def === undefined) throw new Error(`Unknown synth param: ${param}`);
        track.params = track.params || {};
        track.params[param] = def;
        return {
          project: next,
          result: { ok: true, trackId: track.id, param, value: def },
        };
      }
      throw new Error(`Unknown scope: ${scope}`);
    }

    case "reset_track": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      const mode = params.mode || "mixer";
      if (mode === "mixer" || mode === "all") {
        track.volume = TRACK_MIX_SCHEMA.volume.default;
        track.pan = TRACK_MIX_SCHEMA.pan.default;
        track.mute = TRACK_MIX_SCHEMA.mute.default;
        track.solo = TRACK_MIX_SCHEMA.solo.default;
      }
      if (mode === "params" || mode === "all") {
        track.params = getDefaultParams(track.kind);
      }
      return { project: next, result: { ok: true, trackId: track.id, mode } };
    }

    case "reset_project": {
      const template = params.template || "basic-beat";
      const created = createProject(template);
      if (params.name) created.name = String(params.name);
      if (params.bpm) created.bpm = Number(params.bpm);
      return { project: created, result: { ok: true, name: created.name } };
    }

    case "apply_preset": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      const presetName = params.preset;
      const presetData = INSTRUMENT_PRESETS[presetName];
      if (!presetData) throw new Error(`Unknown preset: ${presetName}`);
      const targetInstrument = String(
        presetData.instrument || "synth",
      ).toLowerCase();
      track.instrument = targetInstrument;
      const defaultParams = getDefaultParams(targetInstrument);
      track.params = { ...defaultParams, ...presetData };
      return {
        project: next,
        result: {
          ok: true,
          trackId: track.id,
          preset: presetName,
          instrument: targetInstrument,
        },
      };
    }

    case "reset": {
      const scope = params.scope || "project";
      if (scope === "param") {
        return applyCommand(next, "reset_param", params);
      }
      if (scope === "track") {
        return applyCommand(next, "reset_track", params);
      }
      if (scope === "pattern") {
        return applyCommand(next, "clear_notes", params);
      }
      if (scope === "project") {
        return applyCommand(next, "reset_project", params);
      }
      throw new Error(`Unknown reset scope: ${scope}`);
    }

    case "manage_fx": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);

      const fxType = params.fxType;
      const isMidi = [
        "arpeggio",
        "pitch",
        "velocity",
        "zeitgeist",
        "groove",
        "notefilter",
        "filter",
        "chord",
        "humanize",
      ].includes(fxType);
      const fxListKey = isMidi ? "midiFx" : "fx";
      track[fxListKey] = track[fxListKey] || [];

      const action = params.action || "add";
      const fxId =
        params.fxId ||
        `fx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

      if (action === "add") {
        if (!fxType) throw new Error("manage_fx add requires fxType");
        const defaults = getDefaultParams(fxType);
        const newFx = {
          id: fxId,
          type: fxType,
          ...defaults,
          ...(params.params || {}),
        };
        track[fxListKey].push(newFx);
        return {
          project: next,
          result: { ok: true, action: "add", trackId: track.id, fx: newFx },
        };
      }

      if (action === "update") {
        const item = track[fxListKey].find(
          (f) => f.id === params.fxId || f.type === fxType,
        );
        if (!item) {
          throw new Error(`FX not found: ${params.fxId || fxType}`);
        }
        Object.assign(item, params.params || {});
        return {
          project: next,
          result: { ok: true, action: "update", trackId: track.id, fx: item },
        };
      }

      if (action === "reset") {
        const item = track[fxListKey].find(
          (f) => f.id === params.fxId || f.type === fxType,
        );
        if (!item) {
          throw new Error(`FX not found: ${params.fxId || fxType}`);
        }
        const defaults = getDefaultParams(item.type);
        for (const [k, v] of Object.entries(defaults)) {
          item[k] = v;
        }
        return {
          project: next,
          result: { ok: true, action: "reset", trackId: track.id, fx: item },
        };
      }

      if (action === "remove") {
        const lenBefore = track[fxListKey].length;
        track[fxListKey] = track[fxListKey].filter(
          (f) => f.id !== params.fxId && f.type !== fxType,
        );
        if (track[fxListKey].length === lenBefore) {
          throw new Error(`FX not found: ${params.fxId || fxType}`);
        }
        return {
          project: next,
          result: {
            ok: true,
            action: "remove",
            trackId: track.id,
            remaining: track[fxListKey].length,
          },
        };
      }

      throw new Error(`Unknown manage_fx action: ${action}`);
    }

    case "toggle_step": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      const step = Number(params.step ?? 0);
      track.stepMemory = track.stepMemory || {};

      const targetPitch =
        params.pitch !== undefined ? parsePitch(params.pitch) : null;
      const existingIndex = track.notes.findIndex((n) => {
        const nStep = ppqnToStep(n.position);
        if (nStep !== step) return false;
        if (targetPitch !== null) return n.pitch === targetPitch;
        return true;
      });

      if (existingIndex !== -1) {
        const removedNote = track.notes[existingIndex];
        track.stepMemory[step] = {
          pitch: removedNote.pitch,
          duration: removedNote.duration,
          velocity: removedNote.velocity,
        };
        track.notes.splice(existingIndex, 1);
        return {
          project: next,
          result: { ok: true, toggled: "off", step, trackId: track.id },
        };
      } else {
        const mem = track.stepMemory[step];
        const pitch =
          targetPitch !== null
            ? targetPitch
            : mem
              ? mem.pitch
              : track.defaultPitch || (track.kind === "drums" ? 36 : 60);
        const duration = mem
          ? mem.duration
          : (params.duration ?? PPQN.SemiQuaver);
        const velocity = mem ? mem.velocity : (params.velocity ?? 0.85);

        const newNote = {
          position: stepToPpqn(step),
          duration,
          pitch,
          velocity,
        };
        track.notes.push(newNote);
        track.notes.sort((a, b) => a.position - b.position);
        return {
          project: next,
          result: {
            ok: true,
            toggled: "on",
            step,
            trackId: track.id,
            note: newNote,
          },
        };
      }
    }

    case "set_step_velocity": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      const step = Number(params.step ?? 0);
      const rawVel = Number(params.velocity ?? 0.85);
      const velocity =
        Math.round(Math.max(0.05, Math.min(1, rawVel)) * 100) / 100;

      let updated = 0;
      for (const note of track.notes) {
        if (ppqnToStep(note.position) === step) {
          note.velocity = velocity;
          updated++;
        }
      }
      if (track.stepMemory && track.stepMemory[step]) {
        track.stepMemory[step].velocity = velocity;
      }

      return {
        project: next,
        result: {
          ok: true,
          trackId: track.id,
          step,
          velocity,
          updated,
        },
      };
    }

    case "set_automation": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      const param = params.param;
      if (!param || typeof param !== "string") {
        throw new Error("set_automation requires a valid param name");
      }
      track.automation = track.automation || {};

      if (Array.isArray(params.points)) {
        track.automation[param] = [...params.points]
          .map((pt) => ({
            time: Number(pt.time || 0),
            value: Number(pt.value || 0),
          }))
          .sort((a, b) => a.time - b.time);
      } else if (params.time !== undefined && params.value !== undefined) {
        track.automation[param] = track.automation[param] || [];
        const t = Number(params.time);
        const v = Number(params.value);
        const existingIdx = track.automation[param].findIndex(
          (p) => Math.abs(p.time - t) < 0.0001,
        );
        if (existingIdx !== -1) {
          track.automation[param][existingIdx].value = v;
        } else {
          track.automation[param].push({ time: t, value: v });
          track.automation[param].sort((a, b) => a.time - b.time);
        }
      } else {
        throw new Error(
          "set_automation requires points array or time/value pair",
        );
      }

      return {
        project: next,
        result: {
          ok: true,
          trackId: track.id,
          param,
          pointCount: track.automation[param].length,
        },
      };
    }

    case "clear_automation": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      if (params.param) {
        if (track.automation) {
          track.automation[params.param] = [];
        }
      } else {
        track.automation = {};
      }
      return {
        project: next,
        result: {
          ok: true,
          trackId: track.id,
          param: params.param || "all",
        },
      };
    }

    case "add_audio_clip": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      track.audioClips = track.audioClips || [];

      const rawClip = params.clip || {};
      const clipId =
        rawClip.id ||
        `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const clip = {
        id: clipId,
        name: rawClip.name || "Audio Clip",
        sample: rawClip.sample || "",
        time: Number(rawClip.time ?? 0),
        duration: Number(rawClip.duration ?? 4),
        offset: Number(rawClip.offset ?? 0),
        gain: Number(rawClip.gain ?? 1.0),
      };

      track.audioClips.push(clip);
      track.audioClips.sort((a, b) => a.time - b.time);

      return {
        project: next,
        result: { ok: true, trackId: track.id, clipId: clip.id, clip },
      };
    }

    case "set_audio_clip": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      track.audioClips = track.audioClips || [];
      const clip = track.audioClips.find((c) => c.id === params.clipId);
      if (!clip) throw new Error(`Audio clip not found: ${params.clipId}`);

      if (params.patch && typeof params.patch === "object") {
        if (params.patch.name !== undefined)
          clip.name = String(params.patch.name);
        if (params.patch.sample !== undefined)
          clip.sample = String(params.patch.sample);
        if (params.patch.time !== undefined)
          clip.time = Number(params.patch.time);
        if (params.patch.duration !== undefined)
          clip.duration = Number(params.patch.duration);
        if (params.patch.offset !== undefined)
          clip.offset = Number(params.patch.offset);
        if (params.patch.gain !== undefined)
          clip.gain = Math.max(0, Math.min(2.0, Number(params.patch.gain)));
        track.audioClips.sort((a, b) => a.time - b.time);
      }

      return {
        project: next,
        result: { ok: true, trackId: track.id, clipId: clip.id, clip },
      };
    }

    case "remove_audio_clip": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      track.audioClips = track.audioClips || [];
      const initialLen = track.audioClips.length;
      track.audioClips = track.audioClips.filter((c) => c.id !== params.clipId);
      if (track.audioClips.length === initialLen) {
        throw new Error(`Audio clip not found: ${params.clipId}`);
      }
      return {
        project: next,
        result: { ok: true, trackId: track.id, clipId: params.clipId },
      };
    }

    case "set_track_send": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      const target = next.tracks.find((t) => t.id === params.targetTrackId);
      if (!target)
        throw new Error(`Target track not found: ${params.targetTrackId}`);

      track.sends = track.sends || [];
      const level = Math.max(0, Math.min(1.0, Number(params.level ?? 0)));
      const existing = track.sends.find(
        (s) => s.targetTrackId === params.targetTrackId,
      );
      if (existing) {
        existing.level = level;
      } else {
        track.sends.push({ targetTrackId: params.targetTrackId, level });
      }

      return {
        project: next,
        result: {
          ok: true,
          trackId: track.id,
          targetTrackId: params.targetTrackId,
          level,
        },
      };
    }

    case "remove_track_send": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      track.sends = track.sends || [];
      track.sends = track.sends.filter(
        (s) => s.targetTrackId !== params.targetTrackId,
      );
      return {
        project: next,
        result: {
          ok: true,
          trackId: track.id,
          targetTrackId: params.targetTrackId,
        },
      };
    }

    case "set_track_record_arm": {
      const track = next.tracks.find((t) => t.id === params.trackId);
      if (!track) throw new Error(`Track not found: ${params.trackId}`);
      track.recordArm = Boolean(params.armed);
      return {
        project: next,
        result: { ok: true, trackId: track.id, armed: track.recordArm },
      };
    }

    case "set_metronome": {
      if (!next.metronome || typeof next.metronome !== "object") {
        next.metronome = { enabled: false, volume: 0.8 };
      }
      if (params.enabled !== undefined) {
        next.metronome.enabled = Boolean(params.enabled);
      }
      if (params.volume !== undefined) {
        next.metronome.volume = Math.max(
          0,
          Math.min(1.0, Number(params.volume)),
        );
      }
      return {
        project: next,
        result: { ok: true, metronome: next.metronome },
      };
    }

    case "analyze_mix": {
      const durSec = Math.max(
        0.2,
        Math.min(
          60.0,
          Number(params.durationSeconds || params.duration || 2.0),
        ),
      );
      const sampleRate = Number(params.sampleRate || 44100);
      const totalFrames = Math.round(durSec * sampleRate);
      const left = new Float32Array(totalFrames);
      const right = new Float32Array(totalFrames);

      const bpm = next.bpm || 120;
      const masterVol =
        typeof next.master?.volume === "number" ? next.master.volume : 0.8;

      const tracks = next.tracks || [];
      const hasSolo = tracks.some((t) => t.solo);

      for (const track of tracks) {
        if (track.mute) continue;
        if (hasSolo && !track.solo) continue;

        const trkVol =
          (typeof track.volume === "number" ? track.volume : 0.8) * masterVol;
        const pan =
          typeof track.pan === "number"
            ? Math.max(-1, Math.min(1, track.pan))
            : 0;
        const panAngle = (pan + 1) * (Math.PI / 4);
        const gainL = Math.cos(panAngle) * trkVol;
        const gainR = Math.sin(panAngle) * trkVol;

        const isDrums = track.kind === "drums";
        const notes = track.notes || [];

        for (const note of notes) {
          const noteStartSec = pulsesToSeconds(note.position, bpm);
          if (noteStartSec >= durSec) continue;

          const noteDurSec = Math.min(
            durSec - noteStartSec,
            pulsesToSeconds(note.duration || PPQN.SemiQuaver, bpm),
          );
          const startFrame = Math.floor(noteStartSec * sampleRate);
          const noteFrames = Math.floor(noteDurSec * sampleRate);
          const vel =
            typeof note.velocity === "number"
              ? note.velocity > 1.0
                ? note.velocity / 127
                : note.velocity
              : 0.8;

          const pitch = typeof note.pitch === "number" ? note.pitch : 60;
          const freq = isDrums
            ? pitch === 36
              ? 55
              : pitch === 38
                ? 200
                : 8000
            : 440 * Math.pow(2, (pitch - 69) / 12);

          for (let f = 0; f < noteFrames && startFrame + f < totalFrames; f++) {
            const t = f / sampleRate;
            const env = Math.exp(-t * (isDrums ? 12 : 3));
            let s = Math.sin(2 * Math.PI * freq * t) * env * vel;
            if (isDrums && pitch === 38) {
              s = (s * 0.5 + (Math.random() * 2 - 1) * 0.5) * env * vel;
            }
            left[startFrame + f] += s * gainL;
            right[startFrame + f] += s * gainR;
          }
        }
      }

      if (next.master?.limiter?.enabled) {
        const ceilingLin = Math.pow(
          10,
          (next.master.limiter.ceilingDb ?? -0.3) / 20,
        );
        for (let i = 0; i < totalFrames; i++) {
          if (Math.abs(left[i]) > ceilingLin) {
            left[i] = Math.tanh(left[i] / ceilingLin) * ceilingLin;
          }
          if (Math.abs(right[i]) > ceilingLin) {
            right[i] = Math.tanh(right[i] / ceilingLin) * ceilingLin;
          }
        }
      }

      const analysis = analyzeAudioBuffer({ left, right, sampleRate });
      return {
        project: next,
        result: {
          ...analysis,
          project: next.name || "Untitled",
          durationSeconds: durSec,
        },
      };
    }

    default:
      throw new Error(`Unknown command: ${name}`);
  }
}

/**
 * Chord Voicings (semitone intervals above root note).
 */
export const CHORD_VOICINGS = Object.freeze({
  octave: [0, 12],
  power: [0, 7, 12],
  triad: [0, 4, 7],
  major: [0, 4, 7],
  minor: [0, 3, 7],
  "7th": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
});

/**
 * Filter MIDI notes by key range and velocity split zones.
 * Ported from openDAW NoteFilter / Zone device.
 *
 * @param {Array<object>} notes
 * @param {object} options
 * @returns {Array<object>}
 */
export function applyNoteFilter(notes, options = {}) {
  const minPitch = options.minPitch ?? 0;
  const maxPitch = options.maxPitch ?? 127;
  const minVel = options.minVelocity ?? 0.01;
  const maxVel = options.maxVelocity ?? 1.0;

  return notes.filter((n) => {
    const pitch = n.pitch ?? 60;
    const vel = n.velocity ?? 0.8;
    return (
      pitch >= minPitch && pitch <= maxPitch && vel >= minVel && vel <= maxVel
    );
  });
}

/**
 * Expands notes into multi-voice chords with guitar-style strum delay.
 * Ported from claw-daw & openDAW chord devices.
 *
 * @param {Array<object>} notes
 * @param {object} options
 * @returns {Array<object>}
 */
export function applyChordStrum(notes, options = {}) {
  const type = String(
    options.type || options.chordType || "triad",
  ).toLowerCase();
  const intervals = CHORD_VOICINGS[type] || CHORD_VOICINGS.triad;
  const strumTicks = Math.max(0, Number(options.strumTicks || 0));
  const direction = String(options.direction || "up").toLowerCase();

  const out = [];
  for (const n of notes) {
    const chordPitches = intervals.map((intv) =>
      Math.max(0, Math.min(127, n.pitch + intv)),
    );
    if (direction === "down") {
      chordPitches.reverse();
    }
    for (let i = 0; i < chordPitches.length; i++) {
      const offset = i * strumTicks;
      out.push({
        ...n,
        pitch: chordPitches[i],
        position: Math.max(0, n.position + offset),
        duration: Math.max(PPQN.SemiQuaver / 2, n.duration - offset),
      });
    }
  }
  return out;
}

/**
 * Applies micro-timing groove displacement using classic templates.
 * Ported from openDAW Zeitgeist Groove Engine & GrooveCurves.
 *
 * @param {Array<object>} notes
 * @param {object} options
 * @returns {Array<object>}
 */
export function applyZeitgeistGroove(notes, options = {}) {
  const template = String(options.template || "swing16").toLowerCase();
  const amount = Math.max(0, Math.min(1.0, options.amount ?? 0.5));
  if (amount === 0 || template === "straight") {
    return [...notes];
  }

  return notes.map((n) => {
    let newPos = n.position;
    const beatPos = newPos % PPQN.Quarter;
    const normPhase = beatPos / PPQN.Quarter;

    if (template === "mpc60") {
      if (beatPos >= 180 && beatPos <= 300) {
        newPos += Math.round(amount * 110);
      }
    } else if (template === "sp1200") {
      if (beatPos >= 180 && beatPos <= 300) {
        newPos += Math.round(amount * 90);
      }
    } else if (template === "swing16") {
      if (beatPos >= 180 && beatPos <= 300) {
        newPos += Math.round(amount * 120);
      }
    } else if (template === "shuffle") {
      if (beatPos >= 180 && beatPos <= 300) {
        newPos += Math.round(amount * 160);
      }
    } else if (template === "laidback") {
      if (beatPos > 0) {
        newPos += Math.round(amount * 35);
      }
    } else if (template === "rushed") {
      if (beatPos > 0) {
        newPos = Math.max(0, newPos - Math.round(amount * 35));
      }
    } else if (template === "scurve") {
      const warpedPhase =
        normPhase < 0.5
          ? 0.5 - 0.5 * Math.pow(1.0 - 2.0 * normPhase, 2.0)
          : 0.5 + 0.5 * Math.pow(2.0 * normPhase - 1.0, 2.0);
      const shift = (warpedPhase - normPhase) * PPQN.Quarter * amount;
      newPos = Math.max(0, Math.round(newPos + shift));
    } else if (template === "power") {
      const warpedPhase = 1.0 - Math.pow(1.0 - normPhase, 2.0);
      const shift = (warpedPhase - normPhase) * PPQN.Quarter * amount;
      newPos = Math.max(0, Math.round(newPos + shift));
    }

    return { ...n, position: Math.max(0, newPos) };
  });
}

/**
 * Deterministic humanization adding micro-timing and velocity deviations.
 * Ported from claw-daw/claw_daw/util/groove.py.
 *
 * @param {Array<object>} notes
 * @param {object} options
 * @returns {Array<object>}
 */
export function applyHumanize(notes, options = {}) {
  const timingTicks = Math.max(0, Number(options.timingTicks || 0));
  const velJitter = Math.max(0, Number(options.velocity || 0));
  const seed = Number(options.seed ?? 42);

  if (timingTicks === 0 && velJitter === 0) {
    return [...notes];
  }

  let s = (seed ^ 0x6d2b79f5) >>> 0;
  function rnd() {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  }

  return notes.map((n) => {
    const dt = timingTicks > 0 ? Math.round((rnd() * 2 - 1) * timingTicks) : 0;
    const dv = velJitter > 0 ? ((rnd() * 2 - 1) * velJitter) / 127 : 0;

    return {
      ...n,
      position: Math.max(0, n.position + dt),
      velocity: Math.max(0.01, Math.min(1.0, n.velocity + dv)),
    };
  });
}

export function resolveTrackNotes(
  project,
  track,
  { loops = 1, bakeMidiFx = true, bakeSwing = true } = {},
) {
  const loopCount =
    typeof loops === "number" ? Math.max(1, Math.floor(loops)) : 1;
  const totalPulses =
    (project.lengthBars || 1) * barPulses(project.signature || [4, 4]);
  const swing = bakeSwing ? project.swing || 0 : 0;
  let trackNotes = track.notes || [];

  if (bakeMidiFx && Array.isArray(track.midiFx) && track.midiFx.length > 0) {
    // 1. Note Filter
    const filterFx = track.midiFx.find(
      (f) => f.type === "notefilter" || f.type === "filter",
    );
    if (filterFx) {
      trackNotes = applyNoteFilter(trackNotes, filterFx);
    }

    // 2. Chord / Strummer
    const chordFx = track.midiFx.find((f) => f.type === "chord");
    if (chordFx && trackNotes.length > 0) {
      trackNotes = applyChordStrum(trackNotes, chordFx);
    }

    // 3. Arpeggiator
    const arpFx = track.midiFx.find((f) => f.type === "arpeggio");
    if (arpFx && trackNotes.length > 0) {
      const ratePulses = Math.max(
        PPQN.SemiQuaver / 2,
        (arpFx.rateSteps || 1) * PPQN.SemiQuaver,
      );
      const octaves = Math.max(1, Math.min(4, arpFx.octaves || 1));
      const basePitches = [...new Set(trackNotes.map((n) => n.pitch))].sort(
        (a, b) => a - b,
      );
      const expandedPitches = [];
      for (let oct = 0; oct < octaves; oct++) {
        for (const p of basePitches) {
          expandedPitches.push(p + oct * 12);
        }
      }
      if (arpFx.mode === "down") expandedPitches.reverse();

      const arpeggiatedNotes = [];
      let stepIdx = 0;
      for (let pos = 0; pos < totalPulses; pos += ratePulses) {
        const held = trackNotes.find(
          (n) => pos >= n.position && pos < n.position + n.duration,
        );
        if (held) {
          const pitch = expandedPitches[stepIdx % expandedPitches.length];
          arpeggiatedNotes.push({
            position: pos,
            duration: Math.round(ratePulses * (arpFx.gate || 0.8)),
            pitch,
            velocity: held.velocity,
          });
          stepIdx++;
        }
      }
      trackNotes = arpeggiatedNotes;
    }

    // 4. Pitch Transpose
    const pitchFx = track.midiFx.find((f) => f.type === "pitch");
    if (pitchFx) {
      const offset = (pitchFx.semitones || 0) + (pitchFx.octaves || 0) * 12;
      trackNotes = trackNotes.map((n) => ({
        ...n,
        pitch: Math.max(0, Math.min(127, n.pitch + offset)),
      }));
    }

    // 5. Velocity Adjust
    const velFx = track.midiFx.find((f) => f.type === "velocity");
    if (velFx) {
      trackNotes = trackNotes.map((n) => {
        let v = n.velocity * (1 + (velFx.drive || 0));
        if (velFx.random) {
          v += (Math.random() * 2 - 1) * velFx.random;
        }
        return { ...n, velocity: Math.max(0.01, Math.min(1.0, v)) };
      });
    }

    // 6. Zeitgeist Groove Engine
    const zeitFx = track.midiFx.find(
      (f) => f.type === "zeitgeist" || f.type === "groove",
    );
    if (zeitFx) {
      trackNotes = applyZeitgeistGroove(trackNotes, zeitFx);
    }

    // 7. Humanizer
    const humanFx = track.midiFx.find((f) => f.type === "humanize");
    if (humanFx) {
      trackNotes = applyHumanize(trackNotes, humanFx);
    }
  }

  const resolved = [];
  for (let l = 0; l < loopCount; l++) {
    const loopOffset = l * totalPulses;
    for (const note of trackNotes) {
      let pos = loopCount > 1 ? note.position % totalPulses : note.position;
      if (swing > 0) {
        const step = ppqnToStep(pos);
        if (step % 2 === 1) {
          pos += Math.round(swing * PPQN.SemiQuaver);
        }
      }
      resolved.push({
        position: loopOffset + pos,
        duration: note.duration,
        pitch: note.pitch,
        velocity: note.velocity,
      });
    }
  }

  return resolved.sort((a, b) => a.position - b.position);
}

export function computeEventsInRange(project, fromPpqn, toPpqn) {
  const totalPulses =
    (project.lengthBars || 1) * barPulses(project.signature || [4, 4]);
  const isLooping = project.loop ? project.loop.enabled !== false : true;
  const events = [];
  const hasSolo = project.tracks.some((t) => t.solo);

  for (const track of project.tracks) {
    if (track.mute) continue;
    if (hasSolo && !track.solo) continue;

    const resolvedNotes = resolveTrackNotes(project, track, {
      loops: 1,
      bakeMidiFx: true,
      bakeSwing: true,
    });

    for (const note of resolvedNotes) {
      const triggerPos = isLooping
        ? note.position % totalPulses
        : note.position;
      let inRange = false;
      if (fromPpqn <= toPpqn) {
        inRange = triggerPos >= fromPpqn && triggerPos < toPpqn;
      } else {
        // wrapped range (e.g. from 3800 to 200)
        inRange = triggerPos >= fromPpqn || triggerPos < toPpqn;
      }

      if (inRange) {
        events.push({
          trackId: track.id,
          trackKind: track.kind,
          trackInstrument:
            track.instrument || track.params?.instrument || track.kind,
          trackParams: track.params,
          trackVolume: track.volume,
          trackPan: track.pan,
          position: triggerPos,
          note,
        });
      }
    }
  }

  return events.sort((a, b) => a.position - b.position);
}

export function linToDb(linear) {
  if (linear <= 1e-5) return -100;
  return 20 * Math.log10(linear);
}

export function dbToLin(db) {
  if (db <= -100) return 0;
  return Math.pow(10, db / 20);
}

export function peakAndRms(channelData) {
  let peak = 0;
  let sumSq = 0;
  const len = channelData.length;

  for (let i = 0; i < len; i++) {
    const val = Math.abs(channelData[i]);
    if (val > peak) peak = val;
    sumSq += val * val;
  }

  const rms = len > 0 ? Math.sqrt(sumSq / len) : 0;
  return {
    peakDb: linToDb(peak),
    rmsDb: linToDb(rms),
    clipping: peak >= 1.0,
  };
}

/**
 * Computes audible audio length in sample frames, preserving at least minLength
 * and trimming silence tails that fall below the given threshold (default -72dBFS).
 * Ported concept from openDAW AudioBounce.ts.
 * @param {Float32Array[]} frames - Array of channel Float32Arrays
 * @param {number} minLength - Minimum frame count (e.g. musical length)
 * @param {number} length - Total rendered frame count including tail
 * @param {number} [threshold=0.00025118864] - Amplitude silence threshold (-72 dBFS)
 * @returns {number}
 */
export function audibleLength(
  frames,
  minLength,
  length,
  threshold = 0.00025118864,
) {
  for (let index = length - 1; index >= minLength; index--) {
    for (let c = 0; c < frames.length; c++) {
      if (Math.abs(frames[c][index]) > threshold) {
        return index + 1;
      }
    }
  }
  return minLength;
}

export function encodeWav(channels, sampleRate, options = {}) {
  const numChannels = channels.length;
  const numFrames = channels[0].length;
  const bitDepth =
    options.bitDepth === 24 ? 24 : options.bitDepth === 32 ? 32 : 16;
  const bytesPerSample = bitDepth / 8;
  const audioFormat = bitDepth === 32 ? 3 : 1; // 1 = PCM, 3 = IEEE float
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // Write ASCII string helper
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");

  // fmt subchunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // subchunk1 size (16 for PCM/Float)
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data subchunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channel samples
  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const int16 =
          sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const int24 =
          sample < 0
            ? Math.round(sample * 8388608)
            : Math.round(sample * 8388607);
        view.setUint8(offset, int24 & 0xff);
        view.setUint8(offset + 1, (int24 >> 8) & 0xff);
        view.setUint8(offset + 2, (int24 >> 16) & 0xff);
        offset += 3;
      }
    }
  } else if (bitDepth === 32) {
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        view.setFloat32(offset, channels[ch][i], true);
        offset += 4;
      }
    }
  }

  return buffer;
}

export function decodeWavHeader(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const readString = (offset, len) => {
    let str = "";
    for (let i = 0; i < len; i++) {
      str += String.fromCharCode(view.getUint8(offset + i));
    }
    return str;
  };

  const riff = readString(0, 4);
  const wave = readString(8, 4);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Invalid WAV format: Missing RIFF/WAVE header");
  }

  let offset = 12;
  let audioFormat = 1;
  let numChannels = 2;
  let sampleRate = 44100;
  let byteRate = 0;
  let blockAlign = 4;
  let bitsPerSample = 16;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readString(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      byteRate = view.getUint32(offset + 16, true);
      blockAlign = view.getUint16(offset + 20, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  const numFrames = blockAlign > 0 ? Math.floor(dataSize / blockAlign) : 0;

  return {
    audioFormat,
    numChannels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    dataSize,
    numFrames,
  };
}

export function serializeProject(project) {
  const migrated = migrateProject(project);
  return JSON.stringify(migrated, null, 2);
}

export function deserializeProject(input) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  const migrated = migrateProject(parsed);
  const val = validateProject(migrated);
  if (!val.valid) {
    throw new Error(`Invalid project: ${val.errors.join(", ")}`);
  }
  return migrated;
}

export function createHistory(limit = 50) {
  const stack = [];

  return {
    push(snapshot) {
      stack.push(structuredClone(snapshot));
      if (stack.length > limit) {
        stack.shift();
      }
    },
    undo() {
      if (stack.length > 0) {
        return stack.pop();
      }
      return null;
    },
    canUndo() {
      return stack.length > 0;
    },
    clear() {
      stack.length = 0;
    },
    size() {
      return stack.length;
    },
  };
}
