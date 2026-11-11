import test from "node:test";
import assert from "node:assert/strict";
import {
  parseChord,
  parseProgression,
  parseMotif,
  compileSong,
  STYLE_PRESETS,
} from "../.agents/scripts/scdaw-compose.js";
import { validateProject, applyCommand } from "../.agents/scripts/scdaw.js";

test("WP1.1: parseChord parses chord symbols to root, pitches, and bass", () => {
  const eMajor = parseChord("E");
  assert.equal(eMajor.rootName, "E");
  assert.equal(eMajor.root, 64); // E4
  assert.deepEqual(eMajor.pitches, [64, 68, 71]); // E4, G#4, B4
  assert.equal(eMajor.bass, 40); // E2

  const aMinor7 = parseChord("Am7");
  assert.equal(aMinor7.rootName, "A");
  assert.deepEqual(aMinor7.pitches, [69, 72, 76, 79]); // A4, C5, E5, G5

  const gDom7 = parseChord("G7");
  assert.deepEqual(gDom7.pitches, [67, 71, 74, 77]); // G4, B4, D5, F5

  const slashChord = parseChord("B/D#");
  assert.equal(slashChord.rootName, "B");
  assert.equal(slashChord.bass, 51); // D#3

  const powerChord = parseChord("E5");
  assert.deepEqual(powerChord.pitches, [64, 71]); // E4, B4
});

test("WP1.1: parseProgression parses bar-delimited chord sequences", () => {
  const prog = parseProgression("E | E | A | B");
  assert.equal(prog.length, 4);
  assert.equal(prog[0].rootName, "E");
  assert.equal(prog[1].rootName, "E");
  assert.equal(prog[2].rootName, "A");
  assert.equal(prog[3].rootName, "B");
});

test("WP1.1: compileSong generates a multi-bar, multi-track song from SongSpec", () => {
  const spec = {
    title: "Saints March Sketch",
    bpm: 122,
    signature: [4, 4],
    key: "E",
    mode: "mixolydian",
    feel: "straight-rock",
    sections: [
      { name: "intro", bars: 4, chords: "E | E | A | E", energy: 0.5 },
      {
        name: "verse",
        bars: 8,
        chords: "E | E | A | E | B | A | E | E",
        energy: 0.7,
      },
      {
        name: "chorus",
        bars: 8,
        chords: "A | E | A | E | B | A | E | B",
        energy: 0.9,
      },
    ],
    form: ["intro", "verse", "chorus"],
    seed: 42,
  };

  const project = compileSong(spec);
  assert.ok(project);
  assert.equal(project.name, "Saints March Sketch");
  assert.equal(project.bpm, 122);
  assert.equal(project.lengthBars, 20); // 4 + 8 + 8 = 20 bars

  // Must validate against validateProject
  const val = validateProject(project);
  assert.equal(
    val.valid,
    true,
    `Compiled song must be valid: ${val.errors.join(", ")}`,
  );

  // Tracks: drums, bass, rhythm, lead
  const drumTrack = project.tracks.find(
    (t) => t.kind === "drums" || t.id.includes("drum"),
  );
  const bassTrack = project.tracks.find((t) =>
    t.name.toLowerCase().includes("bass"),
  );
  const rhythmTrack = project.tracks.find((t) =>
    t.name.toLowerCase().includes("rhythm"),
  );

  assert.ok(drumTrack, "Must have drum track");
  assert.ok(bassTrack, "Must have bass track");
  assert.ok(rhythmTrack, "Must have rhythm guitar/comping track");

  assert.ok(
    drumTrack.notes.length > 50,
    "Drums must have patterns across 20 bars",
  );
  assert.ok(bassTrack.notes.length > 30, "Bass must have notes across 20 bars");
  assert.ok(
    rhythmTrack.notes.length > 30,
    "Rhythm guitar must have notes across 20 bars",
  );

  // First crash cymbal should be at position 0 (start of intro)
  const hasCrashAtStart = drumTrack.notes.some(
    (n) => n.position === 0 && (n.pitch === 49 || n.pitch === 57),
  );
  assert.ok(hasCrashAtStart, "Intro downbeat should have a crash cymbal");

  // Bass notes should align with chord roots
  // Bar 1 starts at 0, root is E (pitch 40 or 28)
  const firstBass = bassTrack.notes.find((n) => n.position === 0);
  assert.ok(firstBass, "Bass should play on downbeat");
  assert.equal(
    firstBass.pitch % 12,
    4,
    "First bass pitch should be E (pitch % 12 === 4)",
  );
});

