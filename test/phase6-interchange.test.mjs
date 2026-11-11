import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeMidiFile,
  decodeMidiFile,
  midiToProject,
} from "../.agents/scripts/scdaw-midi.js";
import { createProject, validateProject } from "../.agents/scripts/scdaw.js";
import { migrateProject } from "../.agents/scripts/scdaw-schema.js";

test("WP6.1: midiToProject emits valid project with kind, canonical velocity, and lengthBars", () => {
  // Synthesize a 16-bar multi-track MIDI project
  const source = createProject({
    title: "16-Bar Rock Session",
    bpm: 122,
    signature: [4, 4],
    lengthBars: 16,
    tracks: [
      {
        id: "trk_drums",
        name: "Drums",
        kind: "drums",
        notes: [
          { position: 0, duration: 480, pitch: 36, velocity: 0.95 },
          { position: 960, duration: 480, pitch: 38, velocity: 0.9 },
          { position: 15 * 3840, duration: 480, pitch: 49, velocity: 1.0 }, // Note in bar 16
        ],
      },
      {
        id: "trk_bass",
        name: "Electric Bass",
        kind: "synth",
        instrument: "soundfont",
        params: { program: 33 },
        notes: [
          { position: 0, duration: 960, pitch: 40, velocity: 0.85 },
          { position: 15 * 3840, duration: 960, pitch: 40, velocity: 0.8 },
        ],
      },
    ],
  });

  const smfBytes = encodeMidiFile(source);
  assert.ok(smfBytes instanceof Uint8Array);

  const imported = midiToProject(smfBytes);
  assert.ok(imported);
  assert.equal(imported.name, "16-Bar Rock Session");
  assert.equal(imported.bpm, 122);
  assert.deepEqual(imported.signature, [4, 4]);

  // Crucial Phase 6 fixes:
  // 1. lengthBars must span the full 16 bars, not 1 or 2 bars
  assert.equal(
    imported.lengthBars,
    16,
    "Imported project lengthBars must span all notes",
  );

  // 2. Tracks must have valid kind ('drums' or 'synth'), NOT 'type'
  for (const [idx, trk] of imported.tracks.entries()) {
    assert.ok(
      trk.kind === "drums" || trk.kind === "synth",
      `Track[${idx}] kind must be 'drums' or 'synth', found '${trk.kind}'`,
    );
    assert.ok(
      !trk.type || trk.kind === trk.type,
      "Track kind must take precedence over legacy type",
    );
  }

  // 3. Unique track IDs
  const trackIds = imported.tracks.map((t) => t.id);
  const uniqueIds = new Set(trackIds);
  assert.equal(trackIds.length, uniqueIds.size, "Track IDs must be unique");

  // 4. Canonical velocity 0.0 - 1.0
  for (const trk of imported.tracks) {
    for (const note of trk.notes) {
      assert.ok(
        note.velocity >= 0.0 && note.velocity <= 1.0,
        `Note velocity must be normalized float 0-1, got ${note.velocity}`,
      );
    }
  }

  // 5. Must pass validateProject
  const val = validateProject(imported);
  assert.equal(
    val.valid,
    true,
    `Imported project must validate: ${val.errors.join(", ")}`,
  );
});

test("WP6.2: migrateProject upgrades project to schema v2 with tempoMap, signatureMap, and sections", () => {
  const legacyV1 = {
    version: 1,
    name: "Legacy V1 Track",
    bpm: 128,
    signature: [3, 4],
    lengthBars: 8,
    tracks: [
      {
        id: "trk_1",
        name: "Legacy Synth",
        type: "synth", // legacy field
        notes: [
          { position: 0, duration: 480, pitch: 60, velocity: 110 }, // legacy MIDI velocity > 1.0
          { position: 960, duration: 480, pitch: 64, velocity: 127 },
        ],
      },
    ],
  };

  const v2 = migrateProject(legacyV1);
  assert.equal(v2.version, 2);
  assert.ok(Array.isArray(v2.tempoMap), "Schema v2 must have tempoMap");
  assert.equal(v2.tempoMap[0].bpm, 128);
  assert.ok(Array.isArray(v2.signatureMap), "Schema v2 must have signatureMap");
  assert.deepEqual(v2.signatureMap[0].signature, [3, 4]);
  assert.ok(Array.isArray(v2.sections), "Schema v2 must have sections array");

  // Track kind migration
  assert.equal(
    v2.tracks[0].kind,
    "synth",
    "Legacy track.type must migrate to track.kind",
  );

  // Velocity migration
  assert.ok(
    v2.tracks[0].notes[0].velocity <= 1.0,
    `Legacy velocity 110 must be normalized to <= 1.0, got ${v2.tracks[0].notes[0].velocity}`,
  );
  assert.ok(
    v2.tracks[0].notes[1].velocity <= 1.0,
    `Legacy velocity 127 must be normalized to <= 1.0, got ${v2.tracks[0].notes[1].velocity}`,
  );
});
