import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTRUMENT_SCHEMAS,
  FX_SCHEMAS,
  validateAndFilterParams,
  normalizeFxParams,
} from "../.agents/scripts/shadow-claw-daw-schema.js";
import {
  createWaveshaperCurve,
  buildTrackFxChain,
  processTrackOfflineFx,
  analyzeAudioBuffer,
} from "../.agents/scripts/shadow-claw-daw-dsp.js";
import {
  triggerSynth,
  triggerNano,
  synthesizeSfxBuffer,
} from "../.agents/scripts/shadow-claw-daw-instruments.js";
import { INSTRUMENT_PRESETS } from "../.agents/scripts/shadow-claw-daw-presets.js";
import {
  createProject,
  applyCommand,
} from "../.agents/scripts/shadow-claw-daw.js";
import { DawEngine } from "../.agents/scripts/shadow-claw-daw-engine.js";
import { handleToolDispatch } from "../.agents/scripts/shadow-claw-daw-adapter.js";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";

test("TDD 1: SYNTH_PARAM_SCHEMA and NANO_SCHEMA preserve airhorn synthesis & sampler parameters", () => {
  const synthInput = {
    waveform: "sawtooth",
    osc2Waveform: "sawtooth",
    osc2Octave: 0,
    osc2Detune: 28,
    osc2Mix: 0.85,
    subMix: 0.0,
    noiseMix: 0.15,
    unisonCount: 5,
    unisonDetune: 35,
    unisonStereo: 0.7,
    monophonic: true,
    pitchEnvAmount: 2.5,
    pitchAttack: 0.035,
    pitchReleaseDrop: -4.0,
    filterType: "horn",
    highpassCutoff: 520,
    cutoff: 2200,
    resonance: 4.5,
    filterEnvAmount: 1800,
    filterDecay: 0.25,
    lfoWaveform: "sine",
    lfoRate: 6.5,
    lfoPitchDepth: 15,
    lfoFilterDepth: 200,
    drive: 0.65,
    glide: 0.02,
    attack: 0.008,
    decay: 0.25,
    sustain: 0.9,
    release: 0.22,
  };

  const validatedSynth = validateAndFilterParams("synth", synthInput);
  for (const [key, val] of Object.entries(synthInput)) {
    assert.equal(
      validatedSynth[key],
      val,
      `Expected synth parameter '${key}' to be preserved by validateAndFilterParams`,
    );
  }

  const nanoInput = {
    samplePreset: "dj-airhorn",
    rootKey: 66,
    monophonic: true,
    pitchEnvAmount: 2.0,
    pitchAttack: 0.03,
    pitchReleaseDrop: -4.5,
    highpassCutoff: 520,
    formantFreq: 2100,
    drive: 0.6,
    attack: 0.005,
    release: 0.22,
  };
  const validatedNano = validateAndFilterParams("nano", nanoInput);
  for (const [key, val] of Object.entries(nanoInput)) {
    assert.equal(
      validatedNano[key],
      val,
      `Expected nano parameter '${key}' to be preserved by validateAndFilterParams`,
    );
  }
});

test("TDD 2: FX_SCHEMAS includes waveshaper & eq, and normalizeFxParams resolves aliases", () => {
  assert.ok(FX_SCHEMAS.waveshaper, "FX_SCHEMAS should include waveshaper");
  assert.ok(FX_SCHEMAS.eq, "FX_SCHEMAS should include eq");
  assert.ok(
    FX_SCHEMAS.revamp.hpFreq && FX_SCHEMAS.revamp.midFreq,
    "revamp should expose hpFreq and midFreq",
  );

  // Alias normalization: drive -> driveDb, wet -> mix, time -> timeStepsL/R
  const normFold = normalizeFxParams("fold", { drive: 14, wet: 0.65 });
  assert.equal(normFold.driveDb, 14);
  assert.equal(normFold.mix, 0.65);

  const normDelay = normalizeFxParams("delay", { time: 4, wet: 0.35 });
  assert.equal(normDelay.timeStepsL, 4);
  assert.equal(normDelay.timeStepsR, 4);
  assert.equal(normDelay.wet, 0.35);

  // Also test via applyCommand('manage_fx')
  let p = createProject("basic-beat");
  p = applyCommand(p, "manage_fx", {
    trackId: "trk_bass",
    action: "add",
    fxType: "fold",
    params: { drive: 15, wet: 0.7 },
  }).project;
  const foldFx = p.tracks.find((t) => t.id === "trk_bass").fx[0];
  assert.equal(foldFx.driveDb, 15);
  assert.equal(foldFx.mix, 0.7);
});

