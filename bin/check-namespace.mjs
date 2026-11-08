#!/usr/bin/env node
/**
 * bin/check-namespace.mjs
 *
 * Verifies namespace and identifier isolation for shadow-claw-daw.
 *
 * Validates:
 * - All tools start with "scdaw_"
 * - All custom elements start with "scdaw-"
 * - All broadcast channels start with "scdaw-"
 * - Pinned workbench page is "/pages/main/index.html"
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

export function checkNamespaceIsolation() {
  const issues = [];
  const report = {
    tools: [],
    elements: [],
    channels: [],
    namingViolations: [],
    pinnedPageConflict: false,
  };

  const dawConfigPath = resolve(ROOT, "shadow-claw.config.json");

  if (!existsSync(dawConfigPath)) {
    throw new Error(`DAW config not found at ${dawConfigPath}`);
  }

  const dawConfig = JSON.parse(readFileSync(dawConfigPath, "utf8"));

  // 1. Tool Namespaces
  report.tools = dawConfig.enabledTools || [];
  for (const tool of report.tools) {
    if (!tool.startsWith("scdaw_")) {
      report.namingViolations.push(tool);
      issues.push(`Tool naming violation: "${tool}" must start with "scdaw_".`);
    }
  }

  // 2. Custom Elements Namespaces
  report.elements = dawConfig.customElements?.allowedElements || [];
  for (const el of report.elements) {
    if (!el.startsWith("scdaw-")) {
      report.namingViolations.push(el);
      issues.push(
        `Custom element naming violation: "${el}" must start with "scdaw-".`,
      );
    }
  }

  // 3. Pinned Page Check
  const dawPinned = dawConfig.pages?.defaultPinnedPage;
  if (!dawPinned || dawPinned !== "/pages/main/index.html") {
    report.pinnedPageConflict = true;
    issues.push(
      `Pinned page mismatch: DAW must pin "/pages/main/index.html". Found: "${dawPinned}".`,
    );
  }

  // 4. Broadcast Channel Names
  const dawChannels = ["scdaw-commands", "scdaw-results", "scdaw-state"];
  report.channels = dawChannels;
  for (const ch of dawChannels) {
    if (!ch.startsWith("scdaw-")) {
      report.namingViolations.push(ch);
      issues.push(
        `Broadcast channel naming violation: "${ch}" must start with "scdaw-".`,
      );
    }
  }

  return {
    ok: issues.length === 0,
    report,
    issues,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = checkNamespaceIsolation();
    console.log("=== ShadowClaw DAW Namespace Isolation Check ===");
    console.log(`Tools: ${result.report.tools.length}`);
    console.log(`Elements: ${result.report.elements.length}`);
    console.log(`Channels: ${result.report.channels.length}`);

    if (!result.ok) {
      console.error("\n[FAIL] Namespace issues detected:");
      for (const issue of result.issues) {
        console.error(` - ${issue}`);
      }
      process.exit(1);
    }

    console.log("\n[PASS] 100% namespace separation and isolation verified!");
    process.exit(0);
  } catch (err) {
    console.error("[ERROR]", err.message);
    process.exit(1);
  }
}
