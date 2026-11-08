import test from "node:test";
import assert from "node:assert/strict";
import {
  PPQN,
  secondsToPulses,
  pulsesToSeconds,
  stepToPpqn,
  ppqnToStep,
  parsePitch,
  pitchToName,
  createProject,
  validateProject,
  normalizeNotes,
  applyCommand,
  computeEventsInRange,
  linToDb,
  dbToLin,
  peakAndRms,
  encodeWav,
  createHistory,
} from "../.agents/scripts/scdaw.js";

test("PPQN: conforms to openDAW constants and conversions", () => {
  assert.equal(PPQN.Quarter, 960);
  assert.equal(PPQN.Bar, 3840);
  assert.equal(PPQN.SemiQuaver, 240);

  // 1 second at 120 BPM = 2 beats = 1920 pulses
  assert.equal(secondsToPulses(1, 120), 1920);
  assert.equal(pulsesToSeconds(1920, 120), 1);

  assert.equal(stepToPpqn(0), 0);
  assert.equal(stepToPpqn(4), 960);
  assert.equal(ppqnToStep(960), 4);
});

test("parsePitch & pitchToName: converts note strings, MIDI numbers, and drum names", () => {
  assert.equal(parsePitch("C4"), 60);
  assert.equal(parsePitch("A4"), 69);
  assert.equal(parsePitch("F#3"), 54);
  assert.equal(parsePitch(60), 60);

  // GM Drum mappings
  assert.equal(parsePitch("kick"), 36);
  assert.equal(parsePitch("snare"), 38);
  assert.equal(parsePitch("clap"), 39);
  assert.equal(parsePitch("hat"), 42);
  assert.equal(parsePitch("closedhat"), 42);
  assert.equal(parsePitch("openhat"), 46);

  assert.equal(pitchToName(60), "C4");
  assert.equal(pitchToName(69), "A4");
  assert.equal(pitchToName(36, "drums"), "kick");
  assert.equal(pitchToName(38, "drums"), "snare");
});

test("createProject & validateProject: creates compliant schema and catches invalid fields", () => {
  const p = createProject();
  assert.equal(p.version, 1);
  assert.equal(p.bpm, 120);
  assert.deepEqual(p.signature, [4, 4]);
  assert.equal(p.lengthBars, 1);
  assert.equal(p.swing, 0.2); // default smooth groove has 20% swing
  assert.ok(p.tracks.length >= 1);

  // Default basic-beat drums have 16 sixteenth-note hi-hats
  const drums = p.tracks.find((t) => t.id === "trk_drums");
  const hats = drums.notes.filter((n) => n.pitch === 42);
  assert.equal(hats.length, 16);

  // Saved straight-beat template has 0% swing and 8 eighth-note hi-hats
  const straight = createProject("straight-beat");
  assert.equal(straight.name, "Straight Beat");
  assert.equal(straight.swing, 0);
  const straightDrums = straight.tracks.find((t) => t.id === "trk_drums");
  const straightHats = straightDrums.notes.filter((n) => n.pitch === 42);
  assert.equal(straightHats.length, 8);

  const val = validateProject(p);
  assert.equal(val.valid, true);
  assert.equal(val.errors.length, 0);

  // Invalid BPM
  const badBpm = { ...p, bpm: 500 };
  assert.equal(validateProject(badBpm).valid, false);

  // Invalid tracks count (> 8)
  const tooManyTracks = {
    ...p,
    tracks: Array.from({ length: 9 }, (_, i) => ({
      id: `trk_${i}`,
      name: `Track ${i}`,
      kind: "synth",
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false,
      params: {},
      notes: [],
    })),
  };
  assert.equal(validateProject(tooManyTracks).valid, false);
});

test("normalizeNotes: transforms step-based and pitch-name notes to standard PPQN", () => {
  const input = [
    { step: 0, pitch: "kick", velocity: 0.9 },
    { step: 4, pitch: "snare", velocity: 0.8 },
  ];
  const normalized = normalizeNotes("steps", input);
  assert.deepEqual(normalized, [
    { position: 0, duration: 240, pitch: 36, velocity: 0.9 },
    { position: 960, duration: 240, pitch: 38, velocity: 0.8 },
  ]);
});