test("TDD 3: createWaveshaperCurve and processTrackOfflineFx transform track audio according to track.fx", () => {
  for (const eq of [
    "hardclip",
    "softclip",
    "sigmoid",
    "atan",
    "sin",
    "foldback",
  ]) {
    const curve = createWaveshaperCurve(eq, 12, 1024);
    assert.ok(curve instanceof Float32Array);
    assert.equal(curve.length, 1024);
    assert.ok(curve[0] >= -1 && curve[1023] <= 1);
  }

  const sampleRate = 44100;
  const len = 4410; // 100ms
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  // Mix of 150 Hz low tone + 2000 Hz horn tone
  for (let i = 0; i < len; i++) {
    const s =
      0.4 * Math.sin((2 * Math.PI * 150 * i) / sampleRate) +
      0.4 * Math.sin((2 * Math.PI * 2000 * i) / sampleRate);
    left[i] = s;
    right[i] = s;
  }

  const fxChain = [
    {
      type: "revamp",
      hpFreq: 500,
      lowGain: -18,
      midGain: 8,
      midFreq: 2000,
      midQ: 2.5,
      highGain: 3,
    },
    { type: "fold", driveDb: 12, mix: 0.7 },
    { type: "crusher", bits: 10, downsample: 2, mix: 0.4 },
    { type: "delay", timeStepsL: 1, timeStepsR: 2, feedback: 0.3, wet: 0.25 },
    { type: "reverb", decay: 0.8, damping: 0.5, preDelayMs: 5, wet: 0.2 },
  ];

  const processed = processTrackOfflineFx(
    left,
    right,
    fxChain,
    120,
    sampleRate,
  );
  assert.ok(processed.outLeft instanceof Float32Array);
  assert.ok(processed.outRight instanceof Float32Array);

  // Verify the audio was measurably transformed by the FX chain
  let diffSum = 0;
  for (let i = 0; i < len; i++) {
    diffSum += Math.abs(processed.outLeft[i] - left[i]);
  }
  assert.ok(
    diffSum > 50,
    `Expected FX chain to significantly alter signal, got diffSum=${diffSum}`,
  );

  // Also test Web Audio node chain builder
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();
  const chain = buildTrackFxChain(ctx, dest, fxChain, 120);
  assert.ok(chain.input, "buildTrackFxChain must return an input node");
  assert.ok(Array.isArray(chain.nodes) && chain.nodes.length > 0);
});

test("TDD 4: synthesizeSfxBuffer('dj-airhorn') produces authentic high-mid horn formant with low mud cut and pitch sag", () => {
  const ctx = new FakeAudioContext({ sampleRate: 44100 });
  const buf = synthesizeSfxBuffer(ctx, "dj-airhorn", { duration: 0.85 });
  assert.ok(buf, "synthesizeSfxBuffer should return an AudioBuffer");
  const left = buf.getChannelData(0);
  const right =
    buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0);
  assert.ok(left.length >= 44100 * 0.5);

  const analysis = analyzeAudioBuffer({
    left,
    right,
    sampleRate: buf.sampleRate,
  });

  assert.ok(analysis.ok);
  assert.ok(
    analysis.spectralCentroidHz > 1400,
    `DJ Airhorn spectral centroid should be > 1400 Hz (bright horn), got ${analysis.spectralCentroidHz}`,
  );
  assert.ok(
    analysis.bandEnergy,
    "analyzeAudioBuffer should return 5-band energy distribution",
  );
  // Horn formant band (highMid: 1.2kHz - 4kHz) + mid (400Hz - 1.2kHz) must dominate over sub+low (< 400Hz)
  const lowTotal =
    (analysis.bandEnergy.sub || 0) + (analysis.bandEnergy.low || 0);
  const hornBand =
    (analysis.bandEnergy.mid || 0) + (analysis.bandEnergy.highMid || 0);
  assert.ok(
    lowTotal < 0.12,
    `Low/sub mud (<400Hz) must be < 12% of energy, got ${lowTotal}`,
  );
  assert.ok(
    hornBand > 0.65,
    `Horn formant bands (400Hz-4kHz) must exceed 65% of energy, got ${hornBand}`,
  );
  assert.ok(
    analysis.pitchSagSemitones < -0.5,
    `Airhorn should exhibit downward pitch sag on release (< -0.5 semitones), got ${analysis.pitchSagSemitones}`,
  );
});

