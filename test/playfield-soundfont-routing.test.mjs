import test from "node:test";
import assert from "node:assert/strict";
import { FakeAudioContext } from "./helpers/fake-audio-context.mjs";
import {
  triggerDrums,
  triggerInstrumentVoice,
} from "../.agents/scripts/scdaw-instruments.js";
import { triggerDrumSoundfont } from "../.agents/scripts/scdaw-soundfont.js";

test("Playfield: default drum triggering preserves procedural 808/909 synth", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  // Triggering kick drum on Playfield (12-Drum kit)
  const voice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "drums",
      trackInstrument: "playfield",
      trackParams: {},
      trackVolume: 1.0,
      trackPan: 0.0,
      note: { pitch: 36, velocity: 0.9 },
    },
    0,
  );

  assert.ok(voice, "Voice must be created");
  // Procedural kick uses FakeOscillatorNode (sine drop)
  assert.ok(
    ctx.oscillators.length > 0,
    "Playfield kick must use procedural oscillator synthesis",
  );
});

test("SoundFont Drums: explicit soundfont instrument routes to sampled drum kit", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  // Triggering kick drum on SoundFont drum kit
  const voice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "drums",
      trackInstrument: "soundfont",
      trackParams: { kit: "rock-kit" },
      trackVolume: 1.0,
      trackPan: 0.0,
      note: { pitch: 36, velocity: 0.9 },
    },
    0,
  );

  assert.ok(voice, "Voice must be created");
  assert.equal(
    typeof voice.stop,
    "function",
    "Must return voice handle with stop()",
  );
});

test("SoundFont Drums: triggerDrumSoundfont plays at natural 1:1 speed without detune", () => {
  const ctx = new FakeAudioContext();
  ctx.sampleRate = 44100;
  const dest = ctx.createGain();

  // Kick (pitch 36) has originalPitch = 45 in A320U_drums.sf2.
  // It MUST play at 1:1 natural speed (~1.0), NOT pitched down by -9 semitones (~0.59).
  triggerDrumSoundfont(ctx, dest, { pitch: 36, velocity: 0.9 }, 0, 1.0, 0.0);

  // In FakeAudioContext, buffer source nodes are tracked or we can inspect playbackRate
  assert.ok(
    ctx.bufferSources && ctx.bufferSources.length > 0,
    "Buffer source must be created",
  );
  const lastSource = ctx.bufferSources[ctx.bufferSources.length - 1];
  const rate = lastSource.playbackRate.value;
  assert.ok(
    Math.abs(rate - 1.0) < 0.1,
    `Kick playbackRate must be ~1.0, but got ${rate} (was detuned by rootKey)`,
  );

  // Snare (pitch 38)
  triggerDrumSoundfont(ctx, dest, { pitch: 38, velocity: 0.9 }, 0, 1.0, 0.0);
  const snareSource = ctx.bufferSources[ctx.bufferSources.length - 1];
  const snareRate = snareSource.playbackRate.value;
  assert.ok(
    Math.abs(snareRate - 1.0) < 0.1,
    `Snare playbackRate must be ~1.0, but got ${snareRate} (was detuned by rootKey)`,
  );
});
