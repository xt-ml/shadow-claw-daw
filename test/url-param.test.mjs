import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  createProject,
  serializeProject,
  deserializeProject,
} from "../.agents/scripts/scdaw.js";
import {
  compressToBase64Url,
  decompressFromBase64Url,
} from "../.agents/scripts/scdaw-compress.js";
import {
  getBaseHref,
  createCompressedUrl,
  getCompressedParam,
  clearUrlParam,
} from "../.agents/scripts/scdaw-url-param.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("scdaw-compress: compresses and decompresses serialized .scdaw.json project", async () => {
  const project = createProject({ name: "Test Beat" });
  const jsonStr = JSON.stringify(JSON.parse(serializeProject(project)));

  const compressed = await compressToBase64Url(jsonStr);
  assert.ok(compressed.length > 0);
  assert.doesNotMatch(
    compressed,
    /[+/=]/,
    "Base64URL must not contain +, /, or =",
  );

  const decompressed = await decompressFromBase64Url(compressed);
  assert.equal(decompressed, jsonStr);

  const restored = deserializeProject(decompressed);
  assert.equal(restored.name, "Test Beat");
});

test("scdaw-url-param: createCompressedUrl defaults to #file= hash fragment to prevent HTTP 431", async () => {
  const project = createProject({ name: "Shared Song" });
  const jsonStr = JSON.stringify(JSON.parse(serializeProject(project)));

  const localBase = getBaseHref(null, {
    href: "http://localhost:8888/?old=1#hash",
  });
  assert.equal(localBase, "http://localhost:8888/");

  const shareUrl = await createCompressedUrl(localBase, jsonStr, {
    paramName: "file",
  });
  assert.ok(shareUrl.startsWith("http://localhost:8888/#file="));

  const extractedFromHash = await getCompressedParam("file", shareUrl);
  assert.equal(extractedFromHash, jsonStr);

  const legacyQueryUrl = await createCompressedUrl(localBase, jsonStr, {
    paramName: "file",
    useHash: false,
  });
  assert.ok(legacyQueryUrl.startsWith("http://localhost:8888/?file="));
  const extractedFromQuery = await getCompressedParam("file", legacyQueryUrl);
  assert.equal(extractedFromQuery, jsonStr);

  const ghBase = getBaseHref(
    {
      querySelector: () => ({
        href: "https://xt-ml.github.io/shadow-claw-daw",
      }),
    },
    { href: "https://xt-ml.github.io/shadow-claw-daw" },
  );
  const ghUrl = await createCompressedUrl(ghBase, jsonStr, {
    paramName: "file",
  });
  assert.ok(ghUrl.startsWith("https://xt-ml.github.io/shadow-claw-daw#file="));
});

test("scdaw-url-param: clearUrlParam removes file param from both search and hash", () => {
  let replacedWith = null;
  const origHistory = globalThis.history;
  globalThis.history = {
    replaceState: (_state, _title, url) => {
      replacedWith = url;
    },
  };

  try {
    const cleanedHash = clearUrlParam(
      "file",
      "http://localhost:8888/main/#file=abc123&other=1",
    );
    assert.equal(cleanedHash, "http://localhost:8888/main/#other=1");
    assert.equal(replacedWith, "/main/#other=1");

    const cleanedEmptyHash = clearUrlParam(
      "file",
      "http://localhost:8888/#file=abc123",
    );
    assert.equal(cleanedEmptyHash, "http://localhost:8888/");
    assert.equal(replacedWith, "/");

    const cleanedQuery = clearUrlParam(
      "file",
      "http://localhost:8888/main/?foo=bar&file=abc123",
    );
    assert.equal(cleanedQuery, "http://localhost:8888/main/?foo=bar");
    assert.equal(replacedWith, "/main/?foo=bar");
  } finally {
    globalThis.history = origHistory;
  }
});

test("scdaw-workbench: includes Press a URL button, #press-url-modal, and ?file/#file param loader", async () => {
  const workbenchPath = join(
    __dirname,
    "../.agents/scripts/components/scdaw-workbench.js",
  );
  const content = await readFile(workbenchPath, "utf8");

  assert.match(content, /id=["']export-modal-press-url["']/);
  assert.match(content, /<dialog[^>]+id=["']press-url-modal["']/);
  assert.match(content, /id=["']press-url-link["']/);
  assert.match(content, /_checkFileUrlParam\s*\(/);
  assert.match(content, /hashchange/);
});
