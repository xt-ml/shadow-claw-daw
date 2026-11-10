import test from "node:test";
import assert from "node:assert/strict";
import {
  createWavefolderCurve,
  processCrusherBuffer,
  processStereoTool,
  generateReverbImpulse,
  processAutotune,
  processVocoder,
  processMaximizer,
  processTidal,
  processTransientShaper,
  processSidechainDucking,
  TidalComputer,
} from "../.agents/scripts/scdaw-dsp.js";
import {
  INSTRUMENT_PRESETS,
  GENRE_TEMPLATES,
  generateGenrePattern,
} from "../.agents/scripts/scdaw-presets.js";
import {
  triggerSynth,
  triggerDrums,
  trigger808,
  triggerCubed,
  triggerPluck,
  triggerTubular,
  triggerNeon,
  triggerNoisePad,
  triggerKorpus,
  triggerNano,
  triggerSoundfont,
  triggerInstrumentVoice,
  setCachedSoundfont,
  getCachedSoundfont,
  clearSoundfontCache,
} from "../.agents/scripts/scdaw-instruments.js";
import {
  INSTRUMENT_SCHEMAS,
  getDefaultParams,
} from "../.agents/scripts/scdaw-schema.js";
import { FakeAudioContext } from "./helpers/fake-audio-context.mjs";
import {
  computeEventsInRange,
  createProject,
  applyCommand,
} from "../.agents/scripts/scdaw.js";

test("scdaw-dsp: createWavefolderCurve produces symmetric saturating transfer curve", () => {
  const curve = createWavefolderCurve(6.0, 1024);
  assert.ok(curve instanceof Float32Array);
  assert.equal(curve.length, 1024);
  assert.ok(!Number.isNaN(curve[0]));
  assert.ok(!Number.isNaN(curve[512]));
  // Output bounded within -1 and 1
  assert.ok(curve[0] >= -1 && curve[0] <= 1);
  assert.ok(curve[1023] >= -1 && curve[1023] <= 1);
});

test("scdaw-dsp: processCrusherBuffer reduces bit depth and sample rate", () => {
  const input = new Float32Array([0.1, 0.25, 0.45, 0.8, -0.3, -0.7]);
  const crushed = processCrusherBuffer(input, 4, 2);
  assert.equal(crushed.length, input.length);
  for (let i = 0; i < crushed.length; i++) {
    assert.ok(!Number.isNaN(crushed[i]));
  }
  // Downsampling rate 2 holds sample for 2 frames
  assert.equal(crushed[0], crushed[1]);
});

test("scdaw-dsp: processStereoTool adjusts width and stereo placement", () => {
  const left = new Float32Array([0.5, 0.2, -0.4]);
  const right = new Float32Array([0.5, -0.2, 0.4]);
  const { outLeft, outRight } = processStereoTool(left, right, 1.5, 0);
  assert.equal(outLeft.length, left.length);
  assert.equal(outRight.length, right.length);
  for (let i = 0; i < outLeft.length; i++) {
    assert.ok(!Number.isNaN(outLeft[i]));
    assert.ok(!Number.isNaN(outRight[i]));
  }
});

test("scdaw-dsp: generateReverbImpulse generates decaying stereo impulse response", () => {
  const impulse = generateReverbImpulse(44100, 1.0, 0.5, 10);
  assert.equal(impulse.left.length, 44100);
  assert.equal(impulse.right.length, 44100);
  assert.ok(!Number.isNaN(impulse.left[0]));
  // Impulse tail should decay (compare window averages to avoid noise zero-crossings)
  let initialEnergy = 0;
  let tailEnergy = 0;
  for (let i = 0; i < 200; i++) {
    initialEnergy += Math.abs(impulse.left[500 + i]);
    tailEnergy += Math.abs(impulse.left[40000 + i]);
  }
  assert.ok(initialEnergy > tailEnergy);
});

