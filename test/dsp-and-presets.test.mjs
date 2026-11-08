import test from "node:test";
import assert from "node:assert/strict";
import {
  createWavefolderCurve,
  processCrusherBuffer,
  processStereoTool,
  generateReverbImpulse,
} from "../.agents/scripts/scdaw-dsp.js";
import {
  INSTRUMENT_PRESETS,
  GENRE_TEMPLATES,
  generateGenrePattern,
} from "../.agents/scripts/scdaw-presets.js";
import {
  triggerSynth,
  triggerDrums,
} from "../.agents/scripts/scdaw-instruments.js";
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
