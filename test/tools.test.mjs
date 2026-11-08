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

test("Tools: all 25 tools defined in manifest exist on disk and match schema", () => {
  assert.equal(TOOLS.length, 25);

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

  const resetRes = await handleToolDispatch("scdaw_reset", {
    scope: "project",
    template: "basic-beat",
  });
  assert.ok(resetRes.ok);
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
