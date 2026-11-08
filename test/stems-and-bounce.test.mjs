import test from "node:test";
import assert from "node:assert/strict";
import {
  audibleLength,
  createProject,
  PPQN,
  encodeWav,
  decodeWavHeader,
} from "../.agents/scripts/scdaw.js";
import { decodeZip } from "../.agents/scripts/scdaw-zip.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";

test("scdaw: audibleLength detects tail silence and trims up to threshold", () => {
  const sampleRate = 44100;
  const minLength = 44100; // 1 second musical length
  const totalLength = 88200; // 2 seconds (1s music + 1s tail)

  const left = new Float32Array(totalLength);
  const right = new Float32Array(totalLength);

  // Musical section has high signal
  left.subarray(0, minLength).fill(0.5);
  right.subarray(0, minLength).fill(0.5);

  // Tail decays until 1.5 seconds (sample 66150), then falls to pure silence
  for (let i = minLength; i < 66150; i++) {
    const decay = 0.5 * (1 - (i - minLength) / 22050);
    left[i] = decay;
    right[i] = decay;
  }
  // After 66150: zero / silence below threshold

  const trimmedLength = audibleLength([left, right], minLength, totalLength);
  assert.ok(
    trimmedLength >= 66130 && trimmedLength <= 66155,
    `Expected trimmed length near 66139, got ${trimmedLength}`,
  );
  assert.ok(trimmedLength < totalLength, "Tail should be trimmed");
  assert.ok(trimmedLength >= minLength, "Must never trim below musical length");
});

test("scdaw-engine: bounce() supports bitDepth 16, 24, and 32 with accurate headers", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  // 16-bit bounce
  const meta16 = await engine.bounce({ bitDepth: 16, loops: 1 });
  assert.equal(meta16.bitDepth, 16);
  assert.ok(meta16.bytes > 44);

  // 24-bit bounce
  const meta24 = await engine.bounce({ bitDepth: 24, loops: 1 });
  assert.equal(meta24.bitDepth, 24);
  assert.ok(
    meta24.bytes > meta16.bytes,
    "24-bit WAV must have more bytes than 16-bit",
  );

  // 32-bit Float bounce
  const meta32 = await engine.bounce({ bitDepth: 32, loops: 1 });
  assert.equal(meta32.bitDepth, 32);
  assert.ok(
    meta32.bytes > meta24.bytes,
    "32-bit float WAV must have more bytes than 24-bit",
  );
});

test("scdaw-engine: bounceStems() renders multi-track stems and bundles into ZIP archive", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  const result = await engine.bounceStems({
    loops: 1,
    tap: "post-fader",
    bitDepth: 24,
    bundleZip: true,
    includeMaster: true,
    includeMidi: true,
    includeProject: true,
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.stems), "Should return stems array");
  // Starter project has 2 tracks (drums and bass) + 1 master stem = 3 stems
  assert.equal(result.stems.length, 3);

  // Check stem names
  const stemNames = result.stems.map((s) => s.name);
  assert.ok(stemNames.includes("00_Master.wav"), "Must include 00_Master.wav");
  assert.ok(
    stemNames.some((n) => n.includes("Drums")),
    "Must include Drums stem",
  );
  assert.ok(
    stemNames.some((n) => n.includes("Bass")),
    "Must include Bass stem",
  );

  // Check ZIP bundle
  assert.ok(
    result.zipBuffer instanceof ArrayBuffer ||
      result.zipBuffer instanceof Uint8Array,
    "Must generate ZIP buffer",
  );
  assert.ok(result.zipBytes > 500, "ZIP bytes must be non-empty");

  // Extract ZIP and verify contents
  const extracted = await decodeZip(result.zipBuffer);
  const zipFileNames = extracted.map((f) => f.name);

  assert.ok(
    zipFileNames.includes("00_Master.wav"),
    "ZIP must contain master stem",
  );
  assert.ok(
    zipFileNames.some((n) => n.endsWith(".mid")),
    "ZIP must contain Standard MIDI File",
  );
  assert.ok(
    zipFileNames.some((n) => n.endsWith(".scdaw.json")),
    "ZIP must contain native project JSON",
  );

  // Verify headers of each WAV stem in the ZIP
  for (const file of extracted) {
    if (file.name.endsWith(".wav")) {
      const header = decodeWavHeader(file.data);
      assert.equal(header.bitsPerSample, 24);
      assert.equal(header.numChannels, 2);
      assert.equal(header.sampleRate, 44100);
    }
  }
});

test("scdaw-engine: bounceStems() honors pre-fader tap routing", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  const result = await engine.bounceStems({
    loops: 1,
    tap: "pre-fader",
    bitDepth: 16,
    bundleZip: false,
  });

  assert.equal(result.tap, "pre-fader");
  assert.equal(result.stems.length, 3);
  for (const s of result.stems) {
    assert.equal(s.bitDepth, 16);
    assert.ok(s.bytes > 44);
  }
});
