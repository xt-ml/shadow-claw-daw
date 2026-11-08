import test from "node:test";
import assert from "node:assert/strict";
import {
  Signal,
  State,
  Computed,
  effect,
  batch,
} from "../.agents/scripts/scdaw-signals.js";

test("Signals: exports Signal polyfill and aliases", () => {
  assert.ok(Signal);
  assert.equal(State, Signal.State);
  assert.equal(Computed, Signal.Computed);
});

test("Signals: State stores and updates value", () => {
  const count = new State(10);
  assert.equal(count.get(), 10);
  count.set(20);
  assert.equal(count.get(), 20);
});

test("Signals: Computed derives value and updates on dependency change", () => {
  const price = new State(100);
  const tax = new State(10);
  const total = new Computed(() => price.get() + tax.get());

  assert.equal(total.get(), 110);
  price.set(200);
  assert.equal(total.get(), 210);
  tax.set(20);
  assert.equal(total.get(), 220);
});

test("Signals: effect runs on initial execution and re-runs on state change", async () => {
  const bpm = new State(120);
  const history = [];

  const dispose = effect(() => {
    history.push(bpm.get());
  });

  assert.deepEqual(history, [120]);

  bpm.set(128);
  await Promise.resolve();
  assert.deepEqual(history, [120, 128]);

  bpm.set(140);
  await Promise.resolve();
  assert.deepEqual(history, [120, 128, 140]);

  dispose();
  bpm.set(160);
  await Promise.resolve();
  assert.deepEqual(
    history,
    [120, 128, 140],
    "disposed effect should not react",
  );
});

test("Signals: batch groups multiple updates into single effect run", async () => {
  const a = new State(1);
  const b = new State(2);
  let runCount = 0;

  effect(() => {
    a.get();
    b.get();
    runCount++;
  });

  assert.equal(runCount, 1);

  batch(() => {
    a.set(10);
    b.set(20);
  });
  await Promise.resolve();

  assert.equal(runCount, 2, "effect should run only once for batched updates");
});

test("Signals: effect cleanup function called before re-execution and on disposal", async () => {
  const count = new State(1);
  const cleanups = [];

  const dispose = effect(() => {
    const val = count.get();
    return () => {
      cleanups.push(val);
    };
  });

  assert.deepEqual(cleanups, []);

  count.set(2);
  await Promise.resolve();
  assert.deepEqual(cleanups, [1]);

  dispose();
  assert.deepEqual(cleanups, [1, 2]);
});
