import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { TOOLS } from "../bin/tool-manifest.mjs";
import { handleToolDispatch } from "../.agents/scripts/scdaw-adapter.js";
import { scdaw } from "../.agents/scripts/scdaw-engine.js";

test("shadow-claw.config.json: registers scdaw-midi-keyboard and MIDI tools", async () => {
  const raw = await fs.readFile("shadow-claw.config.json", "utf8");
  const cfg = JSON.parse(raw);

  assert.ok(
    cfg.customElements.allowedElements.includes("scdaw-midi-keyboard"),
    "scdaw-midi-keyboard must be in allowedElements",
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

test("scdaw-adapter: handleToolDispatch supports scdaw_get_midi_status, scdaw_configure_midi, scdaw_trigger_midi", async () => {
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
});
