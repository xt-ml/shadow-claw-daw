import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  applyCommand,
  validateProject,
  normalizeNotes,
  projectToScoreView,
  beatsPerBar,
  PPQN,
} from "../.agents/scripts/scdaw.js";

test("WP0.1: new_project defaults to empty template and reports seeded notes", () => {
  const base = createProject("empty");

  // Default to empty template
  const { project: emptyProj, result: emptyResult } = applyCommand(
    base,
    "new_project",
    {},
  );
  assert.equal(
    emptyProj.tracks.length,
    0,
    "Default new_project must be empty without pre-seeded notes",
  );
  assert.equal(emptyResult.template, "empty");

  // Explicit template reports seeded tracks & warning
  const { project: popProj, result: popResult } = applyCommand(
    base,
    "new_project",
    { template: "pop" },
  );
  assert.ok(popProj.tracks.length > 0, "Pop template should create tracks");
  assert.ok(
    Array.isArray(popResult.seededTracks),
    "Must return seededTracks array",
  );
  assert.ok(popResult.seededTracks.length > 0, "Must list seeded tracks");
  assert.ok(
    typeof popResult.warning === "string" &&
      popResult.warning.includes("seeded"),
    "Must include warning about seeded template content",
  );

  // Template with clear: true preserves tracks/structure but clears notes
  const { project: clearedPop } = applyCommand(base, "new_project", {
    template: "pop",
    clear: true,
  });
  assert.ok(clearedPop.tracks.length > 0, "Should have tracks");
  for (const track of clearedPop.tracks) {
    assert.equal(
      track.notes.length,
      0,
      `Track ${track.id} notes should be cleared with clear: true`,
    );
  }
});

test("WP0.1: clear_project_notes clears all notes across all tracks", () => {
  const popProj = createProject("pop");
  const totalNotesBefore = popProj.tracks.reduce(
    (sum, t) => sum + t.notes.length,
    0,
  );
  assert.ok(totalNotesBefore > 0, "Pop project should have notes initially");

  const { project: cleared, result } = applyCommand(
    popProj,
    "clear_project_notes",
    {},
  );
  const totalNotesAfter = cleared.tracks.reduce(
    (sum, t) => sum + t.notes.length,
    0,
  );
  assert.equal(
    totalNotesAfter,
    0,
    "All notes across all tracks must be cleared",
  );
  assert.equal(result.clearedNotesCount, totalNotesBefore);
});

test("WP0.2: normalizeNotes supports bar/beat/note/dur/vel musical units", () => {
  // Test musical units { bar: 2, beat: 3, note: "Eb3", dur: "1/8", vel: 0.85 }
  // In 4/4 time: bar 2 beat 3 = (1 bar offset = 4 beats) + (beat 3 offset = 2 beats) = 6 beats = 6 * 960 = 5760 PPQN
  // dur: "1/8" = 480 PPQN
  // note: "Eb3" = pitch 51
  const notes = [
    { bar: 2, beat: 3, note: "Eb3", dur: "1/8", vel: 0.85 },
    { bar: 1, beat: 1, note: "C4", dur: "q", vel: 0.9 },
    { bar: 3, beat: 1, note: "G2", dur: "2 beats", vel: 1.0 },
    { bar: 1, beat: 4, note: 60, dur: "1/16", vel: 0.7 },
  ];

  const normalized = normalizeNotes("bars", notes);
  assert.equal(normalized[0].position, 5760);
  assert.equal(normalized[0].duration, 480);
  assert.equal(normalized[0].pitch, 51);
  assert.equal(normalized[0].velocity, 0.85);

  assert.equal(normalized[1].position, 0);
  assert.equal(normalized[1].duration, 960);
  assert.equal(normalized[1].pitch, 60);

  assert.equal(normalized[2].position, 2 * 4 * 960); // Bar 3 Beat 1 = 8 beats * 960 = 7680
  assert.equal(normalized[2].duration, 1920);
  assert.equal(normalized[2].pitch, 43); // G2

  assert.equal(normalized[3].position, 3 * 960); // Bar 1 Beat 4 = 3 beats * 960 = 2880
  assert.equal(normalized[3].duration, 240); // 1/16 = 240
});

