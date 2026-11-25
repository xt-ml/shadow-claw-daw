import test from "node:test";
import assert from "node:assert/strict";
import { FakeAudioContext } from "./helpers/fake-audio-context.mjs";
import {
  createProject,
  applyCommand,
} from "../.agents/scripts/shadow-claw-daw.js";
import { DawEngine } from "../.agents/scripts/shadow-claw-daw-engine.js";
import { triggerInstrumentVoice } from "../.agents/scripts/shadow-claw-daw-instruments.js";

function createTestEngine() {
  const fakeCtx = new FakeAudioContext();
  const p0 = createProject("empty");
  const addRes = applyCommand(p0, "add_track", {
    kind: "synth",
    name: "Lead",
  });
  const engine = new DawEngine({
    audioContext: fakeCtx,
    project: addRes.project,
  });
  return { engine, fakeCtx, trackId: addRes.result.trackId };
}

test("triggerInstrumentVoice: gate=true returns handle with release() and setPitchBend()", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.destination;
  const handle = triggerInstrumentVoice(
    ctx,
    dest,
    {
      instrument: "synth",
      note: { pitch: 60, velocity: 0.8, duration: 480 },
      params: {
        waveform: "sawtooth",
        attack: 0.01,
        decay: 0.1,
        sustain: 0.5,
        release: 0.2,
      },
      trackVolume: 0.8,
      gate: true,
    },
    0.1,
    120,
  );

  assert.ok(handle, "Expected voice handle");
  assert.equal(typeof handle.release, "function", "Expected handle.release");
  assert.equal(
    typeof handle.setPitchBend,
    "function",
    "Expected handle.setPitchBend",
  );
  // Should not throw when called
  handle.setPitchBend(1.5);
  handle.release(0.5);
});

test("DawEngine: liveNoteOn/liveNoteOff manages _liveVoices and _activeVoices", () => {
  const { engine, trackId } = createTestEngine();

  engine.liveNoteOn(trackId, 60, 0.85);
  assert.equal(engine._liveVoices.has(`${trackId}:60`), true);
  assert.equal(engine._activeVoices.size, 1);
  assert.ok(engine.activeLivePitches.get().includes(60));

  engine.liveNoteOff(trackId, 60);
  assert.equal(engine._liveVoices.has(`${trackId}:60`), false);
  assert.equal(engine.activeLivePitches.get().includes(60), false);
});

test("DawEngine: setSustainPedal holds released notes until pedal up", () => {
  const { engine, trackId } = createTestEngine();

  engine.setSustainPedal(trackId, true);
  engine.liveNoteOn(trackId, 64, 0.8);
  assert.equal(engine._liveVoices.has(`${trackId}:64`), true);

  // Release key while sustain pedal is held
  engine.liveNoteOff(trackId, 64);
  assert.equal(
    engine._liveVoices.has(`${trackId}:64`),
    true,
    "Voice should remain held while sustain pedal is down",
  );
  assert.equal(engine._sustainedNotes.get(trackId)?.has(64), true);

  // Release sustain pedal -> releases sustained notes
  engine.setSustainPedal(trackId, false);
  assert.equal(
    engine._liveVoices.has(`${trackId}:64`),
    false,
    "Voice should be released when sustain pedal lifts",
  );
  assert.equal(engine._sustainedNotes.get(trackId)?.size ?? 0, 0);
});

test("DawEngine: setPitchBend updates track bend and active live voices", () => {
  const { engine, trackId } = createTestEngine();

  engine.liveNoteOn(trackId, 67, 0.8);
  engine.setPitchBend(trackId, 0.5); // +1 semitone when range=2
  assert.equal(engine._pitchBendByTrack.get(trackId), 1);

  engine.panic();
  assert.equal(engine._liveVoices.size, 0);
  assert.equal(engine._activeVoices.size, 0);
  assert.equal(engine._pitchBendByTrack.size, 0);
});

test("DawEngine: commitCapturedMidi commits captured buffer into track.notes with undo", async () => {
  const { engine, trackId } = createTestEngine();

  engine.liveNoteOn(trackId, 60, 0.8);
  engine.liveNoteOff(trackId, 60);
  engine.liveNoteOn(trackId, 64, 0.9);
  engine.liveNoteOff(trackId, 64);

  const res = await engine.commitCapturedMidi(trackId);
  assert.equal(res.addedCount, 2);

  const trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.equal(trk.notes.length, 2);
  assert.equal(trk.notes[0].pitch, 60);
  assert.equal(trk.notes[1].pitch, 64);

  // Undo should remove committed notes
  await engine.sendCommand("undo");
  const trkAfterUndo = engine.project
    .get()
    .tracks.find((t) => t.id === trackId);
  assert.equal(trkAfterUndo.notes.length, 0);
});

test("DawEngine: stopped capture respects seek() between note groups (beat 1 vs beat 2)", async () => {
  const { engine, trackId } = createTestEngine();

  engine.seek(0);
  engine.liveNoteOn(trackId, 60, 0.8);
  engine.liveNoteOff(trackId, 60);

  engine.seek(960); // beat 2
  engine.liveNoteOn(trackId, 95, 0.85); // B6
  engine.liveNoteOff(trackId, 95);

  const res = await engine.commitCapturedMidi(trackId);
  assert.equal(res.addedCount, 2);
  const trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.equal(trk.notes[0].position, 0);
  assert.equal(trk.notes[1].position, 960);
  assert.equal(trk.notes[1].pitch, 95);
});

test("DawEngine: getExactPlayheadPpqn interpolates audio clock and compensates outputLatency", () => {
  const { engine, fakeCtx } = createTestEngine();
  engine.state.set({ ...engine.state.get(), playing: true, positionPpqn: 0 });
  engine._anchorPpqn = 0;
  engine._anchorAudioTime = 1.0;
  fakeCtx.currentTime = 1.5; // 0.5s elapsed at 120 BPM = 960 PPQN (1 beat)
  fakeCtx.outputLatency = 0.05; // 50ms = 96 PPQN at 120 BPM
  fakeCtx.baseLatency = 0.0;

  assert.equal(
    engine.getExactPlayheadPpqn({ compensateOutputLatency: false }),
    960,
  );
  assert.equal(
    engine.getExactPlayheadPpqn({ compensateOutputLatency: true }),
    864,
  );
});

test("triggerInstrumentVoice: gate=true release uses cancelAndHoldAtTime and ramps to 0 cleanly", async () => {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(
    ".agents/scripts/shadow-claw-daw-instruments.js",
    "utf8",
  );
  assert.match(src, /cancelAndHoldAtTime/);
  assert.match(src, /linearRampToValueAtTime\(\s*0\s*,/);
});

test("DawEngine: startRecording and stopRecording captures MIDI notes on armed synth track", async () => {
  const { engine, trackId } = createTestEngine();
  engine.sendCommand("set_track_record_arm", { trackId, armed: true });

  await engine.startRecording();
  assert.equal(engine.state.get().recording, true);

  engine.liveNoteOn(trackId, 72, 0.75);
  engine.liveNoteOff(trackId, 72);

  await engine.stopRecording();
  assert.equal(engine.state.get().recording, false);

  const trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.ok(
    trk.notes.length >= 1,
    "Recorded MIDI note should be added to track",
  );
  assert.equal(trk.notes[0].pitch, 72);
});
