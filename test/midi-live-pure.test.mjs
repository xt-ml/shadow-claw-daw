import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMidiMessage,
  encodeMidiMessage,
  transformLiveMidiNote,
  resolveCapturedMidiNotes,
  MIN_CAPTURED_NOTE_DURATION,
} from "../.agents/scripts/scdaw-midi.js";
import {
  createProject,
  applyCommand,
  migrateProject,
  PPQN,
} from "../.agents/scripts/scdaw.js";

test("parseMidiMessage: decodes NoteOn, NoteOn vel=0 -> NoteOff, and NoteOff", () => {
  const on = parseMidiMessage(new Uint8Array([0x92, 60, 127]));
  assert.equal(on.type, "note-on");
  assert.equal(on.channel, 2);
  assert.equal(on.pitch, 60);
  assert.equal(on.velocity, 1);

  // 0x90 with velocity 0 MUST be canonicalized as note-off
  const velZero = parseMidiMessage(new Uint8Array([0x90, 64, 0]));
  assert.equal(velZero.type, "note-off");
  assert.equal(velZero.channel, 0);
  assert.equal(velZero.pitch, 64);
  assert.equal(velZero.velocity, 0);

  const off = parseMidiMessage(new Uint8Array([0x85, 67, 64]));
  assert.equal(off.type, "note-off");
  assert.equal(off.channel, 5);
  assert.equal(off.pitch, 67);
});

test("parseMidiMessage: decodes CC, PitchBend, and System Real-Time messages", () => {
  const cc = parseMidiMessage(new Uint8Array([0xb0, 74, 127]));
  assert.equal(cc.type, "cc");
  assert.equal(cc.channel, 0);
  assert.equal(cc.controller, 74);
  assert.equal(cc.value, 127);
  assert.equal(cc.normalized, 1);

  const pbCenter = parseMidiMessage(new Uint8Array([0xe0, 0x00, 0x40]));
  assert.equal(pbCenter.type, "pitch-bend");
  assert.equal(pbCenter.channel, 0);
  assert.ok(Math.abs(pbCenter.value) < 0.001);

  const pbMax = parseMidiMessage(new Uint8Array([0xe0, 0x7f, 0x7f]));
  assert.ok(pbMax.value > 0.99);

  const pbMin = parseMidiMessage(new Uint8Array([0xe0, 0x00, 0x00]));
  assert.equal(pbMin.value, -1);

  assert.equal(parseMidiMessage(new Uint8Array([0xf8])).type, "clock");
  assert.equal(parseMidiMessage(new Uint8Array([0xfa])).type, "start");
  assert.equal(parseMidiMessage(new Uint8Array([0xfb])).type, "continue");
  assert.equal(parseMidiMessage(new Uint8Array([0xfc])).type, "stop");

  const spp = parseMidiMessage(new Uint8Array([0xf2, 0x02, 0x00]));
  assert.equal(spp.type, "song-position");
  assert.equal(spp.midiBeats, 2);
});

test("parseMidiMessage: handles malformed, empty, and SysEx safely", () => {
  assert.equal(parseMidiMessage(null).type, "ignore");
  assert.equal(parseMidiMessage(new Uint8Array([])).type, "ignore");
  assert.equal(parseMidiMessage(new Uint8Array([0x90, 60])).type, "ignore");
  assert.equal(
    parseMidiMessage(new Uint8Array([0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7])).type,
    "ignore",
  );
});

test("encodeMidiMessage: encodes note-on, note-off, cc, and transport bytes", () => {
  const onBytes = encodeMidiMessage({
    type: "note-on",
    channel: 1,
    pitch: 60,
    velocity: 1,
  });
  assert.deepEqual(Array.from(onBytes), [0x91, 60, 127]);

  const offBytes = encodeMidiMessage({
    type: "note-off",
    channel: 1,
    pitch: 60,
  });
  assert.deepEqual(Array.from(offBytes), [0x81, 60, 0]);

  const ccBytes = encodeMidiMessage({
    type: "cc",
    channel: 0,
    controller: 123,
    value: 0,
  });
  assert.deepEqual(Array.from(ccBytes), [0xb0, 123, 0]);

  assert.deepEqual(Array.from(encodeMidiMessage({ type: "start" })), [0xfa]);
  assert.deepEqual(Array.from(encodeMidiMessage({ type: "stop" })), [0xfc]);
  assert.deepEqual(Array.from(encodeMidiMessage({ type: "clock" })), [0xf8]);
});

test("transformLiveMidiNote: applies notefilter, pitch transpose, and velocity midiFx", () => {
  const track = {
    midiFx: [
      { type: "notefilter", minPitch: 48, maxPitch: 72 },
      { type: "pitch", semitones: 12 },
      { type: "velocity", drive: 0.25 },
    ],
  };

  // Filtered out
  const tooLow = transformLiveMidiNote(track, { pitch: 36, velocity: 0.8 });
  assert.equal(tooLow.length, 0);

  // Transposed +12, velocity boosted
  const passed = transformLiveMidiNote(track, { pitch: 60, velocity: 0.6 });
  assert.equal(passed.length, 1);
  assert.equal(passed[0].pitch, 72);
  assert.ok(Math.abs(passed[0].velocity - 0.75) < 0.001);
});

