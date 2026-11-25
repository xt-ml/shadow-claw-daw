import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { TOOLS } from "../bin/tool-manifest.mjs";
import { handleToolDispatch } from "../.agents/scripts/shadow-claw-daw-adapter.js";
import { scdaw } from "../.agents/scripts/shadow-claw-daw-engine.js";

test("shadow-claw.config.json: registers shadow-claw-daw-midi-keyboard and MIDI tools", async () => {
  const raw = await fs.readFile("shadow-claw.config.json", "utf8");
  const cfg = JSON.parse(raw);

  assert.ok(
    cfg.customElements.allowedElements.includes(
      "shadow-claw-daw-midi-keyboard",
    ),
    "shadow-claw-daw-midi-keyboard must be in allowedElements",
  );
  for (const toolName of [
    "scdaw_get_midi_status",
    "scdaw_configure_midi",
    "scdaw_trigger_midi",
  ]) {
    assert.ok(
      cfg.enabledTools.includes(toolName),
      `${toolName} must be in enabledTools`,
    );
  }
});

test("bin/tool-manifest.mjs: defines Web MIDI tools", () => {
  const names = new Set(TOOLS.map((t) => t.name));
  assert.ok(names.has("scdaw_get_midi_status"));
  assert.ok(names.has("scdaw_configure_midi"));
  assert.ok(names.has("scdaw_trigger_midi"));
});

test("shadow-claw-daw-adapter: handleToolDispatch supports scdaw_get_midi_status, scdaw_configure_midi, scdaw_trigger_midi", async () => {
  const statusRes = await handleToolDispatch("scdaw_get_midi_status", {});
  assert.equal(typeof statusRes.status, "string");
  assert.ok(Array.isArray(statusRes.inputs));
  assert.ok(Array.isArray(statusRes.outputs));

  const trackId = scdaw.project.get().tracks[0]?.id;
  assert.ok(trackId, "Expected at least one track");

  const cfgRes = await handleToolDispatch("scdaw_configure_midi", {
    action: "set_routing",
    trackId,
    midiInput: { channel: 3, enabled: true },
  });
  assert.equal(cfgRes.midiInput.channel, 3);

  const trigOn = await handleToolDispatch("scdaw_trigger_midi", {
    action: "note_on",
    trackId,
    pitch: 62,
    velocity: 0.75,
  });
  assert.equal(trigOn.ok, true);

  const trigOff = await handleToolDispatch("scdaw_trigger_midi", {
    action: "note_off",
    trackId,
    pitch: 62,
  });
  assert.equal(trigOff.ok, true);

  // start_learn / cancel_learn / apply_preset / clear_learn
  const startLearnRes = await handleToolDispatch("scdaw_configure_midi", {
    action: "start_learn",
    trackId,
    param: "volume",
  });
  assert.equal(startLearnRes.ok, true);
  assert.equal(scdaw.midi.state.get().learning.active, true);
  assert.equal(scdaw.midi.state.get().learning.target.max, 1.5);

  const cancelLearnRes = await handleToolDispatch("scdaw_configure_midi", {
    action: "cancel_learn",
  });
  assert.equal(cancelLearnRes.ok, true);
  assert.equal(scdaw.midi.state.get().learning.active, false);

  const presetRes = await handleToolDispatch("scdaw_configure_midi", {
    action: "apply_preset",
    preset: "smc-mixer",
  });
  assert.equal(presetRes.preset, "smc-mixer");
  assert.ok(presetRes.addedCount > 0);

  const clearRes = await handleToolDispatch("scdaw_configure_midi", {
    action: "clear_learn",
  });
  assert.ok(clearRes.removed >= presetRes.addedCount);

  const importRes = await handleToolDispatch("scdaw_configure_midi", {
    action: "import_learn",
    mappings: [
      { cc: 40, channel: "omni", trackId, param: "volume" },
      { cc: 102, channel: "omni", trackId: "transport", param: "play" },
    ],
  });
  assert.equal(importRes.importedCount, 2);
  assert.equal(importRes.mappings.length, 2);
});
