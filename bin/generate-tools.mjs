#!/usr/bin/env node
/**
 * bin/generate-tools.mjs
 *
 * Generates .agents/tools/*.json declarative tool definitions from bin/tool-manifest.mjs.
 * Supports --check flag for CI verification.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "./tool-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TOOLS_DIR = resolve(ROOT, ".agents/tools");

const isCheck = process.argv.includes("--check");

if (!existsSync(TOOLS_DIR)) {
  mkdirSync(TOOLS_DIR, { recursive: true });
}

let driftCount = 0;

for (const tool of TOOLS) {
  const filePath = resolve(TOOLS_DIR, `${tool.name}.json`);
  const content =
    JSON.stringify(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        ...tool,
      },
      null,
      2,
    ) + "\n";

  if (isCheck) {
    if (!existsSync(filePath)) {
      console.error(`[DRIFT] Missing tool file: ${tool.name}.json`);
      driftCount++;
    } else {
      const existing = readFileSync(filePath, "utf8");
      try {
        const existingObj = JSON.parse(existing);
        const expectedObj = JSON.parse(content);
        if (JSON.stringify(existingObj) !== JSON.stringify(expectedObj)) {
          console.error(`[DRIFT] Content mismatch in: ${tool.name}.json`);
          driftCount++;
        }
      } catch {
        console.error(`[DRIFT] Invalid JSON in: ${tool.name}.json`);
        driftCount++;
      }
    }
  } else {
    writeFileSync(filePath, content, "utf8");
    console.log(`[GEN] Generated .agents/tools/${tool.name}.json`);
  }
}

const metadataPath = resolve(ROOT, ".agents/scripts/scdaw-tools-metadata.js");
const metadataContent = `/**
 * .agents/scripts/scdaw-tools-metadata.js
 *
 * Generated automatically from bin/tool-manifest.mjs via bin/generate-tools.mjs.
 * Exposes declarative tool definitions to the WebMCP browser adapter.
 */

export const TOOLS_METADATA = ${JSON.stringify(
  TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
    annotations: t.annotations,
  })),
  null,
  2,
)};
`;

if (!isCheck) {
  writeFileSync(metadataPath, metadataContent, "utf8");
  console.log(`[GEN] Generated .agents/scripts/scdaw-tools-metadata.js`);
}

if (isCheck) {
  if (driftCount > 0) {
    console.error(
      `\n[FAIL] Found ${driftCount} drifted or missing tool definitions. Run "npm run build:tools".`,
    );
    process.exit(1);
  }
  console.log(`[PASS] All ${TOOLS.length} declarative tools are up to date.`);
} else {
  console.log(
    `\n[OK] Successfully wrote ${TOOLS.length} tool definitions to .agents/tools/`,
  );
}
