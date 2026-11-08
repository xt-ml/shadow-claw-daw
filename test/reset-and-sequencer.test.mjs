import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  applyCommand,
  computeEventsInRange,
  ppqnToStep,
} from "../.agents/scripts/scdaw.js";
import {
  SYNTH_PARAM_SCHEMA,
  TRACK_MIX_SCHEMA,
  MASTER_SCHEMA,
  getDefaultParams,
} from "../.agents/scripts/scdaw-schema.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";

test("Schema: provides default parameter values and metadata", () => {
  assert.equal(MASTER_SCHEMA.volume.default, 0.8);
  assert.equal(TRACK_MIX_SCHEMA.volume.default, 0.8);
  assert.equal(TRACK_MIX_SCHEMA.pan.default, 0);
  assert.equal(TRACK_MIX_SCHEMA.mute.default, false);
  assert.equal(TRACK_MIX_SCHEMA.solo.default, false);

  const synthDefaults = getDefaultParams("synth");
  assert.equal(synthDefaults.waveform, "sawtooth");
  assert.equal(synthDefaults.cutoff, 1200);
  assert.equal(synthDefaults.attack, 0.01);

  const drumsDefaults = getDefaultParams("drums");
  assert.deepEqual(drumsDefaults, {});
});

test("applyCommand('set_master'): updates master.volume immutably and returns result", () => {
  const p = createProject("basic-beat");
  const { project: next, result } = applyCommand(p, "set_master", {
    volume: 0.65,
  });
  assert.equal(next.master.volume, 0.65);
  assert.equal(result.volume, 0.65);
  assert.notEqual(p.master.volume, 0.65); // immutable
});

test("applyCommand('reset_param'): restores a parameter to schema default", () => {
  let p = createProject("basic-beat");
  // Change master volume
  p = applyCommand(p, "set_master", { volume: 0.3 }).project;
  assert.equal(p.master.volume, 0.3);

  // Reset master volume
  p = applyCommand(p, "reset_param", {
    scope: "master",
    param: "volume",
  }).project;
  assert.equal(p.master.volume, 0.8);

  // Change track volume and cutoff
  const bassTrack = p.tracks.find((t) => t.id === "trk_bass");
  assert.ok(bassTrack);
  p = applyCommand(p, "set_track", {
    trackId: "trk_bass",
    volume: 0.2,
    params: { cutoff: 5000 },
  }).project;

  const modBass = p.tracks.find((t) => t.id === "trk_bass");
  assert.equal(modBass.volume, 0.2);
  assert.equal(modBass.params.cutoff, 5000);

  // Reset track mixer volume
  p = applyCommand(p, "reset_param", {
    scope: "track",
    trackId: "trk_bass",
    param: "volume",
  }).project;
  assert.equal(p.tracks.find((t) => t.id === "trk_bass").volume, 0.8);

  // Reset synth cutoff
  p = applyCommand(p, "reset_param", {
    scope: "synth",
    trackId: "trk_bass",
    param: "cutoff",
  }).project;
  assert.equal(p.tracks.find((t) => t.id === "trk_bass").params.cutoff, 1200);
});

test("applyCommand('reset_track'): resets mixer attributes or synth params to defaults without deleting notes", () => {
  let p = createProject("basic-beat");
  const bassBefore = p.tracks.find((t) => t.id === "trk_bass");
  const noteCountBefore = bassBefore.notes.length;

  // Modify track
  p = applyCommand(p, "set_track", {
    trackId: "trk_bass",
    volume: 0.1,
    pan: -0.8,
    mute: true,
    solo: true,
    params: { cutoff: 300, resonance: 10 },
  }).project;

  // Reset track mixer controls
  p = applyCommand(p, "reset_track", {
    trackId: "trk_bass",
    mode: "mixer",
  }).project;
  let bass = p.tracks.find((t) => t.id === "trk_bass");
  assert.equal(bass.volume, 0.8);
  assert.equal(bass.pan, 0);
  assert.equal(bass.mute, false);
  assert.equal(bass.solo, false);
  assert.equal(bass.params.cutoff, 300); // synth params unchanged
  assert.equal(bass.notes.length, noteCountBefore); // notes unchanged

  // Reset track synth params
  p = applyCommand(p, "reset_track", {
    trackId: "trk_bass",
    mode: "params",
  }).project;
  bass = p.tracks.find((t) => t.id === "trk_bass");
  assert.equal(bass.params.cutoff, 1200);
  assert.equal(bass.notes.length, noteCountBefore);
});