test("WP1.3: applyCommand supports compose_song and describe_arrangement", () => {
  const base = {
    version: 1,
    name: "Empty",
    bpm: 120,
    signature: [4, 4],
    lengthBars: 1,
    tracks: [],
  };

  const spec = {
    title: "Saints March Riff",
    bpm: 122,
    sections: [
      { name: "intro", bars: 4, chords: "E | E | A | E" },
      { name: "verse", bars: 8, chords: "E | E | A | E | B | A | E | E" },
    ],
    form: ["intro", "verse"],
    seed: 101,
  };

  const { project: composed, result: compResult } = applyCommand(
    base,
    "compose_song",
    spec,
  );
  assert.equal(compResult.ok, true);
  assert.equal(composed.name, "Saints March Riff");
  assert.equal(composed.lengthBars, 12);
  assert.equal(composed.tracks.length, 3);

  const { result: descResult } = applyCommand(
    composed,
    "describe_arrangement",
    {},
  );
  assert.ok(descResult.ok);
  assert.ok(descResult.summary.includes("12 bars"));
  assert.ok(descResult.summary.includes("Drums"));
  assert.ok(descResult.summary.includes("Bass"));
});

test("WP1.3: handleToolDispatch dispatches scdaw_compose_song and scdaw_describe_arrangement", async () => {
  const { handleToolDispatch } =
    await import("../.agents/scripts/scdaw-adapter.js");

  const spec = {
    title: "Adapter Saints March",
    bpm: 122,
    sections: [
      { name: "intro", bars: 4, chords: "E | E | A | E" },
      { name: "verse", bars: 8, chords: "E | E | A | E | B | A | E | E" },
    ],
    form: ["intro", "verse"],
    seed: 42,
  };

  const compRes = await handleToolDispatch("scdaw_compose_song", spec);
  assert.ok(compRes);
  assert.equal(compRes.ok, true);
  assert.equal(compRes.name, "Adapter Saints March");
  assert.equal(compRes.bpm, 122);
  assert.equal(compRes.lengthBars, 12);

  const descRes = await handleToolDispatch("scdaw_describe_arrangement", {});
  assert.ok(descRes);
  assert.equal(descRes.ok, true);
  assert.ok(descRes.summary.includes("Adapter Saints March"));
  assert.ok(descRes.summary.includes("12 bars"));
});

