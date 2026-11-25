import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  FFMPEG_CDN_URLS,
  AUDIO_EXPORT_FORMATS,
  normalizeAudioExportFormat,
  toUint8Array,
  createModuleWorkerBlobUrl,
  loadFfmpegInstance,
  buildFfmpegAudioArgs,
  transcodeWavWithFfmpeg,
} from "../.agents/scripts/shadow-claw-daw-encoders.js";
import { DawEngine } from "../.agents/scripts/shadow-claw-daw-engine.js";
import {
  createProject,
  encodeWav,
} from "../.agents/scripts/shadow-claw-daw.js";
import { TOOLS } from "../bin/tool-manifest.mjs";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";

test("FFmpeg Audio Export: format normalization & pinned CDN URLs", () => {
  assert.deepEqual(AUDIO_EXPORT_FORMATS, [
    "wav",
    "mp3",
    "ogg",
    "opus",
    "flac",
    "m4a",
  ]);
  assert.equal(normalizeAudioExportFormat("MP3"), "mp3");
  assert.equal(normalizeAudioExportFormat("aac"), "m4a");
  assert.equal(normalizeAudioExportFormat("flac"), "flac");
  assert.equal(normalizeAudioExportFormat("opus"), "opus");
  assert.equal(normalizeAudioExportFormat("ogg"), "ogg");
  assert.equal(normalizeAudioExportFormat("unknown"), "wav");
  assert.equal(normalizeAudioExportFormat(""), "wav");

  assert.match(FFMPEG_CDN_URLS.ffmpeg, /@ffmpeg\/ffmpeg@0\.12\.15/);
  assert.match(FFMPEG_CDN_URLS.ffmpegWorker, /@ffmpeg\/ffmpeg@0\.12\.15/);
  assert.match(FFMPEG_CDN_URLS.ffmpegCoreJs, /@ffmpeg\/core@0\.12\.10/);
  assert.match(FFMPEG_CDN_URLS.ffmpegCoreWasm, /@ffmpeg\/core@0\.12\.10/);
});

test("FFmpeg Audio Export: buildFfmpegAudioArgs builds codecs and clamps bitrates", () => {
  const mp3 = buildFfmpegAudioArgs({
    inputFile: "in.wav",
    outputFile: "out.mp3",
    format: "mp3",
    bitrateKbps: 256,
  });
  assert.ok(mp3.includes("libmp3lame"));
  assert.ok(mp3.includes("256k"));
  assert.equal(mp3[mp3.length - 1], "out.mp3");

  const ogg = buildFfmpegAudioArgs({
    inputFile: "in.wav",
    outputFile: "out.ogg",
    format: "ogg",
    bitrateKbps: 192,
  });
  assert.ok(ogg.includes("libvorbis"));

  const opus = buildFfmpegAudioArgs({
    inputFile: "in.wav",
    outputFile: "out.opus",
    format: "opus",
    bitrateKbps: 999, // clamped to 320
  });
  assert.ok(opus.includes("libopus"));
  assert.ok(opus.includes("48000"));
  assert.ok(opus.includes("320k"));

  const flac = buildFfmpegAudioArgs({
    inputFile: "in.wav",
    outputFile: "out.flac",
    format: "flac",
  });
  assert.ok(flac.includes("flac"));
  assert.equal(flac.includes("-b:a"), false);

  const m4a = buildFfmpegAudioArgs({
    inputFile: "in.wav",
    outputFile: "out.m4a",
    format: "m4a",
    bitrateKbps: 16, // clamped to 64
  });
  assert.ok(m4a.includes("aac"));
  assert.ok(m4a.includes("+faststart"));
  assert.ok(m4a.includes("64k"));
});

