import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeMidiFile,
  decodeMidiFile,
  midiToProject,
  writeVarLen,
  readVarLen,
  SMF_FORMAT_SINGLE_TRACK,
  SMF_FORMAT_MULTI_TRACK,
} from "../.agents/scripts/scdaw-midi.js";
import { createProject, PPQN } from "../.agents/scripts/scdaw.js";

test("scdaw-midi: writeVarLen and readVarLen encode/decode variable-length quantities", () => {
  const testCases = [
    { value: 0, expected: [0x00] },
    { value: 0x40, expected: [0x40] },
    { value: 0x7f, expected: [0x7f] },
    { value: 0x80, expected: [0x81, 0x00] },
    { value: 240, expected: [0x81, 0x70] },
    { value: 960, expected: [0x87, 0x40] },
    { value: 0x3fff, expected: [0xff, 0x7f] },
    { value: 0x4000, expected: [0x81, 0x80, 0x00] },
    { value: 0x1fffff, expected: [0xff, 0xff, 0x7f] },
    { value: 0x200000, expected: [0x81, 0x80, 0x80, 0x00] },
  ];

  for (const { value, expected } of testCases) {
    const encoded = writeVarLen(value);
    assert.deepEqual(
      Array.from(encoded),
      expected,
      `Encoding failed for value ${value}`,
    );
    const { value: decoded, bytesRead } = readVarLen(
      new Uint8Array(expected),
      0,
    );
    assert.equal(decoded, value, `Decoding failed for value ${value}`);
    assert.equal(
      bytesRead,
      expected.length,
      `bytesRead mismatch for value ${value}`,
    );
  }
});

test("scdaw-midi: encodeMidiFile generates valid SMF Format 1 multi-track file", () => {
  const project = createProject({
    title: "SMF Test Song",
    bpm: 128,
    tracks: [
      {
        id: "drums",
        name: "Drums",
        type: "drums",
        volume: 0.85,
        pan: 0,
        notes: [
          { position: 0, duration: 240, pitch: 36, velocity: 100 }, // Kick on beat 1
          { position: 960, duration: 240, pitch: 38, velocity: 90 }, // Snare on beat 2
        ],
      },
      {
        id: "bass",
        name: "Bass Synth",
        type: "synth",
        volume: 0.8,
        pan: 0,
        notes: [
          { position: 0, duration: 480, pitch: 36, velocity: 85 },
          { position: 480, duration: 480, pitch: 38, velocity: 85 },
        ],
      },
    ],
  });

  const bytes = encodeMidiFile(project, {
    format: SMF_FORMAT_MULTI_TRACK,
    loops: false,
  });
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 30);

  // Check header 'MThd' (0x4D, 0x54, 0x68, 0x64)
  assert.equal(bytes[0], 0x4d);
  assert.equal(bytes[1], 0x54);
  assert.equal(bytes[2], 0x68);
  assert.equal(bytes[3], 0x64);

  // Header length is 6
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(4, false), 6);

  // Format 1
  assert.equal(view.getUint16(8, false), 1);
  // 3 tracks: 1 Conductor track + 2 instrument tracks
  assert.equal(view.getUint16(10, false), 3);
  // Time division 960
  assert.equal(view.getUint16(12, false), 960);

  // Decode the generated file
  const decoded = decodeMidiFile(bytes);
  assert.equal(decoded.format, 1);
  assert.equal(decoded.division, 960);
  assert.equal(decoded.bpm, 128);
  assert.equal(decoded.tracks.length, 3);

  // Conductor track
  assert.equal(decoded.tracks[0].name, "SMF Test Song");
  assert.deepEqual(decoded.tracks[0].timeSignature, [4, 4]);

  // Track 1: Drums on channel 9 (GM 10)
  assert.equal(decoded.tracks[1].name, "Drums");
  assert.equal(decoded.tracks[1].channel, 9);
  assert.equal(decoded.tracks[1].notes.length, 2);
  assert.equal(decoded.tracks[1].notes[0].pitch, 36);
  assert.equal(decoded.tracks[1].notes[0].position, 0);
  assert.equal(decoded.tracks[1].notes[0].duration, 240);

  // Track 2: Bass on channel 0
  assert.equal(decoded.tracks[2].name, "Bass Synth");
  assert.equal(decoded.tracks[2].channel, 0);
  assert.equal(decoded.tracks[2].notes.length, 2);
  assert.equal(decoded.tracks[2].notes[0].pitch, 36);
  assert.equal(decoded.tracks[2].notes[0].duration, 480);
});

