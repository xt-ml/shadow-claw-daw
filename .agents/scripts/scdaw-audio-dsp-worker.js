/**
 * .agents/scripts/scdaw-audio-dsp-worker.js
 *
 * Optional Web Worker and Rust/WASM DSP acceleration adapter for ShadowClaw DAW.
 * Executes offline channel processing via an optional Worker or WASM backend,
 * falling back automatically and seamlessly to zero-config pure-JS execution.
 */

import {
  processAudioChannels,
  registerDspBackend,
  unregisterDspBackend,
} from "./scdaw-audio-dsp.js";

let _activeWorkerRunner = null;

/**
 * Create an optional Web Worker runner for off-main-thread DSP execution.
 * Automatically falls back to pure-JS `processAudioChannels` on worker error or timeout.
 *
 * @param {{ workerFactory?: Function | null, workerUrl?: string | URL | null, timeoutMs?: number }} [options]
 * @returns {{ process: Function, terminate: Function, isActive: Function }}
 */
export function createDspWorkerRunner(options = {}) {
  const timeoutMs = Math.max(100, Number(options.timeoutMs ?? 15000));
  let worker = null;
  let terminated = false;
  let nextId = 1;
  const pending = new Map();

  try {
    if (typeof options.workerFactory === "function") {
      worker = options.workerFactory();
    } else if (typeof Worker !== "undefined") {
      const url = options.workerUrl || import.meta.url;
      worker = new Worker(url, { type: "module" });
    }
  } catch (_) {
    worker = null;
  }

  if (worker) {
    worker.onmessage = (event) => {
      const msg = event?.data;
      if (!msg || msg.id === undefined) return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) {
        const channels = Array.isArray(msg.channels)
          ? msg.channels.map((ch) =>
              ch instanceof Float32Array ? ch : new Float32Array(ch || 0),
            )
          : [];
        entry.resolve({ channels, meta: msg.meta || {} });
      } else {
        try {
          entry.resolve(
            processAudioChannels(
              entry.channels,
              entry.effect,
              entry.params,
              entry.sampleRate,
            ),
          );
        } catch (err) {
          entry.reject(err);
        }
      }
    };
    worker.onerror = () => {
      for (const [id, entry] of pending.entries()) {
        pending.delete(id);
        clearTimeout(entry.timer);
        try {
          entry.resolve(
            processAudioChannels(
              entry.channels,
              entry.effect,
              entry.params,
              entry.sampleRate,
            ),
          );
        } catch (err) {
          entry.reject(err);
        }
      }
    };
  }

  return {
    isActive() {
      return Boolean(worker && !terminated);
    },
    async process(channels, effect, params = {}, sampleRate = 44100) {
      if (!worker || terminated) {
        return processAudioChannels(channels, effect, params, sampleRate);
      }
      return await new Promise((resolve, reject) => {
        const id = nextId++;
        const copied = channels.map((ch) =>
          ch instanceof Float32Array
            ? new Float32Array(ch)
            : new Float32Array(ch || 0),
        );
        const timer = setTimeout(() => {
          pending.delete(id);
          try {
            resolve(processAudioChannels(channels, effect, params, sampleRate));
          } catch (err) {
            reject(err);
          }
        }, timeoutMs);

        pending.set(id, {
          resolve,
          reject,
          timer,
          channels,
          effect,
          params,
          sampleRate,
        });

        try {
          const transferables = copied.map((c) => c.buffer);
          worker.postMessage(
            { id, channels: copied, effect, params, sampleRate },
            transferables,
          );
        } catch (_) {
          pending.delete(id);
          clearTimeout(timer);
          try {
            resolve(processAudioChannels(channels, effect, params, sampleRate));
          } catch (err) {
            reject(err);
          }
        }
      });
    },
    terminate() {
      terminated = true;
      for (const [id, entry] of pending.entries()) {
        pending.delete(id);
        clearTimeout(entry.timer);
      }
      if (worker && typeof worker.terminate === "function") {
        try {
          worker.terminate();
        } catch (_) {}
      }
      worker = null;
    },
  };
}

/**
 * Enable shared DSP Web Worker acceleration globally.
 * @param {Object} [options]
 * @returns {Object}
 */
export function enableDspWorker(options = {}) {
  disableDspWorker();
  _activeWorkerRunner = createDspWorkerRunner(options);
  return _activeWorkerRunner;
}

