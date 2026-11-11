import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSf2,
  simplifySoundfont,
  SoundfontVoice,
  Adsr,
  Smooth,
  GM_INSTRUMENTS,
  GM_DRUM_MAP,
  resolveGmProgram,
  findRegionForNote,
  renderSoundfontVoice,
} from "../.agents/scripts/scdaw-soundfont.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DRUMS_SF2 = resolve(
  ROOT,
  "pages/resources/assets/soundfonts/A320U_drums.sf2",
);

test("WP3.1: parseSf2 parses RIFF sfbk headers, samples, and presets", () => {
  assert.ok(existsSync(DRUMS_SF2), "A320U_drums.sf2 must exist");
  const buffer = readFileSync(DRUMS_SF2).buffer;

  const sf2 = parseSf2(buffer);
  assert.ok(sf2, "Must return parsed SF2 object");
  assert.ok(Array.isArray(sf2.samples), "sf2.samples must be an array");
  assert.ok(sf2.samples.length > 0, "Must have parsed samples");
  assert.ok(Array.isArray(sf2.presets), "sf2.presets must be an array");
  assert.ok(sf2.presets.length > 0, "Must have parsed presets");

  // Check sample structure
  const firstSample = sf2.samples[0];
  assert.ok(
    firstSample.data instanceof Int16Array,
    "Sample data must be Int16Array",
  );
  assert.equal(typeof firstSample.header.sampleRate, "number");
  assert.ok(firstSample.header.sampleRate >= 8000);

  // Check preset structure
  const drumPreset = sf2.presets[0];
  assert.equal(typeof drumPreset.name, "string");
  assert.equal(drumPreset.bank, 128, "Drums should be Bank 128");
  assert.ok(Array.isArray(drumPreset.zones), "Preset must have zones");
});

