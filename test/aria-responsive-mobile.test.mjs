import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { DawEditorElement } from "../.agents/scripts/components/scdaw-editor.js";
import { DawSequencerElement } from "../.agents/scripts/components/scdaw-sequencer.js";
import { DawMixerElement } from "../.agents/scripts/components/scdaw-mixer.js";
import { DawBrowserElement } from "../.agents/scripts/components/scdaw-browser.js";
import { DawDevicesElement } from "../.agents/scripts/components/scdaw-devices.js";
import {
  SIGNATURE_PRESETS,
  calculateBpmDragValue,
} from "../.agents/scripts/components/scdaw-transport.js";
import {
  resolveWorkbenchResponsiveLayout,
  resolveWorkbenchButtonStates,
} from "../.agents/scripts/components/scdaw-workbench.js";

test("Transport: supports 20-300 BPM bounds, extended signature presets, coarse pointer touch targets, and ARIA", async () => {
  const src = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-transport.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(
    calculateBpmDragValue({ startY: 100, currentY: 500, startValue: 60 }),
    20,
  );
  assert.equal(
    calculateBpmDragValue({ startY: 100, currentY: -500, startValue: 120 }),
    300,
  );

  for (const sig of ["4/4", "3/4", "6/8", "12/8", "9/8", "2/4", "5/4", "7/8"]) {
    assert.ok(
      SIGNATURE_PRESETS.includes(sig),
      `Missing signature preset: ${sig}`,
    );
  }

  assert.match(
    src,
    /<input[^>]+id=["']bpm-input["'][^>]*min=["']20["'][^>]*max=["']300["']/,
  );
  assert.match(src, /@media\s*\(\s*pointer:\s*coarse\s*\)/);
});

test("Piano Roll (<scdaw-editor>): ARIA roles, keyboard accessibility, bar-start markers, and coarse touch targets", async () => {
  const src = await fs.readFile(
    new URL("../.agents/scripts/components/scdaw-editor.js", import.meta.url),
    "utf8",
  );

  assert.match(src, /@media\s*\(\s*pointer:\s*coarse\s*\)/);
  assert.match(src, /id=["']track-select["'][^>]*aria-label=/);
  assert.match(src, /class=["'][^"']*pr-key[^"']*["'][^>]*role=["']button["']/);
  assert.match(
    src,
    /class=["'][^"']*pr-cell[^"']*["'][^>]*role=["']button["']/,
  );
  assert.match(src, /aria-pressed=/);
  assert.match(
    src,
    /class=["'][^"']*vel-stalk[^"']*["'][^>]*role=["']slider["']/,
  );
  assert.match(src, /aria-valuemin=["']0["'][^>]*aria-valuemax=["']100["']/);
  assert.match(src, /bar-start/);
});

test("Step Sequencer (<scdaw-sequencer>): ARIA button cells, keyboard support, @supports fallback, and coarse touch targets", async () => {
  const src = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-sequencer.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    src,
    /@supports\s+not\s*\(\s*container-type:\s*inline-size\s*\)/,
  );
  assert.match(src, /@media\s*\(\s*pointer:\s*coarse\s*\)/);
  assert.match(
    src,
    /class=["'][^"']*seq-cell[^"']*["'][^>]*role=["']button["']/,
  );
  assert.match(src, /aria-pressed=/);
  assert.match(
    src,
    /role=["']region["'][^>]*aria-label=["'][^"']*Step Sequencer/i,
  );
});

test("Mixer (<scdaw-mixer>): ARIA labels on faders/reset/strips, @supports fallback, and coarse touch targets", async () => {
  const src = await fs.readFile(
    new URL("../.agents/scripts/components/scdaw-mixer.js", import.meta.url),
    "utf8",
  );

  assert.match(
    src,
    /@supports\s+not\s*\(\s*container-type:\s*inline-size\s*\)/,
  );
  assert.match(src, /@media\s*\(\s*pointer:\s*coarse\s*\)/);
  assert.match(src, /class=["'][^"']*track-vol["'][^>]*aria-label=/);
  assert.match(src, /id=["']master-fader["'][^>]*aria-label=/);
  assert.match(src, /class=["'][^"']*reset-track-btn["'][^>]*aria-label=/);
  assert.match(
    src,
    /role=["']region["'][^>]*aria-label=["'][^"']*Mixer Console/i,
  );
});

test("Browser & Devices (<scdaw-browser>, <scdaw-devices>): ARIA compliance, @supports fallback, and coarse touch targets", async () => {
  const [browserSrc, devicesSrc] = await Promise.all([
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-browser.js",
        import.meta.url,
      ),
      "utf8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-devices.js",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(browserSrc, /class=["']search-box["'][^>]*aria-label=/);
  assert.match(
    browserSrc,
    /class=["']browser-refresh-files-btn[^"']*["'][^>]*aria-label=/,
  );
  assert.match(browserSrc, /@media\s*\(\s*pointer:\s*coarse\s*\)/);

  assert.match(
    devicesSrc,
    /@container scdaw-devices\s*\(\s*min-width:\s*640px\s*\)/,
  );
  assert.match(
    devicesSrc,
    /@supports\s+not\s*\(\s*container-type:\s*inline-size\s*\)/,
  );
  assert.match(devicesSrc, /id=["']reset-device-btn["'][^>]*aria-label=/);
});

test("Workbench (<scdaw-workbench>): mobile browser-full view, keyboard file list, and touch targets", async () => {
  const workbenchSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf8",
  );

  const browserFull = resolveWorkbenchResponsiveLayout({
    containerWidth: 390,
    viewMode: "browser-full",
  });
  assert.equal(browserFull.isFullWidth, true);
  assert.equal(browserFull.activeFocus, "browser");
  assert.equal(browserFull.showBrowser, true);
  assert.equal(browserFull.showMixer, false);

  const btnStates = resolveWorkbenchButtonStates({
    viewMode: "browser-full",
    isMobile: true,
  });
  assert.equal(btnStates.browserFull.active, true);
  assert.equal(btnStates.studio.active, false);

  assert.match(workbenchSrc, /id=["']mode-browser-full-btn["']/);
  assert.match(workbenchSrc, /@media\s*\(\s*pointer:\s*coarse\s*\)/);
});
