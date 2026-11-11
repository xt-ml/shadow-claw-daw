import test from "node:test";
import assert from "node:assert/strict";
import {
  createGuitarOverdriveCurve,
  analyzeAudioBuffer,
} from "../.agents/scripts/scdaw-dsp.js";
import { applyCommand, createProject } from "../.agents/scripts/scdaw.js";
import { compileSong } from "../.agents/scripts/scdaw-compose.js";
import { handleToolDispatch } from "../.agents/scripts/scdaw-adapter.js";

test("WP5.1: createGuitarOverdriveCurve generates warm analog saturation transfer curve", () => {
  const curve = createGuitarOverdriveCurve(12, 0.4);
  assert.ok(curve instanceof Float32Array);
  assert.equal(curve.length, 1024);

  // Symmetry & bounds
  const zeroIdx = 512;
  assert.ok(Math.abs(curve[zeroIdx]) < 0.05, "Center should be near zero");
  assert.ok(
    curve[0] >= -1.0 && curve[0] < -0.6,
    "Negative extreme should compress smoothly",
  );
  assert.ok(
    curve[1023] <= 1.0 && curve[1023] > 0.6,
    "Positive extreme should compress smoothly",
  );

  // Non-linear compression: slope at center should be steeper than at extremes
  const centerSlope = curve[zeroIdx + 10] - curve[zeroIdx - 10];
  const edgeSlope = curve[1023] - curve[1003];
  assert.ok(
    centerSlope > edgeSlope,
    "Center linear gain should exceed saturated edge slope",
  );
});

test("WP5.1: analyzeAudioBuffer calculates peak dBFS, RMS, dynamic range, and clipping", () => {
  const sampleRate = 44100;
  const numFrames = 44100; // 1 second
  const left = new Float32Array(numFrames);
  const right = new Float32Array(numFrames);

  // 1 kHz sine wave at amplitude 0.5 (-6.02 dBFS peak, -9.03 dBFS RMS)
  for (let i = 0; i < numFrames; i++) {
    const val = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    left[i] = val;
    right[i] = val;
  }

  const analysis = analyzeAudioBuffer({ left, right, sampleRate });
  assert.ok(analysis.ok);
  assert.ok(
    Math.abs(analysis.peakDb - -6.02) < 0.1,
    `Peak should be ~ -6.02 dBFS, got ${analysis.peakDb}`,
  );
  assert.ok(
    Math.abs(analysis.rmsDb - -9.03) < 0.2,
    `RMS should be ~ -9.03 dBFS, got ${analysis.rmsDb}`,
  );
  assert.ok(
    Math.abs(analysis.crestFactorDb - 3.01) < 0.2,
    "Sine wave crest factor should be ~3.01 dB",
  );
  assert.equal(
    analysis.clipping,
    false,
    "Should not report clipping at 0.5 amplitude",
  );
  assert.equal(analysis.clippedSampleCount, 0);

  // Test with clipped signal
  left[100] = 1.0;
  left[101] = 1.05;
  const clippedAnalysis = analyzeAudioBuffer({ left, right, sampleRate });
  assert.equal(
    clippedAnalysis.clipping,
    true,
    "Must detect clipped samples >= 1.0",
  );
  assert.ok(clippedAnalysis.clippedSampleCount >= 2);
});

test("WP5.2: compose_song applies default mix template (HPF, bus sends, and master safety)", () => {
  const spec = {
    title: "Mix Template Rock",
    bpm: 122,
    feel: "straight-rock",
    instruments: {
      drums: "rock-kit",
      bass: "electric-bass-finger",
      rhythm: "overdriven-guitar",
      lead: "distortion-guitar",
    },
    sections: [{ name: "verse", bars: 4, chords: "E | A | B | E" }],
    form: ["verse"],
  };

  const project = compileSong(spec);
  assert.ok(project);

  // Verify master bus safety compressor & limiter settings
  assert.ok(project.master, "Project must have master configuration");
  assert.equal(
    project.master.limiter?.enabled,
    true,
    "Master limiter should be enabled by default",
  );
  assert.ok(
    project.master.limiter?.ceilingDb <= -0.3,
    "Ceiling should be at least -0.3 dBFS",
  );

  // Verify aux reverb send exists on rhythm and lead guitar
  const rhythm = project.tracks.find((t) => t.id === "trk_rhythm");
  const lead = project.tracks.find((t) => t.id === "trk_lead");
  assert.ok(rhythm && rhythm.sends, "Rhythm guitar must have sends");
  assert.ok(
    rhythm.sends.some(
      (s) => s.busId === "sendA" || s.busId === "reverb" || s.amount > 0,
    ),
  );

  // Verify high-pass filter on guitar tracks to clean mud
  assert.ok(
    rhythm.fx && rhythm.fx.length > 0,
    "Rhythm track should have FX chain",
  );
  const hpf = rhythm.fx.find(
    (f) =>
      f.type === "filter" ||
      f.type === "biquad" ||
      f.params?.type === "highpass",
  );
  assert.ok(hpf, "Rhythm guitar should have HPF to cut sub-rumble below 80Hz");
});

test("WP5.3: applyCommand and handleToolDispatch support analyze_mix / scdaw_analyze_mix", async () => {
  const p = createProject("straight-beat");

  // Reducer test
  const { result } = applyCommand(p, "analyze_mix", { durationSeconds: 2.0 });
  assert.ok(result);
  assert.equal(result.ok, true);
  assert.equal(typeof result.peakDb, "number");
  assert.equal(typeof result.rmsDb, "number");
  assert.ok(result.summary.includes("dBFS"));
  assert.ok(Array.isArray(result.suggestions));

  // Tool dispatch test
  const toolResult = await handleToolDispatch("scdaw_analyze_mix", {
    durationSeconds: 1.0,
  });
  assert.ok(toolResult);
  assert.equal(toolResult.ok, true);
  assert.ok(toolResult.summary);
});