/**
 * Disable and terminate shared DSP Web Worker, restoring synchronous JS fallback.
 */
export function disableDspWorker() {
  if (_activeWorkerRunner) {
    _activeWorkerRunner.terminate();
    _activeWorkerRunner = null;
  }
}

/**
 * Return the active shared DSP worker runner or null.
 * @returns {Object | null}
 */
export function getDspWorkerRunner() {
  return _activeWorkerRunner;
}

/**
 * Execute offline channel DSP asynchronously via active Web Worker if enabled,
 * otherwise executes zero-config pure-JS `processAudioChannels`.
 *
 * @param {Float32Array[]} channels
 * @param {string} effect
 * @param {Object} [params]
 * @param {number} [sampleRate=44100]
 * @returns {Promise<{ channels: Float32Array[], meta: Object }>}
 */
export async function processAudioChannelsAsync(
  channels,
  effect,
  params = {},
  sampleRate = 44100,
) {
  if (_activeWorkerRunner && _activeWorkerRunner.isActive()) {
    return await _activeWorkerRunner.process(
      channels,
      effect,
      params,
      sampleRate,
    );
  }
  return processAudioChannels(channels, effect, params, sampleRate);
}

/**
 * Optional Rust/WASM DSP module loader & backend registrar.
 * Accepts an instantiated WebAssembly instance, compiled Module, raw WASM bytes,
 * or fetch URL alongside an `adapter(wasmInstance)` mapping op names -> handlers.
 * Gracefully falls back to pure JS on invalid binaries or unsupported environments.
 *
 * @param {{ instance?: Object | null, module?: WebAssembly.Module | null, bytes?: BufferSource | null, url?: string | URL | null, imports?: Object, adapter?: Function | null, ops?: Record<string, Function> | null }} [options]
 * @returns {Promise<{ ok: boolean, registeredOps: string[], fallback?: string, error?: string, unload: Function }>}
 */
export async function loadWasmDspBackend(options = {}) {
  try {
    let wasmInstance = options.instance || null;
    const imports = options.imports || {};

    if (!wasmInstance) {
      if (typeof WebAssembly === "undefined") {
        throw new Error("WebAssembly is not supported in this environment");
      }
      if (options.module) {
        wasmInstance = await WebAssembly.instantiate(options.module, imports);
      } else if (options.bytes) {
        const res = await WebAssembly.instantiate(options.bytes, imports);
        wasmInstance = res.instance || res;
      } else if (options.url && typeof fetch === "function") {
        const resp = await fetch(options.url);
        if (!resp.ok) {
          throw new Error(
            `Failed to fetch WASM DSP module: HTTP ${resp.status}`,
          );
        }
        const bytes = await resp.arrayBuffer();
        const res = await WebAssembly.instantiate(bytes, imports);
        wasmInstance = res.instance || res;
      } else {
        throw new Error(
          "No WASM instance, module, bytes, or url supplied to loadWasmDspBackend",
        );
      }
    }

    const opMap =
      typeof options.adapter === "function"
        ? options.adapter(wasmInstance)
        : options.ops && typeof options.ops === "object"
          ? options.ops
          : {};

    const registeredOps = [];
    for (const [opName, handler] of Object.entries(opMap || {})) {
      if (typeof handler === "function") {
        registerDspBackend(opName, handler);
        registeredOps.push(opName);
      }
    }

    return {
      ok: true,
      registeredOps,
      unload() {
        for (const op of registeredOps) {
          unregisterDspBackend(op);
        }
      },
    };
  } catch (err) {
    return {
      ok: false,
      fallback: "js",
      error: err?.message || String(err),
      registeredOps: [],
      unload() {},
    };
  }
}

// Self-hosted Web Worker execution entrypoint
if (
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope
) {
  self.addEventListener("message", (event) => {
    const msg = event?.data;
    if (!msg || msg.id === undefined) return;
    try {
      const result = processAudioChannels(
        msg.channels,
        msg.effect,
        msg.params || {},
        msg.sampleRate || 44100,
      );
      const transferables = result.channels.map((c) => c.buffer);
      self.postMessage(
        { id: msg.id, ok: true, channels: result.channels, meta: result.meta },
        transferables,
      );
    } catch (err) {
      self.postMessage({
        id: msg.id,
        ok: false,
        error: err?.message || String(err),
      });
    }
  });
}