test("FFmpeg Audio Export: loadFfmpegInstance loads ESM module, creates worker blob URL, and revokes on both success & error", async () => {
  const revoked = [];
  let loadedConfig = null;
  class MockFFmpeg {
    async load(cfg) {
      loadedConfig = cfg;
    }
  }
  const inst = await loadFfmpegInstance({
    importFfmpeg: async (url) => {
      assert.equal(url, FFMPEG_CDN_URLS.ffmpeg);
      return { FFmpeg: MockFFmpeg };
    },
    createWorkerBlobUrl: (wUrl) => {
      assert.equal(wUrl, FFMPEG_CDN_URLS.ffmpegWorker);
      return "blob:mock-worker-1";
    },
    revokeBlobUrl: (bUrl) => revoked.push(bUrl),
  });
  assert.ok(inst instanceof MockFFmpeg);
  assert.equal(loadedConfig.classWorkerURL, "blob:mock-worker-1");
  assert.equal(loadedConfig.coreURL, FFMPEG_CDN_URLS.ffmpegCoreJs);
  assert.equal(loadedConfig.wasmURL, FFMPEG_CDN_URLS.ffmpegCoreWasm);
  assert.deepEqual(revoked, ["blob:mock-worker-1"]);

  // Error path still revokes blob URL
  class FailingFFmpeg {
    async load() {
      throw new Error("wasm load failed");
    }
  }
  await assert.rejects(
    loadFfmpegInstance({
      importFfmpeg: async () => ({ FFmpeg: FailingFFmpeg }),
      createWorkerBlobUrl: () => "blob:mock-worker-2",
      revokeBlobUrl: (bUrl) => revoked.push(bUrl),
    }),
    /wasm load failed/,
  );
  assert.deepEqual(revoked, ["blob:mock-worker-1", "blob:mock-worker-2"]);

  assert.ok(toUint8Array(new ArrayBuffer(8)) instanceof Uint8Array);
  assert.equal(typeof createModuleWorkerBlobUrl, "function");
});

test("FFmpeg Audio Export: transcodeWavWithFfmpeg bypasses FFmpeg for WAV, transcodes compressed formats, and cleans up temp files", async () => {
  const sample = new Float32Array(256).fill(0.25);
  const wavBuf = encodeWav([sample, sample], 44100);

  // Native WAV skips ffmpegLoader
  let loaderCalled = false;
  const nativeRes = await transcodeWavWithFfmpeg(wavBuf, {
    format: "wav",
    ffmpegLoader: async () => {
      loaderCalled = true;
      return {};
    },
  });
  assert.equal(loaderCalled, false);
  assert.equal(nativeRes.engineUsed, "native");
  assert.equal(nativeRes.mimeType, "audio/wav");
  assert.equal(nativeRes.extension, "wav");
  assert.equal(nativeRes.bytes.byteLength, wavBuf.byteLength);

  // MP3 transcode via mock ffmpeg
  const written = new Map();
  const deleted = [];
  let execArgs = null;
  const progressSteps = [];
  const fakeFfmpeg = {
    _logHandlers: [],
    on(evt, fn) {
      if (evt === "log") this._logHandlers.push(fn);
    },
    off(evt, fn) {
      if (evt === "log") {
        this._logHandlers = this._logHandlers.filter((h) => h !== fn);
      }
    },
    async writeFile(name, data) {
      written.set(name, data);
    },
    async exec(args) {
      execArgs = args;
      for (const h of this._logHandlers) {
        h({ message: "Stream #0:0 -> #0:0 (pcm_s24le -> mp3)" });
      }
      return 0;
    },
    async readFile(name) {
      assert.equal(name, "output.mp3");
      return new Uint8Array([0x49, 0x44, 0x33, 0x03]); // ID3 header bytes
    },
    async deleteFile(name) {
      deleted.push(name);
    },
  };

  const mp3Res = await transcodeWavWithFfmpeg(wavBuf, {
    format: "mp3",
    bitrateKbps: 256,
    onProgress: (ratio, label) => progressSteps.push({ ratio, label }),
    ffmpegLoader: async () => fakeFfmpeg,
  });
  assert.equal(mp3Res.engineUsed, "ffmpeg-wasm");
  assert.equal(mp3Res.format, "mp3");
  assert.equal(mp3Res.mimeType, "audio/mpeg");
  assert.equal(mp3Res.extension, "mp3");
  assert.deepEqual(Array.from(mp3Res.bytes), [0x49, 0x44, 0x33, 0x03]);
  assert.ok(written.get("input.wav") instanceof Uint8Array);
  assert.ok(execArgs.includes("libmp3lame"));
  assert.deepEqual(deleted.sort(), ["input.wav", "output.mp3"]);
  assert.ok(progressSteps.some((p) => p.ratio === 1));

  // Non-zero exit throws with log tail & still cleans up input/output files
  deleted.length = 0;
  const failFfmpeg = {
    _handlers: [],
    on(evt, fn) {
      if (evt === "log") this._handlers.push(fn);
    },
    off() {},
    async writeFile() {},
    async exec() {
      for (const h of this._handlers) h({ message: "Unknown encoder foo" });
      return 1;
    },
    async deleteFile(name) {
      deleted.push(name);
    },
  };
  await assert.rejects(
    transcodeWavWithFfmpeg(wavBuf, {
      format: "flac",
      ffmpegLoader: async () => failFfmpeg,
    }),
    /FFmpeg failed with exit code 1: Unknown encoder foo/,
  );
  assert.deepEqual(
    deleted.sort(),
    ["input.flac", "input.wav", "output.flac"]
      .filter((f) => deleted.includes(f))
      .sort(),
  );
  assert.ok(deleted.includes("input.wav"));
  assert.ok(deleted.includes("output.flac"));
});