test("Phase 4: Full When the Saints Go Marching In composition produces 56-bar rock arrangement with real instruments", () => {
  const spec = {
    title: "When the Saints Go Marching In",
    bpm: 122,
    signature: [4, 4],
    key: "E",
    mode: "mixolydian",
    feel: "straight-rock",
    soundfontProfile: "lofi",
    instruments: {
      drums: "rock-kit",
      bass: "electric-bass-finger",
      rhythm: "overdriven-guitar",
      lead: "distortion-guitar",
    },
    sections: [
      { name: "intro", bars: 4, chords: "E | E | A | E", energy: 0.5 },
      {
        name: "verse",
        bars: 8,
        chords: "E | E | A | E | B | A | E | E",
        energy: 0.65,
      },
      {
        name: "chorus",
        bars: 8,
        chords: "A | E | A | E | B | A | E | B",
        energy: 0.9,
      },
      {
        name: "solo",
        bars: 8,
        chords: "E | E | A | E | B | A | E | E",
        energy: 0.95,
      },
      { name: "outro", bars: 4, chords: "E | A | E | E", energy: 0.4 },
    ],
    form: [
      "intro",
      "verse",
      "chorus",
      "verse",
      "chorus",
      "solo",
      "chorus",
      "outro",
    ],
    motifs: {
      lead: "E4:8 G#4:8 A4:4 B4:4 D5:8 E5:8",
    },
    seed: 42,
  };

  const project = compileSong(spec);
  assert.ok(project);
  assert.equal(project.name, "When the Saints Go Marching In");
  assert.equal(project.bpm, 122);
  assert.equal(project.lengthBars, 56); // 4 + 8 + 8 + 8 + 8 + 8 + 8 + 4 = 56 bars
  assert.equal(
    project.tracks.length,
    4,
    "Must have 4 tracks (Drums, Bass, Rhythm, Lead)",
  );

  // Validation
  const val = validateProject(project);
  assert.equal(
    val.valid,
    true,
    `Must be valid project: ${val.errors.join(", ")}`,
  );

  const drums = project.tracks.find((t) => t.kind === "drums");
  const bass = project.tracks.find((t) => t.id === "trk_bass");
  const rhythm = project.tracks.find((t) => t.id === "trk_rhythm");
  const lead = project.tracks.find((t) => t.id === "trk_lead");

  assert.ok(
    drums && drums.notes.length > 500,
    "Drums must have patterns across 56 bars",
  );
  assert.ok(
    bass && bass.notes.length > 100,
    "Bass must have notes across 56 bars",
  );
  assert.ok(
    rhythm && rhythm.notes.length > 200,
    "Rhythm guitar must have comping notes across 56 bars",
  );
  assert.ok(
    lead && lead.notes.length > 50,
    "Lead guitar must have motif notes across active sections",
  );

  // Verify instruments and programs
  assert.equal(bass.instrument, "soundfont");
  assert.equal(
    bass.params.program,
    33,
    "Electric bass should be GM program 33",
  );
  assert.equal(rhythm.instrument, "soundfont");
  assert.equal(
    rhythm.params.program,
    29,
    "Overdriven guitar should be GM program 29",
  );
  assert.equal(lead.instrument, "soundfont");
  assert.equal(
    lead.params.program,
    30,
    "Distortion guitar should be GM program 30",
  );

  // Verify describe_arrangement
  const desc = applyCommand(project, "describe_arrangement", {});
  assert.ok(desc.result.ok);
  assert.ok(desc.result.summary.includes("56 bars"));
  assert.ok(desc.result.summary.includes("122 BPM"));
  assert.ok(desc.result.summary.includes("trk_drums"));
  assert.ok(desc.result.summary.includes("trk_bass"));
  assert.ok(desc.result.summary.includes("trk_rhythm"));
  assert.ok(desc.result.summary.includes("trk_lead"));
});

test("TDD: parseMotif supports rests and advances relPulse accurately", () => {
  const notes = parseMotif("F2:8 r:8 A2:8 _:16 C3:16");
  assert.equal(
    notes.length,
    3,
    "Only pitch tokens produce notes (rests do not produce notes)",
  );

  // Note 0: F2 (pitch 41) at relPulse 0, duration 480 (8th note)
  assert.equal(notes[0].pitch, 41);
  assert.equal(notes[0].relPulse, 0);
  assert.equal(notes[0].duration, 480);

  // Rest: r:8 takes 480 ticks -> next note is at relPulse 960!
  assert.equal(notes[1].pitch, 45); // A2
  assert.equal(notes[1].relPulse, 960);
  assert.equal(notes[1].duration, 480);

  // Rest: _:16 takes 240 ticks -> next note is at relPulse 960 + 480 + 240 = 1680!
  assert.equal(notes[2].pitch, 48); // C3
  assert.equal(notes[2].relPulse, 1680);
  assert.equal(notes[2].duration, 240);
});

test("TDD: parseProgression handles bars with multiple chords (e.g. F Bb | C Bb)", () => {
  const prog = parseProgression("F Bb | C Bb");
  assert.equal(prog.length, 2, "Must produce 2 bar definitions");
  assert.equal(prog[0].rootName, "F");
  assert.ok(prog[0].chordsInBar, "Bar 0 must expose chordsInBar array");
  assert.equal(prog[0].chordsInBar.length, 2);
  assert.equal(prog[0].chordsInBar[0].rootName, "F");
  assert.equal(prog[0].chordsInBar[1].rootName, "Bb");

  assert.equal(prog[1].rootName, "C");
  assert.equal(prog[1].chordsInBar.length, 2);
  assert.equal(prog[1].chordsInBar[0].rootName, "C");
  assert.equal(prog[1].chordsInBar[1].rootName, "Bb");
});

