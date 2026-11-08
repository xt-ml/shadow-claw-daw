import test from "node:test";
import assert from "node:assert/strict";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";
import { triggerInstrumentVoice } from "../.agents/scripts/scdaw-instruments.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";

test("Instruments: triggers drum synth voices with parameter automation", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  // Test kick
  const kickVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "drums",
      note: { pitch: 36, velocity: 0.9, duration: 240 },
    },
    0.1,
    120,
  );
  assert.ok(kickVoice, "kick voice should be created");

  // Test snare
  const snareVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "drums",
      note: { pitch: 38, velocity: 0.8, duration: 240 },
    },
    0.2,
    120,
  );
  assert.ok(snareVoice, "snare voice should be created");

  // Test hat
  const hatVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "drums",
      note: { pitch: 42, velocity: 0.7, duration: 240 },
    },
    0.3,
    120,
  );
  assert.ok(hatVoice, "hat voice should be created");
});

test("Instruments: triggers synth voice with ADSR and filter", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  const synthVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "synth",
      trackParams: {
        waveform: "sawtooth",
        cutoff: 1200,
        resonance: 4,
        attack: 0.02,
        decay: 0.2,
        sustain: 0.5,
        release: 0.1,
      },
      note: { pitch: 60, velocity: 0.85, duration: 480 },
    },
    0.5,
    120,
  );

  assert.ok(synthVoice, "synth voice should be created");
});

test("DawEngine: initializes, controls transport, and mutates via commands", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  const state = engine.getState();
  assert.equal(state.playing, false);
  assert.equal(state.trackCount, 2); // default basic-beat has drums + bass

  // Play
  await engine.play();
  assert.equal(engine.getState().playing, true);

  // Stop
  await engine.stop();
  assert.equal(engine.getState().playing, false);

  // Send command: add track
  const addRes = await engine.sendCommand("add_track", {
    kind: "synth",
    name: "Lead",
  });
  assert.ok(addRes.trackId);
  assert.equal(engine.getState().trackCount, 3);

  // Undo command
  const undoRes = await engine.sendCommand("undo");
  assert.ok(undoRes.ok);
  assert.equal(engine.getState().trackCount, 2);

  // Bounce
  const bounceRes = await engine.bounce({ loops: 1, saveToWorkspace: true });
  assert.ok(bounceRes);
  assert.ok(bounceRes.bytes > 0);
  assert.equal(bounceRes.channels, 2);
  assert.ok(engine.getState().lastBounce);
});