test("TDD 5: INSTRUMENT_PRESETS['dj-airhorn'] and monophonic choke work on both nano and synth", () => {
  const preset = INSTRUMENT_PRESETS["dj-airhorn"];
  assert.ok(preset, "INSTRUMENT_PRESETS must include 'dj-airhorn'");
  assert.equal(preset.monophonic, true);
  assert.equal(preset.samplePreset, "dj-airhorn");

  const ctx = new FakeAudioContext({ sampleRate: 44100 });
  const dest = ctx.createGain();

  // Trigger rapid airhorn stabs on nano with monophonic choke
  const v1 = triggerNano(
    ctx,
    dest,
    { pitch: 66, velocity: 0.95, duration: 480 },
    0.0,
    preset,
    130,
    1.0,
  );
  assert.ok(v1 && typeof v1.stop === "function");

  // Also test triggerSynth with unison + pitch envelope + horn filter
  const vSynth = triggerSynth(
    ctx,
    dest,
    { pitch: 66, velocity: 0.95, duration: 960 },
    0.0,
    preset,
    130,
    1.0,
  );
  assert.ok(vSynth && typeof vSynth.stop === "function");
  assert.ok(
    ctx.oscillators.length >= 3,
    "Unison synth voice should spawn multiple detuned oscillators",
  );
});

test("TDD 6: DawEngine connects per-track FX in _updateGraph and bounce", async () => {
  let p = createProject("empty");
  p = applyCommand(p, "add_track", {
    id: "trk_horn",
    name: "DJ Airhorn",
    kind: "synth",
  }).project;
  p = applyCommand(p, "apply_preset", {
    trackId: "trk_horn",
    preset: "dj-airhorn",
  }).project;
  p = applyCommand(p, "add_notes", {
    trackId: "trk_horn",
    notes: [
      { position: 0, duration: 200, pitch: 66, velocity: 0.95 },
      { position: 240, duration: 200, pitch: 66, velocity: 0.95 },
      { position: 480, duration: 200, pitch: 66, velocity: 0.95 },
      { position: 720, duration: 1920, pitch: 66, velocity: 1.0 },
    ],
  }).project;

  const engine = new DawEngine({
    project: p,
    AudioContextClass: FakeAudioContext,
    OfflineAudioContextClass: FakeOfflineAudioContext,
  });
  await engine.ensureContext();

  const hornTrackNodes = engine.trackNodes.get("trk_horn");
  assert.ok(hornTrackNodes, "Track nodes should be created for trk_horn");
  assert.ok(
    hornTrackNodes.fxChain && hornTrackNodes.fxChain.nodes.length > 0,
    "Track node graph should instantiate FX chain nodes when track has FX",
  );
});

test("TDD 7: scdaw_list_schemas, scdaw_design_sound, and enriched scdaw_analyze_mix work end-to-end", async () => {
  const schemasRes = await handleToolDispatch("scdaw_list_schemas", {
    category: "all",
  });
  assert.equal(schemasRes.ok, true);
  assert.ok(schemasRes.instruments.synth.unisonCount);
  assert.ok(schemasRes.instruments.nano.samplePreset);
  assert.ok(schemasRes.presets.includes("dj-airhorn"));

  // Create fresh project and design a DJ Airhorn sound via scdaw_design_sound
  await handleToolDispatch("scdaw_create_project", {
    template: "empty",
    bpm: 130,
  });
  await handleToolDispatch("scdaw_add_track", {
    id: "trk_horn",
    name: "DJ Airhorn",
    kind: "synth",
  });

  const designRes = await handleToolDispatch("scdaw_design_sound", {
    trackId: "trk_horn",
    recipe: "dj-airhorn",
    insertDefaultPattern: true,
  });
  assert.equal(designRes.ok, true);
  assert.equal(designRes.track.instrument, "nano");
  assert.equal(designRes.track.params.samplePreset, "dj-airhorn");
  assert.ok(
    designRes.track.notes.length >= 4,
    "insertDefaultPattern should insert the classic wha-wha-wha-whaaaaaa pattern",
  );

  const mixRes = await handleToolDispatch("scdaw_analyze_mix", {
    durationSeconds: 2.0,
  });
  assert.equal(mixRes.ok, true);
  assert.ok(
    mixRes.spectralCentroidHz > 1400,
    `Expected analyze_mix spectralCentroidHz > 1400 Hz for DJ Airhorn, got ${mixRes.spectralCentroidHz}`,
  );
  assert.ok(mixRes.bandEnergy);
});
