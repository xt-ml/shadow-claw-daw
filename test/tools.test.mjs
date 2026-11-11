import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../bin/tool-manifest.mjs";
import {
  handleToolDispatch,
  registerNativeWebMcp,
} from "../.agents/scripts/scdaw-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TOOLS_DIR = resolve(ROOT, ".agents/tools");

test("Tools: all 40 tools defined in manifest exist on disk and match schema", () => {
  assert.equal(TOOLS.length, 40);

  for (const tool of TOOLS) {
    const filePath = resolve(TOOLS_DIR, `${tool.name}.json`);
    assert.ok(existsSync(filePath), `Tool file must exist: ${tool.name}.json`);

    const content = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(content.name, tool.name);
    assert.ok(
      tool.name.startsWith("scdaw_"),
      `Tool name must start with 'scdaw_': ${tool.name}`,
    );
    assert.equal(content.description, tool.description);
    assert.deepEqual(content.input_schema, tool.input_schema);
    assert.deepEqual(content.annotations, tool.annotations);
    assert.ok(
      content.execution?.code,
      "Tool must define broadcast execution code",
    );
    assert.ok(
      content.execution.code.includes("scdaw-commands"),
      "Execution code must use explicit 'scdaw-commands' channel literal",
    );
  }
});

test("Tools: execution code parses cleanly inside sandboxed-eval scope without Identifier 'input' redeclaration", () => {
  for (const tool of TOOLS) {
    const wrapper = `
      (async function() {
        const $PIPE_DATA = "{}";
        const data = $PIPE_DATA;
        let input;
        try {
          input = typeof data === "string" && data ? JSON.parse(data) : (data ?? {});
        } catch (_) {
          input = data ?? {};
        }

        ${tool.execution.code}
      });
    `;

    assert.doesNotThrow(() => {
      new Function(wrapper);
    }, `Tool ${tool.name} must not throw SyntaxError when evaluated inside sandboxed-eval`);
  }
});