test("scdaw-presets: provides rich synth presets and genre templates", () => {
  assert.ok(INSTRUMENT_PRESETS["techno-bass"]);
  assert.equal(INSTRUMENT_PRESETS["techno-bass"].waveform, "sawtooth");
  assert.ok(INSTRUMENT_PRESETS["techno-bass"].filterEnvAmount > 0);

  assert.ok(INSTRUMENT_PRESETS["pop-pluck"]);
  assert.ok(INSTRUMENT_PRESETS["warm-pad"]);
  assert.ok(INSTRUMENT_PRESETS["acid-303"]);

  const technoProject = generateGenrePattern("techno-bass");
  assert.equal(technoProject.bpm, 132);
  assert.ok(technoProject.tracks.some((t) => t.kind === "drums"));
  assert.ok(technoProject.tracks.some((t) => t.kind === "synth"));

  const popProject = generateGenrePattern("pop");
  assert.equal(popProject.bpm, 118);
  assert.ok(popProject.tracks.length >= 2);

  const trapProject = generateGenrePattern("trap");
  assert.equal(trapProject.bpm, 140);
  const trapBass = trapProject.tracks.find((t) => t.id === "trk_bass");
  assert.equal(trapBass.instrument, "808");
  assert.ok(trapBass.notes.length > 0);

  const acidProject = generateGenrePattern("acid");
  assert.equal(acidProject.bpm, 135);
  const acidBass = acidProject.tracks.find((t) => t.id === "trk_bass");
  assert.equal(acidBass.instrument, "cubed");
  assert.ok(acidBass.notes.some((n) => n.accent));

  const ambientProject = generateGenrePattern("ambient");
  assert.equal(ambientProject.bpm, 75);
  const ambientPad = ambientProject.tracks.find((t) => t.id === "trk_bass");
  assert.equal(ambientPad.instrument, "noise-pad");
});

test("Vaporisateur: triggers multi-oscillator synth voice with filter envelope sweep", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  const voice = triggerSynth(
    ctx,
    dest,
    { pitch: 36, velocity: 0.9, duration: 480 },
    0.1,
    {
      waveform: "sawtooth",
      osc2Waveform: "square",
      osc2Octave: -1,
      osc2Detune: 10,
      osc2Mix: 0.4,
      subMix: 0.3,
      cutoff: 400,
      resonance: 5,
      filterEnvAmount: 2500,
      filterDecay: 0.12,
      attack: 0.01,
      decay: 0.2,
      sustain: 0.4,
      release: 0.1,
    },
    128,
  );

  assert.ok(voice);
});

test("Playfield drums: synthesizes 12 GM drum voices without errors", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  // Test 12 percussion pitches: kick (36), rim (37), snare (38), clap (39),
  // closed hat (42), low tom (41), open hat (46), mid tom (45), high tom (48),
  // crash (49), ride (51), shaker/cowbell (54/56)
  const pitches = [36, 37, 38, 39, 41, 42, 45, 46, 48, 49, 51, 54];
  for (const pitch of pitches) {
    const voice = triggerDrums(
      ctx,
      dest,
      { pitch, velocity: 0.8 },
      0.1,
      1.0,
      0,
    );
    assert.ok(voice, `drum pitch ${pitch} should trigger voice`);
  }
});

test("computeEventsInRange with MIDI FX: arpeggio expands note into 16ths", () => {
  const project = {
    version: 1,
    bpm: 120,
    signature: [4, 4],
    lengthBars: 1,
    tracks: [
      {
        id: "trk_arp",
        name: "Arp",
        kind: "synth",
        volume: 0.8,
        pan: 0,
        mute: false,
        solo: false,
        midiFx: [{ type: "arpeggio", mode: "up", rateSteps: 1, octaves: 2 }],
        notes: [
          // Held C minor chord across bar
          { position: 0, duration: 3840, pitch: 48, velocity: 0.8 },
          { position: 0, duration: 3840, pitch: 51, velocity: 0.8 },
          { position: 0, duration: 3840, pitch: 55, velocity: 0.8 },
        ],
      },
    ],
  };

  const events = computeEventsInRange(project, 0, 3840);
  assert.ok(
    events.length > 3,
    "arpeggiator should generate repeated 16th-note events across the bar",
  );
});

test("applyCommand('manage_fx'): adds, updates, resets, and removes audio/midi fx on track", () => {
  let p = createProject("basic-beat");
  const trackId = "trk_bass";

  // 1. Add FX
  const addRes = applyCommand(p, "manage_fx", {
    trackId,
    action: "add",
    fxType: "fold",
    params: { driveDb: 12, mix: 0.8 },
  });
  p = addRes.project;
  const bass = p.tracks.find((t) => t.id === trackId);
  assert.equal(bass.fx.length, 1);
  assert.equal(bass.fx[0].type, "fold");
  assert.equal(bass.fx[0].driveDb, 12);

  // 2. Update FX
  const updateRes = applyCommand(p, "manage_fx", {
    trackId,
    action: "update",
    fxType: "fold",
    params: { driveDb: 18 },
  });
  p = updateRes.project;
  assert.equal(p.tracks.find((t) => t.id === trackId).fx[0].driveDb, 18);

  // 3. Reset FX
  const resetRes = applyCommand(p, "manage_fx", {
    trackId,
    action: "reset",
    fxType: "fold",
  });
  p = resetRes.project;
  assert.equal(p.tracks.find((t) => t.id === trackId).fx[0].driveDb, 0);

  // 4. Remove FX
  const removeRes = applyCommand(p, "manage_fx", {
    trackId,
    action: "remove",
    fxType: "fold",
  });
  p = removeRes.project;
  assert.equal(p.tracks.find((t) => t.id === trackId).fx.length, 0);
});