test("DawEngine.bounce: exports native WAV by default and FFmpeg-encoded MP3/FLAC/OGG/Opus/M4A when requested", async () => {
  const ctx = new FakeAudioContext({ sampleRate: 16000 });
  const engine = new DawEngine({
    project: createProject("basic-beat"),
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  // Default native WAV bounce remains intact
  const wavMeta = await engine.bounce({
    sampleRate: 16000,
    saveToOpfs: false,
    saveToWorkspace: false,
  });
  assert.equal(wavMeta.format, "wav");
  assert.equal(wavMeta.mimeType, "audio/wav");
  assert.equal(wavMeta.extension, "wav");
  assert.equal(wavMeta.engineUsed, "native");

  // MP3 bounce delegates rendered WAV into FFmpeg WASM
  let recordedExec = null;
  const mp3Meta = await engine.bounce({
    format: "mp3",
    bitrateKbps: 256,
    sampleRate: 16000,
    saveToOpfs: false,
    saveToWorkspace: false,
    ffmpegLoader: async () => ({
      async writeFile() {},
      async exec(args) {
        recordedExec = args;
        return 0;
      },
      async readFile() {
        return new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
      },
      async deleteFile() {},
    }),
  });
  assert.equal(mp3Meta.format, "mp3");
  assert.equal(mp3Meta.mimeType, "audio/mpeg");
  assert.equal(mp3Meta.extension, "mp3");
  assert.equal(mp3Meta.engineUsed, "ffmpeg-wasm");
  assert.equal(mp3Meta.bitrateKbps, 256);
  assert.match(mp3Meta.filename, /\.mp3$/);
  assert.equal(mp3Meta.bytes, 4);
  assert.ok(mp3Meta.wavBuffer.byteLength > 44);
  assert.ok(recordedExec.includes("libmp3lame"));
});

test("Workbench export modal & scdaw_bounce manifest expose FFmpeg audio export formats and bitrate", async () => {
  const [wbSrc] = await Promise.all([
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-workbench.js",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  for (const fmt of ["mp3", "ogg", "opus", "flac", "m4a"]) {
    assert.match(
      wbSrc,
      new RegExp(`<option\\s+value=["']${fmt}["']`),
      `Export format select must include ${fmt}`,
    );
  }
  assert.match(wbSrc, /id=["']export-bitrate["']/);
  assert.match(
    wbSrc,
    /id=["']export-modal-status["'][^>]*aria-live=["']polite["']/,
  );
  assert.match(wbSrc, /bitrateKbps/);

  const bounceTool = TOOLS.find((t) => t.name === "scdaw_bounce");
  assert.ok(bounceTool, "scdaw_bounce tool exists in TOOLS");
  assert.deepEqual(bounceTool.input_schema.properties.format.enum, [
    "wav",
    "mp3",
    "ogg",
    "opus",
    "flac",
    "m4a",
  ]);
  assert.equal(bounceTool.input_schema.properties.bitrateKbps.type, "number");
});