test("Adapter: handleToolDispatch dispatches status, project, transport, and surface", async () => {
  const status = await handleToolDispatch("scdaw_get_status", {});
  assert.ok(status);
  assert.equal(typeof status.playing, "boolean");

  const project = await handleToolDispatch("scdaw_get_project", {});
  assert.ok(project);
  assert.equal(typeof project.bpm, "number");

  const surface = await handleToolDispatch("scdaw_render_surface", {
    element: "workbench",
  });
  assert.ok(surface.ok);
  assert.equal(surface.element, "<scdaw-workbench></scdaw-workbench>");

  const mixerSurface = await handleToolDispatch("scdaw_render_surface", {
    element: "mixer",
  });
  assert.equal(mixerSurface.element, "<scdaw-mixer></scdaw-mixer>");

  const presetRes = await handleToolDispatch("scdaw_apply_preset", {
    trackId: "trk_bass",
    preset: "acid-303",
  });
  assert.ok(presetRes.ok);

  const panicRes = await handleToolDispatch("scdaw_panic", {});
  assert.ok(panicRes.ok);

  const fxRes = await handleToolDispatch("scdaw_manage_fx", {
    trackId: "trk_bass",
    action: "add",
    fxType: "delay",
    params: { wet: 0.4 },
  });
  assert.ok(fxRes.ok);
  assert.equal(fxRes.fx.type, "delay");

  // Test scdaw_set_automation & scdaw_clear_automation
  const autoRes = await handleToolDispatch("scdaw_set_automation", {
    trackId: "trk_bass",
    param: "cutoff",
    time: 1.0,
    value: 1500,
  });
  assert.ok(autoRes.ok);
  assert.equal(autoRes.param, "cutoff");

  const clearAutoRes = await handleToolDispatch("scdaw_clear_automation", {
    trackId: "trk_bass",
    param: "cutoff",
  });
  assert.ok(clearAutoRes.ok);

  // Test scdaw_add_audio_clip & scdaw_set_audio_clip
  const addTrackRes = await handleToolDispatch("scdaw_add_track", {
    kind: "audio",
    name: "Vox",
  });
  assert.equal(addTrackRes.kind, "audio");

  const addClipRes = await handleToolDispatch("scdaw_add_audio_clip", {
    trackId: addTrackRes.trackId,
    clip: {
      id: "clip_test_1",
      name: "Test Take",
      time: 0,
      duration: 2,
    },
  });
  assert.ok(addClipRes.ok);
  assert.equal(addClipRes.clipId, "clip_test_1");

  const setClipRes = await handleToolDispatch("scdaw_set_audio_clip", {
    trackId: addTrackRes.trackId,
    clipId: "clip_test_1",
    patch: { gain: 0.8 },
  });
  assert.ok(setClipRes.ok);
  assert.equal(setClipRes.clip.gain, 0.8);

  // Test scdaw_set_track_send
  const sendRes = await handleToolDispatch("scdaw_set_track_send", {
    trackId: "trk_drums",
    targetTrackId: "trk_bass",
    level: 0.5,
  });
  assert.ok(sendRes.ok);
  assert.equal(sendRes.level, 0.5);

  // Test scdaw_set_instrument, scdaw_set_808, scdaw_configure_fx, scdaw_apply_groove
  const setInstRes = await handleToolDispatch("scdaw_set_instrument", {
    trackId: "trk_bass",
    instrument: "cubed",
    params: { cutoff: 800 },
  });
  assert.ok(setInstRes.ok);
  assert.equal(setInstRes.instrument, "cubed");

  const set808Res = await handleToolDispatch("scdaw_set_808", {
    trackId: "trk_bass",
    glide: 240,
    decay: 2.0,
    harmonics: "grit",
  });
  assert.ok(set808Res.ok);
  assert.equal(set808Res.instrument, "808");

  const confFxRes = await handleToolDispatch("scdaw_configure_fx", {
    trackId: "trk_bass",
    action: "add",
    fxType: "maximizer",
    params: { threshold: -8 },
  });
  assert.ok(confFxRes.ok);
  assert.equal(confFxRes.fx.type, "maximizer");

  const grooveRes = await handleToolDispatch("scdaw_apply_groove", {
    trackId: "trk_bass",
    template: "mpc60",
    amount: 0.75,
  });
  assert.ok(grooveRes.ok);
  assert.equal(grooveRes.fx.template, "mpc60");

  const clearNotesRes = await handleToolDispatch(
    "scdaw_clear_project_notes",
    {},
  );
  assert.ok(clearNotesRes.ok);

  const resetRes = await handleToolDispatch("scdaw_reset", {
    scope: "project",
    template: "basic-beat",
  });
  assert.ok(resetRes.ok);
});

test("WebMCP adapter: registerNativeWebMcp registers all 40 tools into modelContext", async () => {
  const registered = [];
  globalThis.document = {
    modelContext: {
      registerTool: (tool) => {
        registered.push(tool);
        return Promise.resolve();
      },
    },
  };

  await registerNativeWebMcp();
  assert.equal(
    registered.length,
    40,
    "All 40 tools must be registered with WebMCP",
  );
  assert.ok(
    registered.some((t) => t.name === "scdaw_compose_song"),
    "scdaw_compose_song must be registered",
  );
  assert.ok(
    registered.some((t) => t.name === "scdaw_write_notes"),
    "scdaw_write_notes must be registered",
  );
  assert.ok(
    registered.some((t) => t.name === "scdaw_bounce"),
    "scdaw_bounce must be registered",
  );

  // Verify execution handler routes cleanly
  const composeTool = registered.find((t) => t.name === "scdaw_compose_song");
  assert.equal(typeof composeTool.execute, "function");

  delete globalThis.document;
});

test("WebMCP adapter: registerNativeWebMcp handles Duplicate tool name InvalidStateError cleanly", async () => {
  globalThis.document = {
    modelContext: {
      registerTool: () =>
        Promise.reject(new Error("Duplicate tool name 'scdaw_get_status'")),
    },
  };

  await assert.doesNotReject(async () => {
    await registerNativeWebMcp();
  });

  delete globalThis.document;
});
