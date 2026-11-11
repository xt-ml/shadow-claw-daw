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
  automationValueAt,
  applyNoteFilter,
  applyChordStrum,
  applyZeitgeistGroove,
  applyHumanize,
  resolveTrackNotes,
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

  // Invalid tracks count (> 64)
  const tooManyTracks = {
    ...p,
    tracks: Array.from({ length: 65 }, (_, i) => ({
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

  // move_track and reorder_tracks
  const t0 = project.tracks[0].id;
  const p2 = applyCommand(project, "add_track", {
    kind: "synth",
    name: "Bass",
  }).project;
  const t1 = p2.tracks[1].id;
  const p3 = applyCommand(p2, "add_track", {
    kind: "audio",
    name: "Vox",
  }).project;
  const t2 = p3.tracks[2].id;

  // Move t2 (Vox) up -> should become index 1
  const upRes = applyCommand(p3, "move_track", {
    trackId: t2,
    direction: "up",
  });
  assert.deepEqual(
    upRes.project.tracks.map((t) => t.id),
    [t0, t2, t1],
  );

  // Move t0 (Drums) down -> should become index 1
  const downRes = applyCommand(p3, "move_track", {
    trackId: t0,
    direction: "down",
  });
  assert.deepEqual(
    downRes.project.tracks.map((t) => t.id),
    [t1, t0, t2],
  );

  // Move t0 directly to targetIndex 2
  const targetRes = applyCommand(p3, "move_track", {
    trackId: t0,
    targetIndex: 2,
  });
  assert.deepEqual(
    targetRes.project.tracks.map((t) => t.id),
    [t1, t2, t0],
  );

  // reorder_tracks by ID array
  const reorderRes = applyCommand(p3, "reorder_tracks", {
    trackIds: [t2, t1, t0],
  });
  assert.deepEqual(
    reorderRes.project.tracks.map((t) => t.id),
    [t2, t1, t0],
  );
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

test("automationValueAt: interpolates parameter values across time accurately", () => {
  const trackWithAuto = {
    id: "trk_bass",
    volume: 0.8,
    automation: {
      volume: [
        { time: 0, value: 0.2 },
        { time: 2, value: 1.0 },
        { time: 4, value: 0.0 },
      ],
      cutoff: [
        { time: 1, value: 400 },
        { time: 3, value: 2000 },
      ],
    },
  };

  // Default fallback when param has no automation
  assert.equal(automationValueAt(trackWithAuto, "pan", 0, 0.0), 0.0);
  assert.equal(
    automationValueAt({ id: "trk_clean" }, "volume", 960, 0.75),
    0.75,
  );

  // Clamping before first point (time < 0)
  assert.equal(automationValueAt(trackWithAuto, "volume", 0), 0.2);

  // Exact point match (time = 2 beats = 1920 PPQN)
  assert.equal(automationValueAt(trackWithAuto, "volume", 1920), 1.0);

  // Linear interpolation midpoint (time = 1 beat = 960 PPQN)
  // between (0, 0.2) and (2, 1.0) -> 0.2 + (1.0 - 0.2) * 0.5 = 0.6
  assert.equal(
    Math.round(automationValueAt(trackWithAuto, "volume", 960) * 100) / 100,
    0.6,
  );

  // Midpoint between 2 and 4 beats (time = 3 beats = 2880 PPQN)
  // between (2, 1.0) and (4, 0.0) -> 0.5
  assert.equal(
    Math.round(automationValueAt(trackWithAuto, "volume", 2880) * 100) / 100,
    0.5,
  );

  // Clamping after last point (time >= 4 beats = 3840 PPQN)
  assert.equal(automationValueAt(trackWithAuto, "volume", 4000), 0.0);

  // Cutoff before first point (time < 1 beat)
  assert.equal(automationValueAt(trackWithAuto, "cutoff", 0), 400);
  // Cutoff midpoint (time = 2 beats) -> 400 + (2000 - 400) * 0.5 = 1200
  assert.equal(automationValueAt(trackWithAuto, "cutoff", 1920), 1200);
  // Cutoff after last point (time >= 3 beats)
  assert.equal(automationValueAt(trackWithAuto, "cutoff", 3500), 2000);
});

test("applyCommand: set_automation and clear_automation manage automation lanes", () => {
  const p = createProject();
  const trackId = p.tracks[0].id;

  // Set points as array
  const res1 = applyCommand(p, "set_automation", {
    trackId,
    param: "volume",
    points: [
      { time: 2, value: 0.9 },
      { time: 0, value: 0.1 },
    ],
  });
  assert.equal(res1.result.ok, true);
  assert.equal(res1.result.param, "volume");
  assert.equal(res1.result.pointCount, 2);

  // Verify points were sorted by time
  const autoPoints = res1.project.tracks[0].automation.volume;
  assert.equal(autoPoints[0].time, 0);
  assert.equal(autoPoints[0].value, 0.1);
  assert.equal(autoPoints[1].time, 2);
  assert.equal(autoPoints[1].value, 0.9);

  // Add single point
  const res2 = applyCommand(res1.project, "set_automation", {
    trackId,
    param: "volume",
    time: 1,
    value: 0.5,
  });
  assert.equal(res2.result.pointCount, 3);
  const updatedPoints = res2.project.tracks[0].automation.volume;
  assert.equal(updatedPoints[1].time, 1);
  assert.equal(updatedPoints[1].value, 0.5);

  // Clear single param automation
  const res3 = applyCommand(res2.project, "clear_automation", {
    trackId,
    param: "volume",
  });
  assert.equal(res3.result.ok, true);
  assert.deepEqual(res3.project.tracks[0].automation.volume, []);

  // Clear all track automation
  const res4 = applyCommand(res2.project, "clear_automation", {
    trackId,
  });
  assert.equal(res4.result.ok, true);
  assert.deepEqual(res4.project.tracks[0].automation, {});
});

test("applyCommand: audio tracks and audio clips management", () => {
  const p = createProject("empty");

  // Add audio track
  const res1 = applyCommand(p, "add_track", {
    name: "Vocals",
    kind: "audio",
  });
  assert.equal(res1.result.kind, "audio");
  const audioTrackId = res1.result.trackId;
  const audioTrack = res1.project.tracks.find((t) => t.id === audioTrackId);
  assert.ok(audioTrack);
  assert.equal(audioTrack.kind, "audio");
  assert.deepEqual(audioTrack.audioClips, []);

  // Add audio clip
  const clipPayload = {
    id: "clip_vocal_lead",
    name: "Lead Vocal Take 1",
    sample: "sample_vocal_lead.wav",
    time: 0,
    duration: 4,
    offset: 0,
    gain: 1.0,
  };
  const res2 = applyCommand(res1.project, "add_audio_clip", {
    trackId: audioTrackId,
    clip: clipPayload,
  });
  assert.equal(res2.result.ok, true);
  assert.equal(res2.result.clipId, "clip_vocal_lead");
  const trkWithClip = res2.project.tracks.find((t) => t.id === audioTrackId);
  assert.equal(trkWithClip.audioClips.length, 1);
  assert.equal(trkWithClip.audioClips[0].name, "Lead Vocal Take 1");

  // Update audio clip
  const res3 = applyCommand(res2.project, "set_audio_clip", {
    trackId: audioTrackId,
    clipId: "clip_vocal_lead",
    patch: {
      time: 1.0,
      gain: 0.85,
    },
  });
  assert.equal(res3.result.ok, true);
  const updatedClip = res3.project.tracks.find((t) => t.id === audioTrackId)
    .audioClips[0];
  assert.equal(updatedClip.time, 1.0);
  assert.equal(updatedClip.gain, 0.85);

  // Remove audio clip
  const res4 = applyCommand(res3.project, "remove_audio_clip", {
    trackId: audioTrackId,
    clipId: "clip_vocal_lead",
  });
  assert.equal(res4.result.ok, true);
  const trkAfterRemove = res4.project.tracks.find((t) => t.id === audioTrackId);
  assert.equal(trkAfterRemove.audioClips.length, 0);
});

test("applyCommand: sends and return routing management", () => {
  const p = createProject();
  const trk1 = p.tracks[0].id;
  const trk2 = p.tracks[1].id;

  // Set send
  const res1 = applyCommand(p, "set_track_send", {
    trackId: trk1,
    targetTrackId: trk2,
    level: 0.45,
  });
  assert.equal(res1.result.ok, true);
  assert.equal(res1.result.level, 0.45);
  const trackWithSend = res1.project.tracks.find((t) => t.id === trk1);
  assert.equal(trackWithSend.sends.length, 1);
  assert.equal(trackWithSend.sends[0].targetTrackId, trk2);
  assert.equal(trackWithSend.sends[0].level, 0.45);

  // Update existing send level
  const res2 = applyCommand(res1.project, "set_track_send", {
    trackId: trk1,
    targetTrackId: trk2,
    level: 0.75,
  });
  assert.equal(
    res2.project.tracks.find((t) => t.id === trk1).sends[0].level,
    0.75,
  );

  // Remove send
  const res3 = applyCommand(res2.project, "remove_track_send", {
    trackId: trk1,
    targetTrackId: trk2,
  });
  assert.equal(res3.result.ok, true);
  assert.equal(res3.project.tracks.find((t) => t.id === trk1).sends.length, 0);
});

test("applyNoteFilter: filters notes outside pitch and velocity boundaries", () => {
  const notes = [
    { pitch: 36, velocity: 0.8, position: 0, duration: 240 },
    { pitch: 48, velocity: 0.5, position: 240, duration: 240 },
    { pitch: 60, velocity: 0.9, position: 480, duration: 240 },
    { pitch: 72, velocity: 0.2, position: 720, duration: 240 },
  ];

  // Pitch range 40..65
  const pitchFiltered = applyNoteFilter(notes, { minPitch: 40, maxPitch: 65 });
  assert.equal(pitchFiltered.length, 2);
  assert.deepEqual(
    pitchFiltered.map((n) => n.pitch),
    [48, 60],
  );

  // Velocity range 0.4..0.85
  const velFiltered = applyNoteFilter(notes, {
    minVelocity: 0.4,
    maxVelocity: 0.85,
  });
  assert.equal(velFiltered.length, 2);
  assert.deepEqual(
    velFiltered.map((n) => n.pitch),
    [36, 48],
  );
});

test("applyChordStrum: expands notes into chords with strum offsets", () => {
  const notes = [{ pitch: 60, velocity: 0.8, position: 0, duration: 480 }]; // C4

  // Major triad (C4, E4, G4 -> 60, 64, 67)
  const triad = applyChordStrum(notes, {
    type: "major",
    strumTicks: 10,
    direction: "up",
  });
  assert.equal(triad.length, 3);
  assert.deepEqual(
    triad.map((n) => n.pitch),
    [60, 64, 67],
  );
  assert.equal(triad[0].position, 0);
  assert.equal(triad[1].position, 10);
  assert.equal(triad[2].position, 20);

  // Minor 7th downward strum (60, 63, 67, 70)
  const min7 = applyChordStrum(notes, {
    type: "min7",
    strumTicks: 15,
    direction: "down",
  });
  assert.equal(min7.length, 4);
  assert.deepEqual(
    min7.map((n) => n.pitch),
    [70, 67, 63, 60],
  );
  assert.equal(min7[0].position, 0);
  assert.equal(min7[1].position, 15);
});

test("applyZeitgeistGroove: warps micro-timing according to groove templates", () => {
  const notes = [
    { pitch: 60, position: 0, duration: 240, velocity: 0.8 },
    { pitch: 60, position: 240, duration: 240, velocity: 0.8 }, // 16th note offbeat
    { pitch: 60, position: 480, duration: 240, velocity: 0.8 },
    { pitch: 60, position: 720, duration: 240, velocity: 0.8 },
  ];

  const mpc = applyZeitgeistGroove(notes, { template: "mpc60", amount: 0.8 });
  assert.equal(mpc.length, 4);
  assert.equal(mpc[0].position, 0); // onbeats stay aligned
  assert.ok(mpc[1].position > 240, "MPC60 groove should push 16th notes later");

  const rushed = applyZeitgeistGroove(notes, {
    template: "rushed",
    amount: 0.5,
  });
  assert.ok(
    rushed[1].position < 240,
    "Rushed groove should pull notes earlier",
  );
});

test("applyHumanize: adds deterministic micro-timing and velocity deviations", () => {
  const notes = [
    { pitch: 60, position: 0, duration: 240, velocity: 0.8 },
    { pitch: 62, position: 240, duration: 240, velocity: 0.8 },
    { pitch: 64, position: 480, duration: 240, velocity: 0.8 },
  ];

  const h1 = applyHumanize(notes, {
    timingTicks: 15,
    velocity: 10,
    seed: 1234,
  });
  const h2 = applyHumanize(notes, {
    timingTicks: 15,
    velocity: 10,
    seed: 1234,
  });
  assert.deepEqual(h1, h2, "Humanize with same seed must be deterministic");

  // Deviations occurred
  assert.ok(h1[1].position !== 240 || h1[1].velocity !== 0.8);
  assert.ok(h1[0].position >= 0, "Position should never be negative");
});

test("resolveTrackNotes: chains MIDI FX pipeline (NoteFilter -> Chord -> Arp -> Zeitgeist -> Humanize)", () => {
  const p = createProject();
  const track = {
    id: "trk_test",
    notes: [{ pitch: 60, position: 0, duration: 960, velocity: 0.8 }],
    midiFx: [
      { type: "chord", chordType: "triad", strumTicks: 5 },
      { type: "zeitgeist", template: "swing16", amount: 0.6 },
    ],
  };

  const resolved = resolveTrackNotes(p, track, { loops: 1, bakeMidiFx: true });
  assert.ok(resolved.length >= 3, "Chord expansion should produce 3 voices");
});