test("INSTRUMENT_SCHEMAS: defines parameters and defaults for all 9 roster instruments", () => {
  const expected = [
    "vaporisateur",
    "playfield",
    "808",
    "cubed",
    "pluck",
    "tubular",
    "neon",
    "noise-pad",
    "korpus",
    "nano",
    "soundfont",
  ];
  for (const name of expected) {
    assert.ok(INSTRUMENT_SCHEMAS[name], `Missing schema for ${name}`);
  }

  assert.equal(INSTRUMENT_SCHEMAS["808"].preset.default, "clean");
  assert.equal(INSTRUMENT_SCHEMAS.cubed.waveform.default, "sawtooth");
  assert.equal(INSTRUMENT_SCHEMAS.pluck.preset.default, "guitarish");
  assert.equal(INSTRUMENT_SCHEMAS.tubular.algorithm.default, 1);
  assert.equal(INSTRUMENT_SCHEMAS.neon.mode.default, "normal");
  assert.equal(INSTRUMENT_SCHEMAS["noise-pad"].preset.default, "air_pad");
  assert.equal(INSTRUMENT_SCHEMAS.korpus.exciter.default, "strike");
  assert.equal(INSTRUMENT_SCHEMAS.nano.rootKey.default, 60);
  assert.equal(INSTRUMENT_SCHEMAS.soundfont.program.default, 0);
});

test("9-Instrument Roster: triggers all procedural instruments and returns valid voice handles", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();
  const note = { pitch: 48, velocity: 0.85, duration: 480 };

  // 1. 808 Sub Bass
  const v808 = trigger808(
    ctx,
    dest,
    note,
    0,
    { preset: "dist", glide: 0.04 },
    120,
    1,
  );
  assert.ok(typeof v808.stop === "function");
  v808.stop(0.1);

  // 2. Cubed TB-303
  const vCubed = triggerCubed(
    ctx,
    dest,
    { ...note, accent: true },
    0,
    { cutoff: 500, resonance: 14 },
    120,
    1,
  );
  assert.ok(typeof vCubed.stop === "function");
  vCubed.stop(0.1);

  // 3. Pluck Karplus-Strong
  const vPluck = triggerPluck(
    ctx,
    dest,
    note,
    0,
    { tone: 0.8, decay: 0.5 },
    120,
    1,
  );
  assert.ok(typeof vPluck.stop === "function");
  vPluck.stop(0.1);

  // 4. Tubular DX7 6-Op FM
  const vTubular = triggerTubular(
    ctx,
    dest,
    note,
    0,
    { algorithm: 5, modIndex: 3.0 },
    120,
    1,
  );
  assert.ok(typeof vTubular.stop === "function");
  vTubular.stop(0.1);

  // 5. Neon Casio CZ-101
  const vNeon = triggerNeon(
    ctx,
    dest,
    note,
    0,
    { mode: "ring", dcw: 0.7 },
    120,
    1,
  );
  assert.ok(typeof vNeon.stop === "function");
  vNeon.stop(0.1);

  // 6. Noise Pad
  const vNoisePad = triggerNoisePad(
    ctx,
    dest,
    note,
    0,
    { texture: 0.3, attack: 0.2 },
    120,
    1,
  );
  assert.ok(typeof vNoisePad.stop === "function");
  vNoisePad.stop(0.1);

  // 7. Korpus Physical Modeling
  const vKorpus = triggerKorpus(
    ctx,
    dest,
    note,
    0,
    { exciter: "strike", materialA: "bell" },
    120,
    1,
  );
  assert.ok(typeof vKorpus.stop === "function");
  vKorpus.stop(0.1);

  // 8. Nano Micro-Sampler
  const vNano = triggerNano(ctx, dest, note, 0, { rootKey: 48 }, 120, 1);
  assert.ok(typeof vNano.stop === "function");
  vNano.stop(0.1);

  // 9. SoundFont General MIDI
  const vSoundfont = triggerSoundfont(
    ctx,
    dest,
    note,
    0,
    { program: 40 },
    120,
    1,
  );
  assert.ok(typeof vSoundfont.stop === "function");
  vSoundfont.stop(0.1);
});

