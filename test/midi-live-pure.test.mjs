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
  RESERVED_MIDI_CCS,
  MIDI_CONTROLLER_PRESETS,
  resolveMidiMappingDefaults,
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

test("resolveMidiMappingDefaults & RESERVED_MIDI_CCS & MIDI_CONTROLLER_PRESETS: resolve parameter ranges, modes, and SMC-Mixer preset", () => {
  assert.equal(RESERVED_MIDI_CCS[64], "Sustain Pedal");
  assert.equal(RESERVED_MIDI_CCS[120], "All Sound Off");
  assert.equal(RESERVED_MIDI_CCS[123], "All Notes Off");
  assert.ok(MIDI_CONTROLLER_PRESETS["smc-mixer"]);

  const p0 = createProject("basic-beat");
  const trackId = p0.tracks[0].id;

  // Gap 7: Track volume defaults to 0..1.5 even when max is omitted
  const volDef = resolveMidiMappingDefaults({ trackId, param: "volume" }, p0);
  assert.equal(volDef.min, 0);
  assert.equal(volDef.max, 1.5);
  assert.equal(volDef.mode, "continuous");

  // Gap 5: Master volume defaults to 0..1
  const masterVol = resolveMidiMappingDefaults(
    { trackId: "master", param: "volume" },
    p0,
  );
  assert.equal(masterVol.trackId, "master");
  assert.equal(masterVol.min, 0);
  assert.equal(masterVol.max, 1);
  assert.equal(masterVol.mode, "continuous");

  // Pan defaults to -1..1
  const panDef = resolveMidiMappingDefaults({ trackId, param: "pan" }, p0);
  assert.equal(panDef.min, -1);
  assert.equal(panDef.max, 1);
  assert.equal(panDef.mode, "continuous");

  // Gap 2 & 3: Mute, solo, recordArm/armed default to toggle mode
  for (const param of ["mute", "solo", "recordArm"]) {
    const def = resolveMidiMappingDefaults({ trackId, param }, p0);
    assert.equal(def.param, param);
    assert.equal(def.mode, "toggle");
    assert.equal(def.min, 0);
    assert.equal(def.max, 1);
  }
  const armedAlias = resolveMidiMappingDefaults(
    { trackId, param: "armed", min: 0, max: 1 },
    p0,
  );
  assert.equal(armedAlias.param, "recordArm");
  assert.equal(armedAlias.mode, "toggle");

  // Gap 6: Transport targets
  for (const param of ["play", "stop", "pause", "panic"]) {
    const tDef = resolveMidiMappingDefaults({ param }, p0);
    assert.equal(tDef.trackId, "transport");
    assert.equal(tDef.mode, "trigger");
  }
  for (const param of ["toggle_play", "record", "metronome"]) {
    const tDef = resolveMidiMappingDefaults({ param }, p0);
    assert.equal(tDef.trackId, "transport");
    assert.equal(tDef.mode, "toggle");
  }
  const bpmDef = resolveMidiMappingDefaults({ param: "bpm" }, p0);
  assert.equal(bpmDef.trackId, "transport");
  assert.equal(bpmDef.min, 20);
  assert.equal(bpmDef.max, 300);
  assert.equal(bpmDef.mode, "continuous");

  const swingDef = resolveMidiMappingDefaults({ param: "swing" }, p0);
  assert.equal(swingDef.trackId, "transport");
  assert.equal(swingDef.min, 0);
  assert.equal(swingDef.max, 0.5);

  // Synth param schema fallback (cutoff -> 20..20000 exponential)
  const cutoffDef = resolveMidiMappingDefaults(
    { trackId: p0.tracks[1].id, param: "cutoff" },
    p0,
  );
  assert.equal(cutoffDef.min, 20);
  assert.equal(cutoffDef.max, 20000);
  assert.equal(cutoffDef.scaling, "exponential");
  assert.equal(cutoffDef.mode, "continuous");
});