test("applyCommand: transactional mutations on project", () => {
  let project = createProject("empty");
  assert.equal(project.tracks.length, 0);

  // add_track
  const addRes = applyCommand(project, "add_track", {
    kind: "drums",
    name: "Beat",
  });
  project = addRes.project;
  assert.equal(project.tracks.length, 1);
  const trackId = addRes.result.trackId;

  // write_notes
  const writeRes = applyCommand(project, "write_notes", {
    trackId,
    units: "steps",
    mode: "replace",
    notes: [
      { step: 0, pitch: "kick" },
      { step: 4, pitch: "snare" },
    ],
  });
  project = writeRes.project;
  assert.equal(project.tracks[0].notes.length, 2);

  // set_track
  const setTrkRes = applyCommand(project, "set_track", {
    trackId,
    volume: 0.6,
    pan: -0.2,
    mute: true,
  });
  project = setTrkRes.project;
  assert.equal(project.tracks[0].volume, 0.6);
  assert.equal(project.tracks[0].pan, -0.2);
  assert.equal(project.tracks[0].mute, true);

  // set_transport
  const transRes = applyCommand(project, "set_transport", {
    bpm: 128,
    lengthBars: 2,
    swing: 0.2,
  });
  project = transRes.project;
  assert.equal(project.bpm, 128);
  assert.equal(project.lengthBars, 2);
  assert.equal(project.swing, 0.2);

  // clear_notes
  const clrRes = applyCommand(project, "clear_notes", { trackId });
  project = clrRes.project;
  assert.equal(project.tracks[0].notes.length, 0);
});

test("computeEventsInRange: collects active note triggers and handles swing", () => {
  const project = createProject("empty");
  const track = {
    id: "trk_1",
    name: "Drums",
    kind: "drums",
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    params: {},
    notes: [
      { position: 0, duration: 240, pitch: 36, velocity: 1 },
      { position: 240, duration: 240, pitch: 42, velocity: 0.7 }, // step 1 (off-beat 16th)
    ],
  };
  project.tracks.push(track);
  project.swing = 0.5;

  // Window covering step 0 to step 2 (0 to 480 pulses)
  const events = computeEventsInRange(project, 0, 480);
  assert.equal(events.length, 2);
  assert.equal(events[0].note.pitch, 36);
  assert.equal(events[0].position, 0); // on-beat: no swing offset

  // Off-beat step 1 (240 ppqn) displaced by swing
  assert.equal(events[1].note.pitch, 42);
  assert.ok(events[1].position > 240, "off-beat 16th should be swung forward");
});

test("linToDb & peakAndRms: decibel math and signal analysis", () => {
  assert.equal(linToDb(1), 0);
  assert.equal(Math.round(linToDb(0.5)), -6);
  assert.equal(linToDb(0), -100);

  const buffer = new Float32Array([0.5, -0.5, 0.5, -0.5]);
  const stats = peakAndRms(buffer);
  assert.equal(Math.round(stats.peakDb), -6);
  assert.equal(Math.round(stats.rmsDb), -6);
  assert.equal(stats.clipping, false);

  const clippingBuffer = new Float32Array([1.2, 0]);
  assert.equal(peakAndRms(clippingBuffer).clipping, true);
});

test("encodeWav: produces standard 44-byte RIFF WAVE 16-bit header and PCM data", () => {
  const sampleRate = 44100;
  const left = new Float32Array(sampleRate); // 1 second of silence
  const right = new Float32Array(sampleRate);
  // generate a small 440Hz sine wave on left channel
  for (let i = 0; i < sampleRate; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
  }

  const wavBuffer = encodeWav([left, right], sampleRate);
  assert.ok(wavBuffer instanceof ArrayBuffer);
  const view = new DataView(wavBuffer);

  // Check 'RIFF'
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  assert.equal(riff, "RIFF");

  // Check 'WAVE'
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );
  assert.equal(wave, "WAVE");

  // Check 'fmt '
  const fmt = String.fromCharCode(
    view.getUint8(12),
    view.getUint8(13),
    view.getUint8(14),
    view.getUint8(15),
  );
  assert.equal(fmt, "fmt ");

  // Channels = 2, SampleRate = 44100, BitsPerSample = 16
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), sampleRate);
  assert.equal(view.getUint16(34, true), 16);

  // Check total size
  const expectedDataBytes = sampleRate * 2 * 2; // 2 channels * 2 bytes
  assert.equal(wavBuffer.byteLength, 44 + expectedDataBytes);
});

test("createHistory: manages snapshot undo stack up to limit", () => {
  const history = createHistory(3);
  assert.equal(history.canUndo(), false);

  history.push({ v: 1 });
  history.push({ v: 2 });
  history.push({ v: 3 });

  assert.equal(history.canUndo(), true);
  assert.deepEqual(history.undo(), { v: 3 });
  assert.deepEqual(history.undo(), { v: 2 });
  assert.deepEqual(history.undo(), { v: 1 });
  assert.equal(history.canUndo(), false);

  // Test limit overflow
  history.push({ v: 10 });
  history.push({ v: 20 });
  history.push({ v: 30 });
  history.push({ v: 40 }); // drops 10
  assert.deepEqual(history.undo(), { v: 40 });
  assert.deepEqual(history.undo(), { v: 30 });
  assert.deepEqual(history.undo(), { v: 20 });
  assert.equal(history.canUndo(), false);
});
