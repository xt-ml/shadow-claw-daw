import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

test("Pages: all routes mapped in routes.json exist and have valid metadata", () => {
  const routesPath = resolve(ROOT, "pages/resources/routes.json");
  assert.ok(existsSync(routesPath), "routes.json must exist");

  const routesData = JSON.parse(readFileSync(routesPath, "utf8"));
  const routes = routesData.routes || {};

  assert.ok(Object.keys(routes).length >= 8, "Must declare at least 8 routes");

  for (const [sourcePath, meta] of Object.entries(routes)) {
    const fullPath = resolve(ROOT, sourcePath.replace(/^\//, ""));
    assert.ok(
      existsSync(fullPath),
      `Mapped page file must exist on disk: ${sourcePath} (mapped to ${meta.prettyPath})`,
    );

    assert.ok(
      meta.prettyPath && meta.prettyPath.startsWith("/main/"),
      `prettyPath must start with /main/: ${meta.prettyPath}`,
    );

    const content = readFileSync(fullPath, "utf8");
    assert.ok(
      content.startsWith("---"),
      `Page ${sourcePath} must contain YAML frontmatter`,
    );
  }
});

test("PWA Manifest: start_url and share_target.action are within manifest scope", () => {
  const manifestPath = resolve(ROOT, "pages/resources/manifest.json");
  assert.ok(existsSync(manifestPath), "manifest.json must exist");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.scope, ".");
  assert.equal(manifest.name, "ShadowClaw DAW");
  assert.equal(manifest.short_name, "ShadowClaw DAW");

  // File Handlers API
  assert.ok(
    Array.isArray(manifest.file_handlers),
    "file_handlers must be an array",
  );
  assert.equal(manifest.file_handlers[0].action, "./");
  assert.ok(manifest.file_handlers[0].accept["audio/midi"].includes(".mid"));
  assert.ok(
    manifest.file_handlers[0].accept["application/vnd.dawproject+zip"].includes(
      ".dawproject",
    ),
  );
  assert.ok(
    manifest.file_handlers[0].accept["application/json"].includes(
      ".scdaw.json",
    ),
  );
});

test("Workbench scripts: shadow-claw.config.json declares scdaw custom element scripts", () => {
  const configPath = resolve(ROOT, "shadow-claw.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const scripts = config.customElements?.scripts || [];

  const elementScript = scripts.find((s) =>
    s.src?.includes("scdaw-element.js"),
  );
  const adapterScript = scripts.find((s) =>
    s.src?.includes("scdaw-adapter.js"),
  );

  assert.ok(
    elementScript,
    "scdaw-element.js must be in customElements.scripts",
  );
  assert.equal(elementScript.global, true);
  assert.equal(elementScript.autoload, true);

  assert.ok(
    adapterScript,
    "scdaw-adapter.js must be in customElements.scripts",
  );
  assert.equal(adapterScript.global, true);
  assert.equal(adapterScript.autoload, true);
  assert.equal(adapterScript.hasInit, true);

  assert.equal(config.settings?.assistantName, "ShadowClaw DAW");
  assert.equal(config.branding?.titleText, "ShadowClaw DAW");
  assert.equal(config.site?.title, "ShadowClaw DAW");
  assert.equal(config.pages?.defaultPinnedPage, "/pages/main/index.html");
});

test("Pages: main index.html hosts scdaw-workbench directly as the root DAW without intermediate portal", () => {
  const indexPath = resolve(ROOT, "pages/main/index.html");
  assert.ok(existsSync(indexPath), "pages/main/index.html must exist");

  const indexContent = readFileSync(indexPath, "utf8");
  assert.match(indexContent, /title:\s*["']ShadowClaw DAW["']/);
  assert.match(indexContent, /<scdaw-workbench><\/scdaw-workbench>/);
  assert.doesNotMatch(indexContent, /Launch Interactive Workbench/);
  assert.doesNotMatch(indexContent, /portal-container/);

  // scdaw.html is deprecated in favor of root index.html
  assert.equal(
    existsSync(resolve(ROOT, "pages/main/scdaw.html")),
    false,
    "pages/main/scdaw.html should be removed in favor of root index.html",
  );

  const routesPath = resolve(ROOT, "pages/resources/routes.json");
  const routesData = JSON.parse(readFileSync(routesPath, "utf8"));
  assert.equal(routesData.routes["/pages/main/scdaw.html"], undefined);
  assert.deepEqual(routesData.routes["/pages/main/index.html"], {
    prettyPath: "/main/",
  });

  const workbenchPath = resolve(
    ROOT,
    ".agents/scripts/components/scdaw-workbench.js",
  );
  const wbContent = readFileSync(workbenchPath, "utf8");
  assert.match(wbContent, /ShadowClaw DAW/);
  assert.match(wbContent, /Studio Workbench/);
  assert.doesNotMatch(wbContent, /AI Audio Workstation/);
  assert.doesNotMatch(wbContent, /Audio Workstation Workbench/);
});

test("Theme: pages/main/theme.css exists and declares design tokens", () => {
  const themePath = resolve(ROOT, "pages/main/theme.css");
  assert.ok(existsSync(themePath), "pages/main/theme.css must exist");

  const themeCss = readFileSync(themePath, "utf8");
  assert.ok(themeCss.includes("--md-sys-color-primary"));
});