test("WP3.1: simplifySoundfont flattens zones with openDAW generator resolution", () => {
  // Synthetic SF2 matching openDAW test fixture
  const sample = {
    data: Int16Array.from([0, 16384, -16384, 32767, -32768, 0, 100, 200]),
    header: {
      sampleRate: 44100,
      startLoop: 10,
      endLoop: 90,
      originalPitch: 48,
    },
  };

  const synthetic = {
    samples: [sample],
    presets: [
      {
        name: "TestSynth",
        preset: 0,
        bank: 0,
        zones: [
          {
            generators: {
              43: { range: { lo: 36, hi: 72 } },
              44: { range: { lo: 0, hi: 127 } },
              17: { value: 250 },
            },
            instrument: {
              name: "TestInst",
              zones: [
                {
                  generators: {
                    43: { range: { lo: 48, hi: 84 } }, // intersection: 48..72
                    34: { value: 1200 }, // attack 1200 timecents -> 2^(1200/1200) = 2.0s
                    37: { value: 100 }, // sustain 100 -> 1 - 100/1000 = 0.9
                    54: { value: 1 }, // sampleModes 1 -> loop
                    58: { value: 50 }, // overriding root key 50
                    17: { value: 500 }, // pan 500 overrides preset 250 -> 500/1000 = 0.5
                  },
                  sample,
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const simple = simplifySoundfont(synthetic);
  assert.ok(simple);
  assert.equal(simple.samples.length, 1);
  assert.equal(simple.presets.length, 1);

  const region = simple.presets[0][0];
  assert.ok(region, "Must produce flattened region");
  assert.equal(region.keyLo, 48, "Intersection keyLo must be 48");
  assert.equal(region.keyHi, 72, "Intersection keyHi must be 72");
  assert.equal(region.rootKey, 50, "OverridingRootKey must be 50");
  assert.equal(region.loopMode, 1, "SampleMode 1 must be loopMode 1");
  assert.ok(Math.abs(region.pan - 0.5) < 1e-4, "Pan must be 0.5");
  assert.ok(Math.abs(region.attack - 2.0) < 1e-4, "Attack must be 2.0 seconds");
  assert.ok(Math.abs(region.sustain - 0.9) < 1e-4, "Sustain must be 0.9");

  // Sample PCM normalized to Float32Array [-1.0, 1.0]
  const pcm = simple.samples[0].pcm;
  assert.ok(pcm instanceof Float32Array);
  assert.ok(Math.abs(pcm[1] - 16384 / 32768) < 1e-4);
  assert.ok(Math.abs(pcm[3] - 32767 / 32768) < 1e-4);
  assert.ok(Math.abs(pcm[4] - -32768 / 32768) < 1e-4);
});

test("WP3.1: Adsr and Smooth state machines behave accurately", () => {
  const sampleRate = 1000; // 1kHz for easy sample counting
  const adsr = new Adsr(sampleRate);
  adsr.set(0.01, 0.02, 0.5, 0.02); // 10 samples attack, 20 samples decay, 0.5 sustain, 20 samples release
  adsr.gateOn();

  // Attack phase
  let maxAttack = 0;
  for (let i = 0; i < 15; i++) {
    const val = adsr.next();
    if (val > maxAttack) maxAttack = val;
  }
  assert.equal(maxAttack, 1.0, "Attack must reach 1.0");

  // Decay to sustain
  for (let i = 0; i < 30; i++) {
    adsr.next();
  }
  assert.ok(
    Math.abs(adsr.next() - 0.5) < 0.05,
    "Must reach sustain level ~0.5",
  );

  // Release
  adsr.gateOff();
  for (let i = 0; i < 30; i++) {
    adsr.next();
  }
  assert.equal(adsr.complete(), true, "ADSR must complete after release");

  // Smooth
  const smooth = new Smooth(0.003, sampleRate);
  let val = 0;
  for (let i = 0; i < 20; i++) {
    val = smooth.process(1.0);
  }
  assert.ok(val > 0.9, "Smooth must converge toward target 1.0");
});

test("WP3.1: SoundfontVoice renders non-empty audio with pitch ratio and pan", () => {
  const sampleRate = 44100;
  const pcm = new Float32Array(4410);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }

  const sample = {
    pcm,
    sampleRate: 44100,
    loopStart: 100,
    loopEnd: 4000,
  };

  const region = {
    keyLo: 0,
    keyHi: 127,
    velLo: 0,
    velHi: 127,
    sampleIndex: 0,
    rootKey: 69, // A4 (440 Hz)
    loopMode: 1,
    pan: 0.0, // Center
    attack: 0.005,
    decay: 0.05,
    sustain: 0.8,
    release: 0.05,
  };

  const outLeft = new Float32Array(512);
  const outRight = new Float32Array(512);

  const voice = new SoundfontVoice();
  voice.start(1, 69, 0, 0.9, region, sample, sampleRate);

  const finished = voice.process(outLeft, outRight, sample.pcm);
  assert.equal(finished, false, "Voice should not finish immediately");

  // Verify non-zero output rendered
  let sumLeft = 0;
  let sumRight = 0;
  for (let i = 0; i < 512; i++) {
    sumLeft += Math.abs(outLeft[i]);
    sumRight += Math.abs(outRight[i]);
  }
  assert.ok(sumLeft > 0.01, "Left channel must have signal");
  assert.ok(sumRight > 0.01, "Right channel must have signal");
  assert.ok(
    Math.abs(sumLeft - sumRight) < 0.1,
    "Center panned signal should be balanced",
  );
});

test("WP3.1: GM program mapping maps instrument names to MIDI programs", () => {
  assert.equal(resolveGmProgram("acoustic-grand"), 0);
  assert.equal(resolveGmProgram("electric-bass"), 33);
  assert.equal(resolveGmProgram("electric-bass-finger"), 33);
  assert.equal(resolveGmProgram("distortion-guitar"), 30);
  assert.equal(resolveGmProgram("overdriven-guitar"), 29);
  assert.equal(resolveGmProgram("drawbar-organ"), 16);

  // Drums
  assert.equal(GM_DRUM_MAP[36], "Bass Drum 1");
  assert.equal(GM_DRUM_MAP[38], "Acoustic Snare");
  assert.equal(GM_DRUM_MAP[42], "Closed Hi-Hat");
  assert.equal(GM_DRUM_MAP[46], "Open Hi-Hat");
  assert.equal(GM_DRUM_MAP[49], "Crash Cymbal 1");
});

test("WP3.2: triggerDrumSoundfont triggers real drum sample in Web Audio graph", async () => {
  const { FakeAudioContext } = await import("./helpers/fake-audio-context.mjs");
  const { triggerDrumSoundfont } =
    await import("../.agents/scripts/scdaw-soundfont.js");

  const ctx = new FakeAudioContext();
  const dest = ctx.destination;
  const note = { pitch: 36, velocity: 0.95 }; // Kick drum

  const voice = triggerDrumSoundfont(ctx, dest, note, 0, 1.0, 0.0);
  assert.ok(voice, "Must return voice handle when drum soundfont is loaded");
  assert.equal(typeof voice.stop, "function");
  assert.equal(typeof voice.disconnect, "function");
});

test("WP3.2: triggerSoundfontNote triggers GM instrument note with ADSR and pan", async () => {
  const { FakeAudioContext } = await import("./helpers/fake-audio-context.mjs");
  const { triggerSoundfontNote } =
    await import("../.agents/scripts/scdaw-soundfont.js");

  const ctx = new FakeAudioContext();
  const dest = ctx.destination;
  const note = { pitch: 40, velocity: 0.85, duration: 480 }; // E2 bass note
  const params = { instrument: "electric-bass" };

  const voice = triggerSoundfontNote(ctx, dest, note, 0, params, 122, 1.0);
  assert.ok(voice, "Must return voice handle for GM soundfont instrument");
  assert.equal(typeof voice.stop, "function");
  assert.equal(typeof voice.disconnect, "function");
});

test("WP3.3: triggerSoundfontNote resolves GM preset by MIDI program (not array index) in gm-lofi.sf2", async () => {
  const { FakeAudioContext } = await import("./helpers/fake-audio-context.mjs");
  const { registerSoundfont, triggerSoundfontNote } =
    await import("../.agents/scripts/scdaw-soundfont.js");

  const gmPath = resolve(ROOT, "pages/resources/assets/soundfonts/gm-lofi.sf2");
  assert.ok(existsSync(gmPath), "gm-lofi.sf2 must exist");
  const parsed = parseSf2(readFileSync(gmPath).buffer);
  const simple = simplifySoundfont(parsed);
  registerSoundfont("gm", simple);

  // Verify presetsMeta / findPresetIndex resolves bank 0 MIDI programs accurately
  const expected = [
    { program: 27, expectedName: "Clean Gt." },
    { program: 29, expectedName: "Overdrive Gt" },
    { program: 33, expectedName: "Fingered Bs." },
  ];
  for (const { program, expectedName } of expected) {
    const idx = simple.programMap?.[`0:${program}`];
    assert.ok(
      typeof idx === "number",
      `simplifySoundfont must map bank 0 program ${program}`,
    );
    assert.equal(
      parsed.presets[idx]?.name,
      expectedName,
      `MIDI program ${program} must map to ${expectedName}, not presets[${program}] (${parsed.presets[program]?.name})`,
    );
  }

  // Trigger Clean Guitar (prog 27, 22050Hz sample, rootKey 48) on a 48kHz AudioContext
  const ctx = new FakeAudioContext();
  ctx.sampleRate = 48000;
  const voice = triggerSoundfontNote(
    ctx,
    ctx.destination,
    { pitch: 48, velocity: 0.9, duration: 960 },
    0,
    { instrument: "electric-guitar-clean" },
    120,
    1.0,
  );
  assert.ok(voice, "Must trigger Clean Guitar voice");
  const src = ctx.bufferSources[ctx.bufferSources.length - 1];
  assert.equal(src.buffer.sampleRate, 22050, "Buffer preserves SF2 sampleRate");
  assert.ok(
    Math.abs(src.playbackRate.value - 1.0) < 0.02,
    `Expected ~1.0 playbackRate at rootKey on 48kHz AudioContext, got ${src.playbackRate.value}`,
  );
  assert.equal(
    src.loop,
    true,
    "Clean Gt. sampleModes=1 must enable sustain loop",
  );
  assert.ok(
    src.loopStart > 0 && src.loopEnd > src.loopStart,
    `Expected valid sample loop points in seconds, got loopStart=${src.loopStart}, loopEnd=${src.loopEnd}`,
  );

  // Envelope events must be monotonically non-decreasing in time and never snap to 0 at note-off during long decay
  const gainNode = src.outputs[0];
  assert.ok(gainNode?.gain?.events, "Source must connect to GainNode");
  const events = gainNode.gain.events;
  for (let i = 1; i < events.length; i++) {
    assert.ok(
      events[i].time >= events[i - 1].time,
      `Gain Automation events must be monotonic: ${JSON.stringify(events)}`,
    );
  }
  const releaseStartEvent = events.find((e) => Math.abs(e.time - 0.5) < 0.01);
  assert.ok(
    releaseStartEvent,
    "Must schedule releaseStart event at note-off (0.5s)",
  );
  assert.ok(
    releaseStartEvent.val > 0.5,
    `Release start amplitude should not snap to 0 during 20s decay, got ${releaseStartEvent.val}`,
  );
});

test("WP3.3: triggerDrumSoundfont plays at 1.0 playbackRate even when ctx.sampleRate is 48000", async () => {
  const { FakeAudioContext } = await import("./helpers/fake-audio-context.mjs");
  const { triggerDrumSoundfont } =
    await import("../.agents/scripts/scdaw-soundfont.js");

  const ctx = new FakeAudioContext();
  ctx.sampleRate = 48000;
  triggerDrumSoundfont(
    ctx,
    ctx.destination,
    { pitch: 36, velocity: 0.9 },
    0,
    1.0,
    0.0,
  );
  const src = ctx.bufferSources[ctx.bufferSources.length - 1];
  assert.equal(
    src.playbackRate.value,
    1.0,
    `Drums must play at 1.0 playbackRate regardless of ctx.sampleRate, got ${src.playbackRate.value}`,
  );
});