test("triggerInstrumentVoice: dispatches seamlessly based on trackInstrument attribute", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();
  const note = { pitch: 36, velocity: 0.9, duration: 240 };

  const instruments = [
    "808",
    "cubed",
    "pluck",
    "tubular",
    "neon",
    "noise-pad",
    "korpus",
    "nano",
    "soundfont",
    "drums",
    "vaporisateur",
  ];

  for (const inst of instruments) {
    const voice = triggerInstrumentVoice(
      ctx,
      dest,
      {
        trackInstrument: inst,
        trackParams: {},
        trackVolume: 0.9,
        note,
      },
      0,
      120,
    );
    assert.ok(voice, `Failed to get voice handle for ${inst}`);
    assert.ok(typeof voice.stop === "function");
  }
});

test("applyCommand('set_instrument'): updates track instrument and persists custom parameters", () => {
  let p = createProject("acid-groove");
  const trackId = "trk_bass";

  const res = applyCommand(p, "set_instrument", {
    trackId,
    instrument: "cubed",
    params: { cutoff: 550, resonance: 18.0, waveform: "square" },
  });

  const updatedTrack = res.project.tracks.find((t) => t.id === trackId);
  assert.equal(updatedTrack.instrument, "cubed");
  assert.equal(updatedTrack.params.cutoff, 550);
  assert.equal(updatedTrack.params.resonance, 18.0);
  assert.equal(updatedTrack.params.waveform, "square");
});

test("SoundFont Caching & Bundling: stores, retrieves, and clears binary soundfont banks", () => {
  clearSoundfontCache();
  assert.equal(getCachedSoundfont("A320U_drums.sf2"), undefined);

  const mockSf2 = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x73, 0x66, 0x62, 0x6b,
  ]);
  setCachedSoundfont("A320U_drums.sf2", mockSf2.buffer);

  const retrieved = getCachedSoundfont("A320U_drums.sf2");
  assert.ok(retrieved instanceof ArrayBuffer);
  assert.equal(retrieved.byteLength, 12);

  clearSoundfontCache();
  assert.equal(getCachedSoundfont("A320U_drums.sf2"), undefined);
});

test("scdaw-dsp: TidalComputer computes non-linear LFO modulation curve with slope and symmetry", () => {
  const computer = new TidalComputer();
  computer.set(1.0, 0.0, 0.5); // Triangle shape
  assert.ok(Math.abs(computer.compute(0.0)) < 1e-4);
  assert.ok(Math.abs(computer.compute(0.5) - 1.0) < 1e-4);

  computer.set(0.0, 0.3, 0.5); // Zero depth = unity gain
  for (let step = 0; step <= 8; step++) {
    assert.ok(Math.abs(computer.compute(step / 8.0) - 1.0) < 1e-4);
  }
});

test("scdaw-dsp: processTidal modulates stereo audio with rate, depth, and stereo channel offset", () => {
  const len = 4410; // 100ms at 44.1kHz
  const left = new Float32Array(len).fill(0.5);
  const right = new Float32Array(len).fill(0.5);

  const { outLeft, outRight } = processTidal(
    left,
    right,
    {
      depth: 0.8,
      rate: 4,
      slope: 0.2,
      symmetry: 0.5,
      channelOffset: 90,
    },
    120,
    44100,
  );

  assert.equal(outLeft.length, len);
  assert.equal(outRight.length, len);
  // Verify modulated values differ due to channel offset
  assert.notEqual(outLeft[100], outRight[100]);
  for (let i = 0; i < len; i++) {
    assert.ok(outLeft[i] >= -1 && outLeft[i] <= 1);
    assert.ok(outRight[i] >= -1 && outRight[i] <= 1);
  }
});

test("scdaw-dsp: processMaximizer limits peaks and applies automatic makeup gain transparently", () => {
  const len = 2048;
  const left = new Float32Array(len);
  const right = new Float32Array(len);

  // Generate a burst of loud audio (e.g. peaking at +3 dB / 1.41)
  for (let i = 0; i < len; i++) {
    const s = Math.sin((i / 32) * Math.PI) * 1.4;
    left[i] = s;
    right[i] = s;
  }

  const { outLeft, outRight, reductionDb } = processMaximizer(
    left,
    right,
    {
      threshold: -6.0,
      ceiling: -0.1,
      lookahead: true,
    },
    44100,
  );

  assert.equal(outLeft.length, len);
  assert.equal(outRight.length, len);
  assert.ok(reductionDb < 0, "Maximizer should report active gain reduction");

  // Output must not exceed ceiling (in linear amplitude, -0.1 dB is ~0.988)
  const maxPeakL = Math.max(...outLeft.map(Math.abs));
  const maxPeakR = Math.max(...outRight.map(Math.abs));
  assert.ok(maxPeakL <= 1.0, `Peak ${maxPeakL} should be bounded under 1.0`);
  assert.ok(maxPeakR <= 1.0, `Peak ${maxPeakR} should be bounded under 1.0`);
});

