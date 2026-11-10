import test from "node:test";
import assert from "node:assert/strict";
import { FakeAudioContext } from "./helpers/fake-audio-context.mjs";
import {
  createProject,
  applyCommand,
  encodeWav,
} from "../.agents/scripts/scdaw.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";
import {
  AudioRecorder,
  computeWaveformPeaks,
} from "../.agents/scripts/scdaw-recorder.js";

test("AudioRecorder: tracks recording lifecycle, gathers PCM, and encodes WAV", async () => {
  const fakeCtx = new FakeAudioContext();
  const recorder = new AudioRecorder({ audioContext: fakeCtx });

  assert.equal(recorder.isRecording(), false);

  // Mock a MediaStream
  const mockTrack = {
    stopCalled: false,
    stop() {
      this.stopCalled = true;
    },
  };
  const mockStream = {
    getAudioTracks: () => [mockTrack],
  };

  await recorder.start(mockStream);
  assert.equal(recorder.isRecording(), true);

  // Feeding simulated PCM frame chunks
  const chunk1 = new Float32Array([0.1, 0.2, -0.3, 0.4]);
  recorder.recordChunk(chunk1);

  const result = await recorder.stop();
  assert.equal(recorder.isRecording(), false);
  assert.equal(mockTrack.stopCalled, true);
  assert.ok(result.buffer instanceof ArrayBuffer);
  assert.ok(result.durationSec >= 0);
  assert.equal(typeof result.sampleRate, "number");
});

test("computeWaveformPeaks: generates normalized peak arrays for waveform rendering", () => {
  const pcm = new Float32Array([
    0.0, 0.5, -0.8, 0.2, -0.1, 0.9, -0.4, 0.0, 0.3, -0.2, 0.7, -0.9, 0.1, -0.3,
    0.6, -0.5,
  ]);
  const peaks = computeWaveformPeaks(pcm, 4);
  assert.equal(peaks.length, 4);
  for (const peak of peaks) {
    assert.ok(
      peak >= 0 && peak <= 1,
      `Peak ${peak} must be normalized between 0 and 1`,
    );
  }
});

test("applyCommand: set_track_record_arm toggles track armed state", () => {
  const p0 = createProject({ title: "Arm Test" });
  // Add an audio track
  const res1 = applyCommand(p0, "add_track", {
    kind: "audio",
    name: "Vocals",
  });
  const trackId = res1.result.trackId;

  // Arm the track
  const res2 = applyCommand(res1.project, "set_track_record_arm", {
    trackId,
    armed: true,
  });
  const trkArmed = res2.project.tracks.find((t) => t.id === trackId);
  assert.equal(trkArmed.recordArm, true);

  // Disarm the track
  const res3 = applyCommand(res2.project, "set_track_record_arm", {
    trackId,
    armed: false,
  });
  const trkDisarmed = res3.project.tracks.find((t) => t.id === trackId);
  assert.equal(trkDisarmed.recordArm, false);
});

test("applyCommand: set_metronome configures metronome enabled and volume", () => {
  const p0 = createProject({ title: "Metronome Test" });
  assert.equal(p0.metronome?.enabled, false);

  const res1 = applyCommand(p0, "set_metronome", {
    enabled: true,
    volume: 0.75,
  });
  assert.equal(res1.project.metronome.enabled, true);
  assert.equal(res1.project.metronome.volume, 0.75);

  const res2 = applyCommand(res1.project, "set_metronome", {
    enabled: false,
  });
  assert.equal(res2.project.metronome.enabled, false);
  assert.equal(res2.project.metronome.volume, 0.75); // preserves volume
});

test("DawEngine: loadSample caches decoded buffer and metadata", async () => {
  const fakeCtx = new FakeAudioContext();
  const p = createProject({ title: "Load Sample Test" });
  const engine = new DawEngine(p, { audioContext: fakeCtx });

  // Create simple 16-bit WAV PCM buffer
  const pcmLeft = new Float32Array([0.1, 0.2, -0.2, -0.1]);
  const pcmRight = new Float32Array([0.1, 0.2, -0.2, -0.1]);
  const wavBuf = encodeWav([pcmLeft, pcmRight], 44100, { bitDepth: 16 });

  const info = await engine.loadSample("sample_test_1", wavBuf);
  assert.equal(info.name, "sample_test_1");
  assert.ok(info.durationSec > 0);
  assert.ok(engine.hasSample("sample_test_1"));
});

test("DawEngine: importAudioFile decodes audio and inserts audioClip on track", async () => {
  const fakeCtx = new FakeAudioContext();
  const p0 = createProject({ title: "Import Audio Test" });
  const res1 = applyCommand(p0, "add_track", { kind: "audio", name: "Voice" });
  const trackId = res1.result.trackId;

  const engine = new DawEngine({
    audioContext: fakeCtx,
    project: res1.project,
  });

  const pcmLeft = new Float32Array(44100 * 2); // 2 seconds
  const wavBuf = encodeWav([pcmLeft], 44100, { bitDepth: 16 });

  const clipResult = await engine.importAudioFile(trackId, wavBuf, {
    name: "Voice Take 1.wav",
    time: 0,
  });

  assert.ok(clipResult.ok);
  assert.equal(clipResult.trackId, trackId);
  const track = engine.getProject().tracks.find((t) => t.id === trackId);
  assert.equal(track.audioClips.length, 1);
  assert.equal(track.audioClips[0].name, "Voice Take 1.wav");
  assert.ok(track.audioClips[0].duration > 0);
});

test("DawEngine: startRecording and stopRecording captures audio and adds clip", async () => {
  const fakeCtx = new FakeAudioContext();
  const p0 = createProject({ title: "Recording Workflow Test" });
  const res1 = applyCommand(p0, "add_track", { kind: "audio", name: "Mic In" });
  const trackId = res1.result.trackId;

  const engine = new DawEngine({
    audioContext: fakeCtx,
    project: res1.project,
  });

  // Mock a MediaStream
  const mockTrack = {
    stopCalled: false,
    stop() {
      this.stopCalled = true;
    },
  };
  const mockStream = {
    getAudioTracks: () => [mockTrack],
  };

  try {
    const startRes = await engine.startRecording(trackId, {
      stream: mockStream,
    });
    assert.ok(startRes.ok);
    assert.equal(engine.state.get().recording, true);
    assert.ok(
      engine.getProject().tracks.find((t) => t.id === trackId).recordArm,
    );

    // Feed a PCM chunk to the active recorder
    if (engine._recorder) {
      engine._recorder.recordChunk(new Float32Array(44100)); // 1 second
    }

    const stopRes = await engine.stopRecording();
    assert.ok(stopRes.ok);
    assert.equal(engine.state.get().recording, false);
    assert.ok(stopRes.clipResult);

    const track = engine.getProject().tracks.find((t) => t.id === trackId);
    assert.equal(track.audioClips.length, 1);
    assert.ok(track.audioClips[0].name.startsWith("Take"));
  } finally {
    await engine.stop();
  }
});