test("applyCommand: set_midi_learn_mapping deduplicates, warns on reserved/conflicting CCs, clears, and applies smc-mixer preset", () => {
  const p0 = createProject("basic-beat");
  const trk0 = p0.tracks[0].id;
  const trk1 = p0.tracks[1].id;

  // 1. Track volume defaults to max 1.5 when omitted
  const res1 = applyCommand(p0, "set_midi_learn_mapping", {
    deviceId: "dev-1",
    channel: 0,
    cc: 40,
    trackId: trk0,
    param: "volume",
  });
  assert.equal(res1.result.mapping.max, 1.5);
  assert.equal(res1.result.mapping.mode, "continuous");
  assert.equal(res1.project.midiMappings.length, 1);

  // 2. Gap 8: Re-running same (cc, channel, deviceId, trackId, param) updates in place (no duplicate)
  const res2 = applyCommand(res1.project, "set_midi_learn_mapping", {
    deviceId: "dev-1",
    channel: 0,
    cc: 40,
    trackId: trk0,
    param: "volume",
  });
  assert.equal(res2.project.midiMappings.length, 1);
  assert.equal(res2.result.mapping.id, res1.result.mapping.id);

  // 3. Reserved CC warning (CC 64) + duplicate CC/channel warning
  const resReserved = applyCommand(res2.project, "set_midi_learn_mapping", {
    deviceId: "dev-1",
    channel: 0,
    cc: 64,
    trackId: trk0,
    param: "mute",
  });
  assert.ok(
    resReserved.result.warnings.some((w) => /64|Sustain/i.test(w)),
    "Expected reserved CC 64 warning",
  );

  const resConflict = applyCommand(
    resReserved.project,
    "set_midi_learn_mapping",
    {
      deviceId: "dev-1",
      channel: "omni",
      cc: 40,
      trackId: trk1,
      param: "pan",
    },
  );
  assert.ok(
    resConflict.result.warnings.some((w) => /40|duplicate|conflict/i.test(w)),
    "Expected duplicate CC/channel conflict warning",
  );

  // 4. apply_midi_controller_preset: smc-mixer creates 2*4 + 1 master + 2 transport = 11 mappings for 2-track project
  const presetRes = applyCommand(
    resConflict.project,
    "apply_midi_controller_preset",
    { preset: "smc-mixer" },
  );
  assert.equal(presetRes.result.preset, "smc-mixer");
  assert.equal(presetRes.result.addedCount, 11);
  assert.equal(presetRes.project.midiMappings.length, 11);

  const fader1 = presetRes.project.midiMappings.find(
    (m) => m.cc === 40 && m.trackId === trk0,
  );
  assert.equal(fader1.max, 1.5);
  const masterFader = presetRes.project.midiMappings.find(
    (m) => m.cc === 47 && m.trackId === "master",
  );
  assert.equal(masterFader.param, "volume");
  assert.equal(masterFader.max, 1);
  const playBtn = presetRes.project.midiMappings.find(
    (m) => m.cc === 102 && m.trackId === "transport",
  );
  assert.equal(playBtn.param, "play");
  assert.equal(playBtn.mode, "trigger");

  // 5. clear_midi_learn_mappings
  const clearedTrack = applyCommand(
    presetRes.project,
    "clear_midi_learn_mappings",
    { trackId: trk0 },
  );
  assert.equal(clearedTrack.result.removed, 4);
  const clearedAll = applyCommand(
    clearedTrack.project,
    "clear_midi_learn_mappings",
    {},
  );
  assert.equal(clearedAll.project.midiMappings.length, 0);

  // 6. Bank paging (bankOffset: 1 shifts SMC-Mixer Fader 1 to track index 1)
  const bankRes = applyCommand(
    clearedAll.project,
    "apply_midi_controller_preset",
    { preset: "smc-mixer", bankOffset: 1 },
  );
  const bankFader1 = bankRes.project.midiMappings.find((m) => m.cc === 40);
  assert.equal(bankFader1.trackId, trk1);

  // 7. import_midi_learn_mappings with trackIndex portable remapping + JSON string input
  const exportedPayload = JSON.stringify({
    version: 2,
    midiMappings: [
      {
        cc: 40,
        channel: "omni",
        trackId: "stale_old_track_id",
        trackIndex: 0,
        param: "volume",
      },
      {
        cc: 47,
        channel: "omni",
        trackId: "master",
        param: "volume",
      },
      {
        cc: 64,
        channel: 0,
        trackId: "transport",
        param: "play",
      },
    ],
  });
  const importRes = applyCommand(p0, "import_midi_learn_mappings", {
    mappings: exportedPayload,
  });
  assert.equal(importRes.result.importedCount, 3);
  assert.equal(importRes.project.midiMappings[0].trackId, trk0);
  assert.equal(importRes.project.midiMappings[0].max, 1.5);
  assert.equal(importRes.project.midiMappings[1].trackId, "master");
  assert.equal(importRes.project.midiMappings[2].trackId, "transport");
  assert.ok(
    importRes.result.warnings.some((w) => /64|Sustain/i.test(w)),
    "Import should propagate reserved CC warnings",
  );
});