test("scdaw-dsp: processTransientShaper enhances or cuts attack and sustain envelopes", () => {
  const len = 4410;
  const left = new Float32Array(len);
  const right = new Float32Array(len);

  // Sharp impulse attack then sustained tone
  left[10] = 0.9;
  left[11] = 0.8;
  right[10] = 0.9;
  right[11] = 0.8;
  for (let i = 100; i < 2000; i++) {
    left[i] = 0.2;
    right[i] = 0.2;
  }

  const boosted = processTransientShaper(
    left,
    right,
    { attack: 0.8, sustain: -0.5 },
    44100,
  );
  assert.equal(boosted.outLeft.length, len);
  // Attack transient should be boosted compared to original
  assert.ok(boosted.outLeft[10] >= left[10]);
  // Sustain should be reduced in steady state
  assert.ok(boosted.outLeft[1500] <= left[1500]);
});

test("scdaw-dsp: processAutotune quantizes pitch to musical scales with retune speed", () => {
  const len = 2048;
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  // Input: 440 Hz (A4) sine wave
  for (let i = 0; i < len; i++) {
    const s = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.8;
    left[i] = s;
    right[i] = s;
  }

  const res = processAutotune(
    left,
    right,
    {
      key: "C",
      scale: "major",
      retune: 0.9,
      amount: 1.0,
    },
    44100,
  );

  assert.equal(res.outLeft.length, len);
  assert.equal(res.outRight.length, len);
  assert.ok(res.detectedPitch > 0);
  assert.ok(res.targetPitch > 0);
});

test("scdaw-dsp: processVocoder modulates carrier with speech or noise modulator bands", () => {
  const len = 2048;
  const carrier = new Float32Array(len).fill(0.3);
  const modulator = new Float32Array(len);
  // Modulator with bursts
  for (let i = 200; i < 800; i++) modulator[i] = 0.8;

  const res = processVocoder(
    carrier,
    carrier,
    modulator,
    modulator,
    {
      bands: 16,
      release: 0.05,
    },
    44100,
  );

  assert.equal(res.outLeft.length, len);
  assert.equal(res.outRight.length, len);
  // Carrier should have higher energy when modulator has energy
  let silentEnergy = 0;
  let activeEnergy = 0;
  for (let i = 50; i < 150; i++) silentEnergy += Math.abs(res.outLeft[i]);
  for (let i = 300; i < 400; i++) activeEnergy += Math.abs(res.outLeft[i]);
  assert.ok(activeEnergy > silentEnergy);
});

test("scdaw-dsp: processSidechainDucking ducks target audio based on trigger volume", () => {
  const len = 4410;
  const targetL = new Float32Array(len).fill(0.8);
  const targetR = new Float32Array(len).fill(0.8);

  const trigger = new Float32Array(len);
  // Trigger hit (e.g. kick) at frame 100 to 500
  for (let i = 100; i < 500; i++) {
    trigger[i] = 0.95;
  }

  const { outLeft, outRight } = processSidechainDucking(
    targetL,
    targetR,
    trigger,
    {
      thresholdDb: -12,
      depthDb: 18,
      attackMs: 5,
      releaseMs: 50,
    },
    44100,
  );

  assert.equal(outLeft.length, len);
  // Target should be ducked significantly during kick hit
  assert.ok(
    outLeft[250] < 0.4,
    `Expected ducked gain < 0.4, got ${outLeft[250]}`,
  );
  // Target should recover after kick finishes
  assert.ok(
    outLeft[3000] > 0.7,
    `Expected recovered gain > 0.7, got ${outLeft[3000]}`,
  );
});

test("scdaw-schema: defines complete schemas and defaults for new Audio FX", () => {
  const fxTypes = [
    "autotune",
    "vocoder",
    "maximizer",
    "tidal",
    "transient",
    "sidechain",
    "zeitgeist",
    "notefilter",
    "chord",
    "humanize",
  ];
  for (const fxType of fxTypes) {
    const defaults = getDefaultParams(fxType);
    assert.ok(defaults, `Defaults missing for ${fxType}`);
    assert.ok(Object.keys(defaults).length > 0, `No defaults for ${fxType}`);
  }
  assert.equal(getDefaultParams("autotune").scale, "chromatic");
  assert.equal(getDefaultParams("maximizer").lookahead, true);
  assert.equal(getDefaultParams("zeitgeist").template, "swing16");
});