test("applyCommand('reset_project'): restores clean template state", () => {
  let p = createProject("basic-beat");
  p = applyCommand(p, "set_transport", { bpm: 150 }).project;
  p = applyCommand(p, "add_track", { kind: "synth", name: "Extra" }).project;
  assert.equal(p.tracks.length, 3);
  assert.equal(p.bpm, 150);

  const { project: resetP, result } = applyCommand(p, "reset_project", {
    template: "basic-beat",
  });
  assert.equal(resetP.bpm, 120);
  assert.equal(resetP.tracks.length, 2);
  assert.equal(result.ok, true);
});

test("Sequencer step toggle: unsetting and re-setting Bass Synth step preserves pitch (36/C2) and duration (480)", () => {
  let p = createProject("basic-beat");
  const bass = p.tracks.find((t) => t.id === "trk_bass");
  // In basic-beat, first bass note is at position 480 (step 2), pitch 36 (C2), duration 480
  const step2Note = bass.notes.find((n) => ppqnToStep(n.position) === 2);
  assert.ok(step2Note);
  assert.equal(step2Note.pitch, 36);
  assert.equal(step2Note.duration, 480);

  // 1. Toggle OFF step 2
  const offRes = applyCommand(p, "toggle_step", {
    trackId: "trk_bass",
    step: 2,
    pitch: 36,
  });
  p = offRes.project;
  assert.equal(offRes.result.toggled, "off");
  assert.equal(
    p.tracks
      .find((t) => t.id === "trk_bass")
      .notes.some((n) => ppqnToStep(n.position) === 2),
    false,
  );

  // 2. Toggle ON step 2 again without explicit pitch or with fallback pitch
  const onRes = applyCommand(p, "toggle_step", {
    trackId: "trk_bass",
    step: 2,
  });
  p = onRes.project;
  assert.equal(onRes.result.toggled, "on");

  const restoredNote = p.tracks
    .find((t) => t.id === "trk_bass")
    .notes.find((n) => ppqnToStep(n.position) === 2);
  assert.ok(restoredNote, "step 2 note should be restored");
  assert.equal(
    restoredNote.pitch,
    36,
    "should preserve original pitch 36 (C2), not reset to 60 (C4)",
  );
  assert.equal(
    restoredNote.duration,
    480,
    "should preserve original duration 480 (eighth note)",
  );
});

test("computeEventsInRange: honors track.solo and mutes non-soloed tracks", () => {
  const p = createProject("basic-beat");
  // Set bass to solo
  p.tracks.find((t) => t.id === "trk_bass").solo = true;

  // Window covering entire bar
  const events = computeEventsInRange(p, 0, 3840);
  assert.ok(events.length > 0);
  // All events must belong to trk_bass
  for (const ev of events) {
    assert.equal(
      ev.trackId,
      "trk_bass",
      `event from track ${ev.trackId} should not play when trk_bass is soloed`,
    );
  }
});

test("DawEngine panic: stops all active voices and transport", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  await engine.play();
  assert.equal(engine.getState().playing, true);

  engine.panic();
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().positionPpqn, 0);
});

test("DawEngine resetProject: stops playback, panics active voices, clears undo history, resets transport state, and restores starter project", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  // Mutate project, change BPM, add tracks
  await engine.sendCommand("set_transport", { bpm: 155, swing: 0.25 });
  await engine.sendCommand("add_track", { kind: "synth", name: "Solo Synth" });
  await engine.play();

  assert.equal(engine.getState().playing, true);
  assert.equal(engine.getProject().bpm, 155);
  assert.equal(engine.getProject().tracks.length, 3);
  assert.equal(engine.history.canUndo(), true);

  // Execute resetProject
  const res = await engine.resetProject({ template: "basic-beat" });
  assert.equal(res.ok, true);

  // Verifies playback is stopped and voices are reset
  assert.equal(engine.getState().playing, false);
  assert.equal(engine.getState().positionPpqn, 0);
  assert.equal(engine.getState().bar, 1);
  assert.equal(engine.getState().beat, 1);
  assert.equal(engine.getState().step, 0);

  // Verifies clean starter project is restored
  const p = engine.getProject();
  assert.equal(p.bpm, 120);
  assert.equal(p.name, "New Beat");
  assert.equal(p.tracks.length, 2);

  // Verifies undo history is cleared so undo doesn't resurrect stale state
  assert.equal(engine.history.canUndo(), false);
  const undoRes = await engine.sendCommand("undo");
  assert.equal(undoRes.ok, false);
});

test("DawEngine newProject: creates clean project, resets transport state, and clears undo history", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  await engine.sendCommand("add_track", { kind: "drums", name: "Drums 2" });
  assert.equal(engine.history.canUndo(), true);

  const res = await engine.newProject({
    template: "empty",
    name: "My Fresh Song",
  });
  assert.equal(res.ok, true);

  const p = engine.getProject();
  assert.equal(p.name, "My Fresh Song");
  assert.equal(p.tracks.length, 0);
  assert.equal(engine.history.canUndo(), false);
  assert.equal(engine.getState().playing, false);
});
