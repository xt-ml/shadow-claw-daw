import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHADOW_CLAW_LOBSTER_HASHES = new Set([
  "33a5914fdb9b42c622ceb4bdfd421d7c8792ce3809a10acc83dd356a975c1f66", // 48.png
  "a48ba6e50b2f8c54ee08480cb131365372757e9677e71fb09996395e3dacc086", // 72.png
  "1c7002983e6a36a309914466acf7aa98044b95e7fb940c17a03189638aa54a1d", // 96.png
  "4c1f774f8df852836dfbac0ac9400f0ae9fe9d3f340379f7588dbfee599c8e59", // 128.png
  "7d8bb2f52284861d86f389820f887c9b804e15f347cc3b38777612abc3c37e1f", // 152.png
  "9898621a296cc836d79a2b8881fe126bd73823eb53a8fbabbb9a0761e0280cc4", // 180.png
  "46fe87f35e8d62257eda46149045bad8edd8e382d22f0df92a4a635e0286e8a0", // 192.png
  "02c2881dbb68aa86e5e499c38c893386c1af4f048d557438987b7c2e7286eace", // 512.png
  "423e9e930bd88b9e7f28087b1a1a26e55f6c75426996d10172596e939833f5f2", // 1024.png
  "035f49ba449226300ac237220e8a5ed0472ea77885dee63a978f3db35128adda", // favicon.ico
  "8aa7e215fa7ebe34bb5a12f1842f75caa365659733c460caa42d038afe25911b", // shadow-claw-screenshot-1920x1052.png
  "7997952cc418887610d1d24d3306805ccf028d9b6f73740d456042eb0592f5e9", // shadow-claw-screenshot-731x1045.png
]);

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

test("Documentation: README.md, AGENTS.md, and pages/main docs are up to date and free of deprecated references", () => {
  const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
  const agents = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");
  const memory = readFileSync(resolve(ROOT, "pages/main/MEMORY.md"), "utf8");
  const workbenchDoc = readFileSync(
    resolve(ROOT, "pages/main/~/content/04-workbench.md"),
    "utf8",
  );
  const troubleshootingDoc = readFileSync(
    resolve(ROOT, "pages/main/~/content/06-troubleshooting.md"),
    "utf8",
  );

  // Must document 25 declarative tools and 11 custom elements
  assert.match(readme, /25 declarative `scdaw_\*` WebMCP tools/);
  assert.match(agents, /25 declarative tools/);

  // Must not reference deprecated scdaw.html or shadow-claw-template
  for (const [name, text] of [
    ["README.md", readme],
    ["AGENTS.md", agents],
    ["pages/main/MEMORY.md", memory],
    ["04-workbench.md", workbenchDoc],
    ["06-troubleshooting.md", troubleshootingDoc],
  ]) {
    assert.doesNotMatch(
      text,
      /scdaw\.html/,
      `${name} should reference index.html (/main/), not deprecated scdaw.html`,
    );
    assert.doesNotMatch(
      text,
      /shadow-claw-template/,
      `${name} should not contain leftover shadow-claw-template boilerplate`,
    );
  }

  // Leftover template 01-about.md must not exist
  assert.equal(
    existsSync(resolve(ROOT, "pages/main/~/content/01-about.md")),
    false,
    "Boilerplate 01-about.md should be removed",
  );
});

test("Iconography & PWA Manifest: all icons and screenshots are template-specific (no ShadowClaw lobster defaults) and appleTouchIconPath points to raster PNG", () => {
  const config = JSON.parse(
    readFileSync(resolve(ROOT, "shadow-claw.config.json"), "utf8"),
  );
  assert.equal(
    config.branding?.faviconPath,
    "assets/icons/favicon.svg",
    "faviconPath must be assets/icons/favicon.svg",
  );
  assert.equal(
    config.branding?.appleTouchIconPath,
    "assets/icons/180.png",
    "appleTouchIconPath must point to raster PNG (assets/icons/180.png) for iOS Home Screen support",
  );

  const manifest = JSON.parse(
    readFileSync(resolve(ROOT, "pages/resources/manifest.json"), "utf8"),
  );
  assert.notEqual(manifest.id, "shadow-claw");
  const iconSrcs = (manifest.icons || []).map((i) => i.src);
  assert.ok(
    !iconSrcs.includes("assets/icons/favicon.svg"),
    "manifest.icons must not include SVG favicon (avoids Chrome DevTools image decode failure)",
  );
  assert.ok(
    iconSrcs.includes("assets/icons/180.png"),
    "manifest.icons must include assets/icons/180.png",
  );
  assert.ok(
    iconSrcs.includes("assets/icons/192.png"),
    "manifest.icons must include assets/icons/192.png",
  );
  assert.ok(
    iconSrcs.includes("assets/icons/512.png"),
    "manifest.icons must include assets/icons/512.png",
  );

  // Screenshots: must include both wide (desktop) and narrow (mobile) for Richer PWA Install UI
  const screenshots = manifest.screenshots || [];
  assert.ok(
    screenshots.some((s) => s.form_factor === "wide"),
    "manifest.screenshots must include a wide screenshot for desktop Richer PWA Install UI",
  );
  assert.ok(
    screenshots.some((s) => s.form_factor === "narrow" || !s.form_factor),
    "manifest.screenshots must include a narrow/mobile screenshot for mobile Richer PWA Install UI",
  );

  const faviconSvgContent = readFileSync(
    resolve(ROOT, "pages/resources/assets/icons/favicon.svg"),
    "utf8",
  );
  assert.ok(
    faviconSvgContent.includes("M10 20V12M14 24V8"),
    "favicon.svg must contain DAW waveform paths, not LightMeter photon sun",
  );

  const requiredIcons = [
    "favicon.svg",
    "favicon.ico",
    "apple-touch-icon.png",
    "48.png",
    "72.png",
    "96.png",
    "128.png",
    "152.png",
    "180.png",
    "192.png",
    "512.png",
    "1024.png",
  ];
  for (const file of requiredIcons) {
    const iconPath = resolve(ROOT, "pages/resources/assets/icons", file);
    assert.ok(existsSync(iconPath), `Missing icon file: ${file}`);
    const hash = createHash("sha256")
      .update(readFileSync(iconPath))
      .digest("hex");
    assert.equal(
      SHADOW_CLAW_LOBSTER_HASHES.has(hash),
      false,
      `Icon ${file} must be template-specific and not match ShadowClaw default red lobster icon`,
    );
  }

  for (const screen of manifest.screenshots || []) {
    const screenPath = resolve(ROOT, "pages/resources", screen.src);
    assert.ok(
      existsSync(screenPath),
      `Missing manifest screenshot: ${screen.src}`,
    );
    const hash = createHash("sha256")
      .update(readFileSync(screenPath))
      .digest("hex");
    assert.equal(
      SHADOW_CLAW_LOBSTER_HASHES.has(hash),
      false,
      `Screenshot ${screen.src} must be template-specific and not match ShadowClaw default screenshot`,
    );
  }
});