test("resolveCapturedMidiNotes: resolves Scenario 1 (stopped ms-deltas) and Scenario 2 (playing PPQN)", () => {
  // Scenario 1: Transport stopped, BPM = 120 (1 beat = 500ms = 960 PPQN)
  const stoppedEvents = [
    { type: "on", pitch: 60, velocity: 0.8, timeMs: 1000 },
    { type: "off", pitch: 60, timeMs: 1500 }, // 500ms = 960 PPQN
    { type: "on", pitch: 64, velocity: 0.9, timeMs: 1500 },
    { type: "off", pitch: 64, timeMs: 1505 }, // 5ms -> clamped to MIN_CAPTURED_NOTE_DURATION
    { type: "off", pitch: 99, timeMs: 1600 }, // orphan note-off skipped
  ];

  const resStopped = resolveCapturedMidiNotes(stoppedEvents, {
    mode: "stopped",
    bpm: 120,
    anchorPpqn: 960,
    commitTimeMs: 2000,
  });

  assert.equal(resStopped.length, 2);
  assert.equal(resStopped[0].pitch, 60);
  assert.equal(resStopped[0].position, 960);
  assert.equal(resStopped[0].duration, PPQN.Quarter);

  assert.equal(resStopped[1].pitch, 64);
  assert.equal(resStopped[1].position, 1920);
  assert.equal(resStopped[1].duration, MIN_CAPTURED_NOTE_DURATION);

  // Scenario 2: Transport playing with still-held note truncated at commitPpqn
  const playingEvents = [{ type: "on", pitch: 67, velocity: 0.75, ppqn: 480 }];
  const resPlaying = resolveCapturedMidiNotes(playingEvents, {
    mode: "playing",
    commitPpqn: 1440,
  });
  assert.equal(resPlaying.length, 1);
  assert.equal(resPlaying[0].pitch, 67);
  assert.equal(resPlaying[0].position, 480);
  assert.equal(resPlaying[0].duration, 960);
});

test("applyCommand & migrateProject: MIDI routing, MIDI learn mappings, and commit_captured_midi", () => {
  const p0 = migrateProject(createProject("empty"));
  assert.ok(Array.isArray(p0.midiMappings));

  const addRes = applyCommand(p0, "add_track", {
    kind: "synth",
    name: "Lead",
  });
  const trackId = addRes.result.trackId;

  // Set track MIDI routing
  const routeRes = applyCommand(addRes.project, "set_track_midi_routing", {
    trackId,
    midiInput: { deviceId: "hw_key_1", channel: 2, monitor: "in" },
    midiOutput: { deviceId: "hw_out_1", channel: 3, sendClock: true },
  });
  const trk = routeRes.project.tracks.find((t) => t.id === trackId);
  assert.equal(trk.midiInput.deviceId, "hw_key_1");
  assert.equal(trk.midiInput.channel, 2);
  assert.equal(trk.midiOutput.deviceId, "hw_out_1");
  assert.equal(trk.midiOutput.sendClock, true);

  // Add MIDI Learn mapping
  const learnRes = applyCommand(routeRes.project, "set_midi_learn_mapping", {
    deviceId: "hw_key_1",
    channel: 0,
    cc: 74,
    trackId,
    param: "cutoff",
    min: 20,
    max: 20000,
    scaling: "exponential",
  });
  assert.equal(learnRes.project.midiMappings.length, 1);
  assert.equal(learnRes.project.midiMappings[0].cc, 74);

  // Remove MIDI Learn mapping
  const removeRes = applyCommand(
    learnRes.project,
    "remove_midi_learn_mapping",
    {
      id: learnRes.result.mapping.id,
    },
  );
  assert.equal(removeRes.project.midiMappings.length, 0);

  // Commit captured MIDI notes
  const capRes = applyCommand(removeRes.project, "commit_captured_midi", {
    trackId,
    notes: [
      { position: 0, duration: 480, pitch: 60, velocity: 0.8 },
      { position: 480, duration: 480, pitch: 64, velocity: 0.85 },
    ],
  });
  const trkCap = capRes.project.tracks.find((t) => t.id === trackId);
  assert.equal(trkCap.notes.length, 2);

  // Deduplicate identical (position, pitch) instead of doubling up
  const dupRes = applyCommand(capRes.project, "commit_captured_midi", {
    trackId,
    notes: [{ position: 0, duration: 240, pitch: 60, velocity: 0.9 }],
  });
  const trkDup = dupRes.project.tracks.find((t) => t.id === trackId);
  assert.equal(trkDup.notes.length, 2);
});

test("resolveCapturedMidiNotes: stopped mode tracks timeline seek (ppqn changes between note groups)", () => {
  const events = [
    { type: "on", pitch: 60, velocity: 0.8, ppqn: 0, timeMs: 1000 },
    { type: "off", pitch: 60, velocity: 0, ppqn: 0, timeMs: 1100 },
    { type: "on", pitch: 72, velocity: 0.8, ppqn: 0, timeMs: 1200 },
    { type: "off", pitch: 72, velocity: 0, ppqn: 0, timeMs: 1300 },
    // User seeks playhead to beat 2 (ppqn 960) while stopped
    { type: "on", pitch: 72, velocity: 0.85, ppqn: 960, timeMs: 5000 },
    { type: "off", pitch: 72, velocity: 0, ppqn: 960, timeMs: 5100 },
    { type: "on", pitch: 95, velocity: 0.9, ppqn: 960, timeMs: 5200 },
    { type: "off", pitch: 95, velocity: 0, ppqn: 960, timeMs: 5300 },
  ];
  const notes = resolveCapturedMidiNotes(events, { mode: "stopped", bpm: 120 });
  assert.equal(notes.length, 4);
  assert.equal(notes[0].position, 0);
  assert.ok(
    notes[2].position >= 960,
    `Expected beat 2 (>=960), got ${notes[2].position}`,
  );
  assert.ok(
    notes[3].position >= 960,
    `Expected B6 at beat 2 (>=960), got ${notes[3].position}`,
  );
  assert.equal(notes[3].pitch, 95);
});
