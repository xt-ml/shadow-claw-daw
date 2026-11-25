import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createProject,
  encodeWav,
} from "../.agents/scripts/shadow-claw-daw.js";
import { scdaw } from "../.agents/scripts/shadow-claw-daw-engine.js";
import { handleToolDispatch } from "../.agents/scripts/shadow-claw-daw-adapter.js";
import {
  encodeDawProject,
  decodeDawProject,
} from "../.agents/scripts/shadow-claw-daw-dawproject.js";
import { extractDroppedAudioFiles } from "../.agents/scripts/components/shadow-claw-daw-timeline.js";
import {
  createDspWorkerRunner,
  enableDspWorker,
  disableDspWorker,
  processAudioChannelsAsync,
  loadWasmDspBackend,
} from "../.agents/scripts/shadow-claw-daw-audio-dsp-worker.js";
import { processAudioChannels } from "../.agents/scripts/shadow-claw-daw-audio-dsp.js";

function makeSine(freq, sampleRate, durationSec, amp = 0.5) {
  const len = Math.round(sampleRate * durationSec);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

test("Phase 6.1: scdaw_import_audio decodes base64/data-URI WAV in pure JS and supports timeline/wave-editor drag-and-drop", async () => {
  const sr = 16000;
  const sine = makeSine(440, sr, 0.5, 0.5);
  const wavBuf = encodeWav([sine], sr, { bitDepth: 16 });
  const rawBase64 = Buffer.from(wavBuf).toString("base64");
  const dataUri = `data:audio/wav;base64,${rawBase64}`;

  await handleToolDispatch("scdaw_reset", { template: "empty" });

  // Raw base64 import with omitted trackId auto-creates an audio track
  const res1 = await handleToolDispatch("scdaw_import_audio", {
    data: rawBase64,
    name: "lead-vox.wav",
    time: 2,
  });
  assert.equal(res1.ok, true);
  assert.ok(res1.trackId);
  assert.equal(res1.clip.time, 2);
  assert.ok(res1.clip.duration > 0.5);

  const sampleBuf = scdaw.getSample(res1.clip.sample);
  assert.ok(sampleBuf, "Imported sample buffer must exist in _sampleCache");
  const pcm = sampleBuf.getChannelData(0);
  let maxPeak = 0;
  for (let i = 0; i < pcm.length; i++) {
    maxPeak = Math.max(maxPeak, Math.abs(pcm[i]));
  }
  assert.ok(
    maxPeak > 0.4,
    `Expected decoded non-zero WAV PCM peak > 0.4, got ${maxPeak}`,
  );

  // Data URI import onto the existing audio track
  const res2 = await handleToolDispatch("scdaw_import_audio", {
    trackId: res1.trackId,
    data: dataUri,
    name: "harmony.wav",
    time: 4,
  });
  assert.equal(res2.ok, true);
  assert.equal(res2.trackId, res1.trackId);
  assert.equal(res2.clip.time, 4);

  // extractDroppedAudioFiles filters audio MIME types and extensions
  const dropped = extractDroppedAudioFiles({
    files: [
      { name: "take.wav", type: "audio/wav" },
      { name: "backing.mp3", type: "" },
      { name: "loop.ogg", type: "application/ogg" },
      { name: "master.flac", type: "audio/flac" },
      { name: "notes.txt", type: "text/plain" },
      { name: "project.json", type: "application/json" },
    ],
  });
  assert.deepEqual(
    dropped.map((f) => f.name),
    ["take.wav", "backing.mp3", "loop.ogg", "master.flac"],
  );

  const timelineSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/shadow-claw-daw-timeline.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(timelineSrc, /scdaw-timeline__lane--drop-target/);
  assert.match(timelineSrc, /addEventListener\(["']dragover["']/);
  assert.match(timelineSrc, /addEventListener\(["']drop["']/);
  assert.match(timelineSrc, /reportError/);

  const waveSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/shadow-claw-daw-wave-editor.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(waveSrc, /scdaw-wave__stage--drop-target/);
  assert.match(waveSrc, /addEventListener\(["']dragover["']/);
  assert.match(waveSrc, /addEventListener\(["']drop["']/);
});

test("Phase 6.2: DAWproject round-trip preserves clip fades, envelopes, time/pitch fields, and project labels", async () => {
  const original = createProject({
    name: "Audio Clip DAWproject Roundtrip",
    bpm: 124,
    signature: [4, 4],
    lengthBars: 4,
    labels: [
      { id: "lbl_pt", title: "Cue 1", startBeat: 2, endBeat: 2 },
      {
        id: "lbl_reg",
        title: "Chorus",
        startBeat: 4,
        endBeat: 8,
        lowFrequency: 300,
        highFrequency: 3500,
        color: "#38bdf8",
      },
    ],
    tracks: [
      {
        id: "trk_vocals",
        name: "Lead Vox",
        kind: "audio",
        volume: 0.9,
        pan: -0.1,
        mute: false,
        solo: false,
        notes: [],
        audioClips: [
          {
            id: "clip_1",
            name: "Verse Vocal",
            sample: "vox_verse.wav",
            time: 1,
            duration: 6,
            offset: 0.25,
            gain: 0.85,
            fadeIn: 0.5,
            fadeOut: 0.75,
            fadeInType: "logarithmic",
            fadeOutType: "scurve",
            muted: true,
            color: "#a78bfa",
            pitch: 2,
            speed: 1.1,
            stretchToMatchTempo: true,
            sourceBpm: 120,
            groupId: "grp_1",
            gainEnvelope: [
              { time: 0, value: 0.5 },
              { time: 1.5, value: 1.2 },
            ],
          },
        ],
      },
    ],
  });

  const zipBuf = encodeDawProject(original);
  const decoded = await decodeDawProject(zipBuf);

  assert.equal(decoded.bpm, 124);
  const decodedVox = decoded.tracks.find((t) => t.name === "Lead Vox");
  assert.ok(decodedVox);
  assert.equal(decodedVox.kind, "audio");
  assert.equal(decodedVox.audioClips.length, 1);

  const ac = decodedVox.audioClips[0];
  assert.equal(ac.time, 1);
  assert.equal(ac.duration, 6);
  assert.equal(ac.offset, 0.25);
  assert.equal(ac.gain, 0.85);
  assert.equal(ac.fadeIn, 0.5);
  assert.equal(ac.fadeOut, 0.75);
  assert.equal(ac.fadeInType, "logarithmic");
  assert.equal(ac.fadeOutType, "scurve");
  assert.equal(ac.muted, true);
  assert.equal(ac.color, "#a78bfa");
  assert.equal(ac.pitch, 2);
  assert.equal(ac.speed, 1.1);
  assert.equal(ac.stretchToMatchTempo, true);
  assert.equal(ac.sourceBpm, 120);
  assert.equal(ac.groupId, "grp_1");
  assert.deepEqual(ac.gainEnvelope, [
    { time: 0, value: 0.5 },
    { time: 1.5, value: 1.2 },
  ]);

  assert.ok(Array.isArray(decoded.labels));
  assert.equal(decoded.labels.length, 2);
  const pt = decoded.labels.find((l) => l.title === "Cue 1");
  assert.ok(pt);
  assert.equal(pt.startBeat, 2);
  assert.equal(pt.endBeat, 2);

  const reg = decoded.labels.find((l) => l.title === "Chorus");
  assert.ok(reg);
  assert.equal(reg.startBeat, 4);
  assert.equal(reg.endBeat, 8);
  assert.equal(reg.lowFrequency, 300);
  assert.equal(reg.highFrequency, 3500);
  assert.equal(reg.color, "#38bdf8");
});

test("Phase 6.3: Optional Web Worker and WASM DSP adapters accelerate and fall back cleanly to pure JS", async () => {
  disableDspWorker();
  const sig = makeSine(440, 16000, 0.1, 0.5);

  // Zero-config pure-JS async path
  const jsRes = await processAudioChannelsAsync([sig], "invert", {}, 16000);
  assert.ok(Math.abs(jsRes.channels[0][1] + sig[1]) < 1e-6);

  // Custom mock Worker path + cleanup
  let terminated = false;
  let workerCalls = 0;
  const mockWorker = {
    onmessage: null,
    onerror: null,
    postMessage(payload) {
      workerCalls++;
      setTimeout(() => {
        this.onmessage?.({
          data: {
            id: payload.id,
            ok: true,
            channels: payload.channels.map((c) => c.map((v) => v * 0.5)),
            meta: { accelerated: "worker" },
          },
        });
      }, 2);
    },
    terminate() {
      terminated = true;
    },
  };

  enableDspWorker({ workerFactory: () => mockWorker });
  const workerRes = await processAudioChannelsAsync(
    [sig],
    "amplify",
    { gainDb: -6 },
    16000,
  );
  assert.equal(workerCalls, 1);
  assert.equal(workerRes.meta.accelerated, "worker");
  assert.ok(Math.abs(workerRes.channels[0][1] - sig[1] * 0.5) < 1e-6);
  disableDspWorker();
  assert.equal(terminated, true);

  // Fallback when worker throws inside postMessage
  const brokenRunner = createDspWorkerRunner({
    workerFactory: () => ({
      postMessage() {
        throw new Error("Worker crashed");
      },
      terminate() {},
    }),
  });
  const fallbackRes = await brokenRunner.process([sig], "invert", {}, 16000);
  assert.ok(Math.abs(fallbackRes.channels[0][1] + sig[1]) < 1e-6);
  brokenRunner.terminate();

  // WASM DSP backend loader & unload
  let wasmCalled = false;
  const wasmLoad = await loadWasmDspBackend({
    instance: { exports: { scaleSample: (v) => -v } },
    adapter: (inst) => ({
      invert: (chs) => {
        wasmCalled = true;
        return {
          channels: chs.map((c) =>
            Float32Array.from(c, inst.exports.scaleSample),
          ),
          meta: { backend: "wasm" },
        };
      },
    }),
  });
  assert.equal(wasmLoad.ok, true);
  assert.deepEqual(wasmLoad.registeredOps, ["invert"]);
  const wasmOut = processAudioChannels([sig], "invert", {}, 16000);
  assert.equal(wasmCalled, true);
  assert.equal(wasmOut.meta.backend, "wasm");
  wasmLoad.unload();

  // Invalid WASM bytes gracefully report JS fallback instead of throwing
  const badWasm = await loadWasmDspBackend({
    bytes: new Uint8Array([0, 1, 2, 3]),
  });
  assert.equal(badWasm.ok, false);
  assert.equal(badWasm.fallback, "js");
});

test("Phase 6.4: audio-editing skill exists and is indexed in agent-skills discovery", async () => {
  const skillMd = await fs.readFile(
    new URL("../.agents/skills/audio-editing/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skillMd, /^---\n[\s\S]*name:\s*audio-editing/);
  assert.match(skillMd, /scdaw_import_audio/);
  assert.match(skillMd, /scdaw_edit_audio_clip/);
  assert.match(skillMd, /scdaw_process_audio_clip/);
  assert.match(skillMd, /scdaw_analyze_audio_clip/);
  assert.match(skillMd, /scdaw_manage_labels/);

  const idxRaw = await fs.readFile(
    new URL("../.well-known/agent-skills/index.json", import.meta.url),
    "utf8",
  );
  const idx = JSON.parse(idxRaw);
  const found = (idx.skills || []).find((s) => s.name === "audio-editing");
  assert.ok(
    found,
    "audio-editing must be registered in agent-skills/index.json",
  );
});