test("WP0.2: projectToScoreView formats project with timebase header and compact score view", () => {
  const p = createProject("empty");
  p.tracks = [
    {
      id: "trk_lead",
      name: "Lead",
      kind: "synth",
      notes: [
        { position: 0, duration: 960, pitch: 60, velocity: 0.8 },
        { position: 960, duration: 480, pitch: 64, velocity: 0.85 },
      ],
    },
  ];

  const scoreView = projectToScoreView(p);
  assert.equal(scoreView.timebase.ppqnPerQuarter, 960);
  assert.equal(scoreView.timebase.beatsPerBar, 4);
  assert.equal(scoreView.timebase.stepsPerBar, 16);
  assert.ok(Array.isArray(scoreView.tracks[0].score));
  assert.equal(scoreView.tracks[0].score[0].note, "C4");
  assert.equal(scoreView.tracks[0].score[0].bar, 1);
  assert.equal(scoreView.tracks[0].score[0].beat, 1);
  assert.equal(scoreView.tracks[0].score[1].note, "E4");
  assert.equal(scoreView.tracks[0].score[1].bar, 1);
  assert.equal(scoreView.tracks[0].score[1].beat, 2);
});

test("WP0.3: lengthBars up to 512, loop region, and higher track/note limits", () => {
  const p = createProject("empty");
  p.lengthBars = 64;
  p.loop = { enabled: true, startPulse: 0, endPulse: 3840 * 4 };

  const val = validateProject(p);
  assert.equal(
    val.valid,
    true,
    `Project with 64 bars should be valid, errors: ${val.errors.join(", ")}`,
  );

  // set_transport should allow up to 512 bars
  const { project: updated } = applyCommand(p, "set_transport", {
    lengthBars: 128,
  });
  assert.equal(updated.lengthBars, 128);

  // Track limits raised to 64
  for (let i = 0; i < 20; i++) {
    p.tracks.push({
      id: `trk_${i}`,
      name: `Track ${i}`,
      kind: "synth",
      notes: [{ position: 0, duration: 240, pitch: 60, velocity: 0.8 }],
    });
  }
  const valTracks = validateProject(p);
  assert.equal(
    valTracks.valid,
    true,
    `20 tracks should now be valid, got: ${valTracks.errors.join(", ")}`,
  );
});

test("WP0.4: strict parameter validation rejects invalid enum values and supports pulse wave", () => {
  const p = createProject("empty");
  p.tracks = [
    { id: "trk_1", name: "Synth", kind: "synth", params: {}, notes: [] },
  ];

  // Invalid waveform enum should be rejected with an error listing allowed values
  assert.throws(() => {
    applyCommand(p, "set_track", {
      trackId: "trk_1",
      params: { waveform: "bogus_osc" },
    });
  }, /waveform/i);

  // pulse waveform is supported and accepted
  const { project: pulseProj } = applyCommand(p, "set_track", {
    trackId: "trk_1",
    params: { waveform: "pulse", pulseWidth: 0.3 },
  });
  assert.equal(pulseProj.tracks[0].params.waveform, "pulse");

  // Unknown param keys are reported in ignoredParams or stripped
  const { result } = applyCommand(p, "set_track", {
    trackId: "trk_1",
    params: { roomSize: 0.8 },
  });
  assert.ok(
    result.ignoredParams?.includes("roomSize"),
    "Should report ignored non-schema param 'roomSize'",
  );
});

test("WP0.5: canonical velocity 0-1 and master limiter", () => {
  const p = createProject("empty");
  p.tracks = [
    {
      id: "trk_1",
      name: "Track",
      kind: "synth",
      notes: [
        { position: 0, duration: 240, pitch: 60, velocity: 127 }, // legacy MIDI 0-127
        { position: 240, duration: 240, pitch: 62, velocity: 64 },
      ],
    },
  ];

  // applyCommand or migrateNotes should rescale legacy > 1 velocities to 0-1
  const normalized = normalizeNotes("ppqn", p.tracks[0].notes);
  assert.equal(normalized[0].velocity, 1.0);
  assert.ok(Math.abs(normalized[1].velocity - 64 / 127) < 0.01);
});

test("WP0.6: default synth and init-saw avoid aggressive filter sweeps", async () => {
  const { INSTRUMENT_PRESETS } =
    await import("../.agents/scripts/scdaw-presets.js");
  assert.equal(
    INSTRUMENT_PRESETS["init-saw"].filterEnvAmount,
    0,
    "Default init-saw should have 0 filterEnvAmount to avoid WHAA sweep",
  );
  assert.ok(
    INSTRUMENT_PRESETS["init-saw"].cutoff >= 3000,
    "Default init-saw should have open cutoff",
  );
  assert.ok(
    INSTRUMENT_PRESETS["supersaw-lead"].filterEnvAmount <= 600,
    "supersaw-lead should avoid extreme filter sweep",
  );
});