test("scdaw-midi: encodeMidiFile generates valid SMF Format 0 single-track file", () => {
  const project = createProject({
    title: "Format 0 Song",
    bpm: 140,
    tracks: [
      {
        id: "lead",
        name: "Lead Synth",
        type: "synth",
        notes: [
          { position: 0, duration: 480, pitch: 60, velocity: 100 },
          { position: 480, duration: 480, pitch: 64, velocity: 100 },
        ],
      },
    ],
  });

  const bytes = encodeMidiFile(project, {
    format: SMF_FORMAT_SINGLE_TRACK,
    loops: false,
  });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Format 0
  assert.equal(view.getUint16(8, false), 0);
  // Exactly 1 track
  assert.equal(view.getUint16(10, false), 1);

  const decoded = decodeMidiFile(bytes);
  assert.equal(decoded.format, 0);
  assert.equal(decoded.tracks.length, 1);
  assert.equal(decoded.bpm, 140);
  assert.equal(decoded.tracks[0].notes.length, 2);
  assert.equal(decoded.tracks[0].notes[0].pitch, 60);
});

test("scdaw-midi: decodes running status and handles variable time division rescaling", () => {
  // Construct a minimal SMF buffer with running status and division = 480
  // MThd: len=6, fmt=0, tracks=1, div=480
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64, // 'MThd'
    0x00,
    0x00,
    0x00,
    0x06, // length 6
    0x00,
    0x00, // format 0
    0x00,
    0x01, // 1 track
    0x01,
    0xe0, // 480 ticks/quarter
  ];

  const trackEvents = [
    // Delta 0, Tempo event (500000 us = 120 bpm)
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    // Delta 0, Note ON Ch 0, Pitch 60, Vel 100
    0x00, 0x90, 0x3c, 0x64,
    // Delta 240 (0x81, 0x70), Note OFF Ch 0 via running status (pitch 60, vel 0)
    0x81,
    0x70, 0x3c, 0x00,
    // Delta 0, End of Track
    0x00, 0xff, 0x2f, 0x00,
  ];

  const trackChunk = [
    0x4d,
    0x54,
    0x72,
    0x6b, // 'MTrk'
    0x00,
    0x00,
    0x00,
    trackEvents.length,
    ...trackEvents,
  ];

  const rawBytes = new Uint8Array([...header, ...trackChunk]);
  const decoded = decodeMidiFile(rawBytes);
  assert.equal(decoded.division, 480);
  assert.equal(decoded.bpm, 120);
  assert.equal(decoded.tracks[0].notes.length, 1);
  assert.equal(decoded.tracks[0].notes[0].pitch, 60);
  assert.equal(decoded.tracks[0].notes[0].position, 0);
  assert.equal(decoded.tracks[0].notes[0].duration, 240);

  // Now test midiToProject which rescales 480 TPQN -> 960 PPQN (2x scaling)
  const importedProject = midiToProject(rawBytes);
  assert.equal(importedProject.bpm, 120);
  assert.ok(importedProject.tracks.length >= 1);
  const track = importedProject.tracks[0];
  assert.equal(track.notes.length, 1);
  assert.equal(track.notes[0].pitch, 60);
  assert.equal(track.notes[0].position, 0);
  // Rescaled duration: 240 * (960 / 480) = 480 PPQN
  assert.equal(track.notes[0].duration, 480);
});

test("scdaw-midi: round-trip project -> encodeMidiFile -> midiToProject preserves musical integrity", () => {
  const original = createProject({
    title: "RoundTrip Song",
    bpm: 124,
    tracks: [
      {
        id: "drums",
        name: "Drums",
        type: "drums",
        notes: [
          { position: 0, duration: 240, pitch: 36, velocity: 100 },
          { position: 960, duration: 240, pitch: 38, velocity: 90 },
          { position: 1920, duration: 240, pitch: 36, velocity: 95 },
        ],
      },
      {
        id: "lead",
        name: "Lead Synth",
        type: "synth",
        notes: [
          { position: 0, duration: 960, pitch: 60, velocity: 80 },
          { position: 960, duration: 480, pitch: 64, velocity: 85 },
          { position: 1440, duration: 480, pitch: 67, velocity: 90 },
        ],
      },
    ],
  });

  const midiBytes = encodeMidiFile(original, { loops: false });
  const restored = midiToProject(midiBytes);

  assert.equal(restored.bpm, 124);
  assert.equal(restored.tracks.length, 2);

  const drumTrack = restored.tracks.find(
    (t) => t.type === "drums" || t.name === "Drums",
  );
  assert.ok(drumTrack, "Restored project should contain drum track");
  assert.equal(drumTrack.notes.length, 3);
  assert.equal(drumTrack.notes[0].pitch, 36);
  assert.equal(drumTrack.notes[0].position, 0);
  assert.equal(drumTrack.notes[0].duration, 240);

  const synthTrack = restored.tracks.find(
    (t) => t.type === "synth" || t.name === "Lead Synth",
  );
  assert.ok(synthTrack, "Restored project should contain synth track");
  assert.equal(synthTrack.notes.length, 3);
  assert.equal(synthTrack.notes[0].pitch, 60);
  assert.equal(synthTrack.notes[0].position, 0);
  assert.equal(synthTrack.notes[0].duration, 960);
});
