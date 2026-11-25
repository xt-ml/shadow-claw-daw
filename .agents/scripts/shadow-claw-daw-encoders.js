/**
 * .agents/scripts/shadow-claw-daw-encoders.js
 *
 * Audio Export Encoders & Lazy FFmpeg WASM Bridge for ShadowClaw DAW.
 *
 * Local-First (100% Offline):
 * - Native PCM WAV (`encodeWav` in `shadow-claw-daw.js`)
 *
 * Optional Lazy CDN Encoder (opt-in when exporting MP3 / OGG / Opus / FLAC / M4A):
 * - @ffmpeg/ffmpeg@0.12.15 + @ffmpeg/core@0.12.10
 */

export const FFMPEG_CDN_URLS = {
  ffmpeg:
    "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js",
  ffmpegWorker:
    "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js",
  ffmpegCoreJs:
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js",
  ffmpegCoreWasm:
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm",
};

export const AUDIO_EXPORT_FORMATS = [
  "wav",
  "mp3",
  "ogg",
  "opus",
  "flac",
  "m4a",
];

const FORMAT_MIME_MAP = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  m4a: "audio/mp4",
};

/**
 * Normalize an audio export format string into one of AUDIO_EXPORT_FORMATS.
 */
export function normalizeAudioExportFormat(raw) {
  const fmt = String(raw || "")
    .trim()
    .toLowerCase();
  if (fmt === "aac" || fmt === "mp4") return "m4a";
  if (AUDIO_EXPORT_FORMATS.includes(fmt)) return fmt;
  return "wav";
}

/**
 * Convert ArrayBuffer, TypedArray, or ArrayBufferView to a standalone Uint8Array.
 */
export function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new Error("Expected ArrayBuffer or TypedArray audio payload");
}

export function createModuleWorkerBlobUrl(workerModuleUrl) {
  const source = `import ${JSON.stringify(workerModuleUrl)};\n`;
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

export async function loadFfmpegInstance({
  urls = FFMPEG_CDN_URLS,
  importFfmpeg = (url) => import(/* @vite-ignore */ url),
  createWorkerBlobUrl = createModuleWorkerBlobUrl,
  revokeBlobUrl = (url) => {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
  },
} = {}) {
  const { FFmpeg } = await importFfmpeg(urls.ffmpeg);
  const ffmpeg = new FFmpeg();
  const classWorkerURL = createWorkerBlobUrl(urls.ffmpegWorker);
  try {
    await ffmpeg.load({
      classWorkerURL,
      coreURL: urls.ffmpegCoreJs,
      wasmURL: urls.ffmpegCoreWasm,
    });
  } finally {
    revokeBlobUrl(classWorkerURL);
  }
  return ffmpeg;
}

let cachedFfmpegPromise = null;
function defaultFfmpegLoader() {
  if (!cachedFfmpegPromise) {
    cachedFfmpegPromise = loadFfmpegInstance().catch((err) => {
      cachedFfmpegPromise = null;
      throw err;
    });
  }
  return cachedFfmpegPromise;
}

/**
 * Build FFmpeg CLI arguments for transcoding an input WAV into a target audio format.
 */
export function buildFfmpegAudioArgs({
  inputFile = "input.wav",
  outputFile = "output.mp3",
  format = "mp3",
  bitrateKbps = 192,
  sampleRate = 44100,
  channels = 2,
} = {}) {
  const fmt = normalizeAudioExportFormat(format);
  const safeBitrate = Math.max(
    64,
    Math.min(320, Math.round(Number(bitrateKbps) || 192)),
  );
  const safeChannels = Math.max(
    1,
    Math.min(2, Math.round(Number(channels) || 2)),
  );
  const baseArgs = ["-y", "-i", inputFile, "-vn", "-ac", String(safeChannels)];

  if (fmt === "mp3") {
    return [
      ...baseArgs,
      "-c:a",
      "libmp3lame",
      "-b:a",
      `${safeBitrate}k`,
      outputFile,
    ];
  }
  if (fmt === "ogg") {
    return [
      ...baseArgs,
      "-c:a",
      "libvorbis",
      "-b:a",
      `${safeBitrate}k`,
      outputFile,
    ];
  }
  if (fmt === "opus") {
    return [
      ...baseArgs,
      "-ar",
      "48000",
      "-c:a",
      "libopus",
      "-b:a",
      `${safeBitrate}k`,
      outputFile,
    ];
  }
  if (fmt === "flac") {
    return [
      ...baseArgs,
      "-ar",
      String(Math.max(8000, Math.round(Number(sampleRate) || 44100))),
      "-c:a",
      "flac",
      outputFile,
    ];
  }
  if (fmt === "m4a") {
    return [
      ...baseArgs,
      "-c:a",
      "aac",
      "-b:a",
      `${safeBitrate}k`,
      "-movflags",
      "+faststart",
      outputFile,
    ];
  }

  return [...baseArgs, "-c:a", "pcm_s16le", outputFile];
}

/**
 * Transcode a WAV ArrayBuffer/Uint8Array into the requested audio format via lazy FFmpeg WASM.
 * Returns native WAV directly without loading FFmpeg when `format === "wav"`.
 */
export async function transcodeWavWithFfmpeg(
  wavBytesOrBuffer,
  {
    format = "mp3",
    bitrateKbps = 192,
    sampleRate = 44100,
    channels = 2,
    onProgress = null,
    ffmpegLoader = null,
  } = {},
) {
  const fmt = normalizeAudioExportFormat(format);
  const inputBytes = toUint8Array(wavBytesOrBuffer);

  if (fmt === "wav") {
    onProgress?.(1, "WAV Ready");
    return {
      bytes: inputBytes,
      format: "wav",
      mimeType: FORMAT_MIME_MAP.wav,
      extension: "wav",
      engineUsed: "native",
    };
  }

  onProgress?.(0.1, "Loading FFmpeg WASM...");
  const ffmpeg = await (ffmpegLoader || defaultFfmpegLoader)();
  const inputFile = "input.wav";
  const outputFile = `output.${fmt}`;
  const logTail = [];
  const onLog = ({ message } = {}) => {
    if (message) {
      logTail.push(String(message));
      if (logTail.length > 8) logTail.shift();
    }
  };
  if (typeof ffmpeg.on === "function") {
    ffmpeg.on("log", onLog);
  }

  try {
    onProgress?.(0.35, `Preparing ${fmt.toUpperCase()} export...`);
    await ffmpeg.writeFile(inputFile, inputBytes);
    const args = buildFfmpegAudioArgs({
      inputFile,
      outputFile,
      format: fmt,
      bitrateKbps,
      sampleRate,
      channels,
    });
    onProgress?.(0.55, `Encoding ${fmt.toUpperCase()}...`);
    const exitCode = await ffmpeg.exec(args);
    if (typeof exitCode === "number" && exitCode !== 0) {
      throw new Error(
        `FFmpeg failed with exit code ${exitCode}${logTail.length ? `: ${logTail.slice(-4).join(" | ")}` : ""}`,
      );
    }
    const data = await ffmpeg.readFile(outputFile);
    onProgress?.(1, "Complete");
    return {
      bytes: toUint8Array(data),
      format: fmt,
      mimeType: FORMAT_MIME_MAP[fmt] || "application/octet-stream",
      extension: fmt,
      engineUsed: "ffmpeg-wasm",
    };
  } finally {
    ffmpeg.off?.("log", onLog);
    if (typeof ffmpeg.deleteFile === "function") {
      for (const f of [inputFile, outputFile]) {
        try {
          await ffmpeg.deleteFile(f);
        } catch (_) {}
      }
    }
  }
}