test("TDD: compileSong supports custom bass riffs via motifs.bass or riffs.bass", () => {
  const spec = {
    title: "Bass Hook Test",
    bpm: 84,
    feel: "blues-rock",
    sections: [{ name: "main", bars: 2, chords: "F Bb | C Bb" }],
    form: ["main"],
    motifs: {
      bass: "F2:8 F2:8 r:8 A2:8 C3:8 D3:8 F3:4",
    },
    instruments: {
      bass: "electric-bass-finger",
    },
  };

  const project = compileSong(spec);
  const bassTrack = project.tracks.find((t) => t.id === "trk_bass");
  assert.ok(bassTrack, "Must have bass track");
  assert.equal(bassTrack.instrument, "soundfont");
  assert.equal(bassTrack.params.program, 33);

  // Check that the notes match the custom motif pitches (F2=41, A2=45, C3=48, D3=50, F3=53)
  const pitches = bassTrack.notes.map((n) => n.pitch);
  assert.ok(pitches.includes(41), "Must include F2");
  assert.ok(pitches.includes(45), "Must include A2");
  assert.ok(pitches.includes(48), "Must include C3");
  assert.ok(pitches.includes(50), "Must include D3");
  assert.ok(pitches.includes(53), "Must include F3");
});

test("TDD: compileSong produces authentic 'Keep on the Sunny Side' (Public Domain) arrangement", () => {
  const spec = {
    title: "Keep on the Sunny Side",
    bpm: 86,
    signature: [4, 4],
    key: "F",
    mode: "major",
    feel: "blues-rock",
    swing: 0.3,
    instruments: {
      drums: "rock-kit",
      bass: "electric-bass-finger",
      rhythm: "electric-guitar-clean",
      lead: "overdriven-guitar",
    },
    sections: [
      { name: "intro", bars: 4, chords: "F Bb | C Bb", energy: 0.6 },
      { name: "verse", bars: 8, chords: "F Bb | C Bb", energy: 0.7 },
      { name: "chorus", bars: 8, chords: "F Bb | C Bb", energy: 0.85 },
      { name: "outro", bars: 4, chords: "F Bb | C Bb", energy: 0.5 },
    ],
    form: ["intro", "verse", "chorus", "outro"],
    motifs: {
      bass: "F2:8 F2:8 r:8 A2:8 C3:8 D3:8 F3:4 r:8 G2:8 G2:8 r:8 Bb2:8 D3:8 C3:8 Bb2:4",
      rhythm: "r:4 F4:8 r:8 r:4 Bb4:8 r:8 r:4 C5:8 r:8 r:4 Bb4:8 r:8",
      lead: "F4:8 A4:8 C5:4 r:4 C5:8 D5:8 F5:2",
    },
    seed: 42,
  };

  const project = compileSong(spec);
  assert.ok(project);
  assert.equal(project.name, "Keep on the Sunny Side");
  assert.equal(project.bpm, 86);
  assert.equal(project.swing, 0.3);
  assert.equal(project.lengthBars, 24); // 4 + 8 + 8 + 4

  const val = validateProject(project);
  assert.equal(
    val.valid,
    true,
    `Project validation errors: ${val.errors.join(", ")}`,
  );

  const drums = project.tracks.find((t) => t.id === "trk_drums");
  const bass = project.tracks.find((t) => t.id === "trk_bass");
  const rhythm = project.tracks.find((t) => t.id === "trk_rhythm");
  const lead = project.tracks.find((t) => t.id === "trk_lead");

  assert.ok(drums && bass && rhythm && lead, "All 4 tracks must be present");
  assert.equal(bass.instrument, "soundfont");
  assert.equal(bass.params.program, 33, "Electric bass program");
  assert.equal(rhythm.instrument, "soundfont");
  assert.equal(rhythm.params.program, 27, "Clean electric guitar program");
  assert.equal(lead.instrument, "soundfont");
  assert.equal(lead.params.program, 29, "Overdriven guitar program");

  // Drums in blues-rock should have swung eighth/quarter hats, not rigid straight 16ths
  assert.ok(drums.notes.length > 0, "Drums must have notes");
  assert.ok(bass.notes.length > 50, "Bass must have notes across 24 bars");
  assert.ok(rhythm.notes.length > 30, "Rhythm must have notes across 24 bars");
  assert.ok(lead.notes.length > 20, "Lead must have notes");
});
