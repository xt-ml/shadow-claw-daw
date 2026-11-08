/**
 * .agents/scripts/scdaw-signals.js
 *
 * Reactive Signals implementation powered by proposal-signals/signal-polyfill
 * with effect ported from ShadowClaw (src/core/effect.ts).
 */

import { Signal } from "./vendor/signal-polyfill.js";

let needsEnqueue = true;

const watcher = new Signal.subtle.Watcher(() => {
  if (needsEnqueue) {
    needsEnqueue = false;
    globalThis.queueMicrotask(processPending);
  }
});

function processPending() {
  needsEnqueue = true;

  for (const pendingSignals of watcher.getPending()) {
    pendingSignals.get();
  }

  watcher.watch();
}

/**
 * Registers a reactive side effect that is executed whenever any signals accessed
 * within the callback are updated. If the callback returns a cleanup function,
 * it will be called before the next effect execution and when the effect is disposed.
 *
 * @param {Function} callback - Function executed when dependent signals change.
 * @returns {() => void} Dispose function.
 */
export function effect(callback) {
  let cleanup;

  const computed = new Signal.Computed(() => {
    if (typeof cleanup === "function") {
      cleanup();
    }
    cleanup = callback();
  });

  watcher.watch(computed);
  computed.get();

  return () => {
    watcher.unwatch(computed);
    if (typeof cleanup === "function") {
      cleanup();
    }
    cleanup = undefined;
  };
}

/**
 * Microtask batch helper. In this microtask-scheduled reactive model,
 * synchronous signal mutations naturally batch into a single pending effect run.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function batch(fn) {
  return fn();
}

export { Signal };
export const State = Signal.State;
export const Computed = Signal.Computed;
