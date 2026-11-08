import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SKILLS_DIR = resolve(ROOT, ".agents/skills");
const TOOLS_DIR = resolve(ROOT, ".agents/tools");
const INDEX_FILE = resolve(ROOT, ".well-known/agent-skills/index.json");

test("Skills: all skills have valid SKILL.md and tools exist", () => {
  const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  assert.ok(skillDirs.length >= 6);

  for (const skillName of skillDirs) {
    const skillMd = resolve(SKILLS_DIR, skillName, "SKILL.md");
    assert.ok(existsSync(skillMd), `Missing SKILL.md in ${skillName}`);

    const content = readFileSync(skillMd, "utf8");
    assert.ok(
      content.startsWith("---"),
      `${skillName} must start with YAML frontmatter`,
    );

    const endFm = content.indexOf("\n---", 3);
    assert.ok(endFm > 0, `${skillName} frontmatter must terminate with ---`);

    const fm = content.slice(3, endFm);
    assert.ok(fm.includes(`name: ${skillName}`));
    assert.ok(fm.includes("description:"));

    // Check allowed-tools references for domain tools (scdaw_*)
    const allowedMatch = fm.match(/allowed-tools:\s*(.+)/);
    if (allowedMatch) {
      const tools = allowedMatch[1].trim().split(/\s+/);
      for (const t of tools) {
        if (t.startsWith("scdaw_")) {
          const toolJson = resolve(TOOLS_DIR, `${t}.json`);
          assert.ok(
            existsSync(toolJson),
            `Referenced tool ${t}.json must exist for skill ${skillName}`,
          );
        }
      }
    }
  }

  // Check discovery index
  assert.ok(existsSync(INDEX_FILE), "Skills discovery index must exist");
  const index = JSON.parse(readFileSync(INDEX_FILE, "utf8"));
  assert.equal(
    index.$schema,
    "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  );
  assert.ok(index.skills.length >= 6);
});
