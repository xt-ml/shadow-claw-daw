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

test("scdaw-workbench: confirmDialog resolves via explicit button clicks even without form returnValue", async () => {
  const { DawWorkbenchElement } =
    await import("../.agents/scripts/components/scdaw-workbench.js");

  function createMockDialog() {
    const listeners = new Map();
    const confirmListeners = [];
    const cancelListeners = [];
    const nativeDialog = {
      returnValue: "",
      open: false,
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = listeners.get(type) || [];
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      },
      close(val) {
        if (val !== undefined) this.returnValue = val;
        this.open = false;
        for (const fn of [...(listeners.get("close") || [])]) {
          fn();
        }
      },
    };
    const dialogWrapper = {
      dialog: nativeDialog,
      showModal() {
        nativeDialog.open = true;
      },
      close(val) {
        nativeDialog.close(val);
      },
    };
    const confirmBtn = {
      textContent: "",
      className: "",
      style: {},
      addEventListener(type, fn) {
        if (type === "click") confirmListeners.push(fn);
      },
      removeEventListener(type, fn) {
        const idx = confirmListeners.indexOf(fn);
        if (idx >= 0) confirmListeners.splice(idx, 1);
      },
      click() {
        // Simulate Android WebView where <form method="dialog"> does NOT set returnValue
        for (const fn of [...confirmListeners]) {
          fn({ preventDefault() {} });
        }
      },
    };
    const cancelBtn = {
      textContent: "",
      addEventListener(type, fn) {
        if (type === "click") cancelListeners.push(fn);
      },
      removeEventListener(type, fn) {
        const idx = cancelListeners.indexOf(fn);
        if (idx >= 0) cancelListeners.splice(idx, 1);
      },
      click() {
        for (const fn of [...cancelListeners]) {
          fn({ preventDefault() {} });
        }
      },
    };
    const titleEl = { textContent: "" };
    const msgEl = { textContent: "" };
    const fakeThis = {
      shadowRoot: {
        getElementById(id) {
          if (id === "confirm-dialog") return dialogWrapper;
          if (id === "confirm-dialog-title") return titleEl;
          if (id === "confirm-dialog-message") return msgEl;
          if (id === "confirm-dialog-confirm") return confirmBtn;
          if (id === "confirm-dialog-cancel") return cancelBtn;
          return null;
        },
      },
    };
    return { fakeThis, confirmBtn, cancelBtn, nativeDialog };
  }

  const { fakeThis, confirmBtn, cancelBtn } = createMockDialog();
  const p1 = DawWorkbenchElement.prototype.confirmDialog.call(fakeThis, {
    title: "Load Song from URL",
    message: "Load?",
    confirmText: "Load Song",
    cancelText: "Cancel",
  });
  confirmBtn.click();
  assert.equal(await p1, true);

  const p2 = DawWorkbenchElement.prototype.confirmDialog.call(fakeThis, {
    title: "Load Song from URL",
    message: "Load?",
    confirmText: "Load Song",
    cancelText: "Cancel",
  });
  cancelBtn.click();
  assert.equal(await p2, false);
});

test("scdaw-workbench: _checkFileUrlParam guards re-entrancy and handles import errors gracefully", async () => {
  const workbenchPath = join(
    __dirname,
    "../.agents/scripts/components/scdaw-workbench.js",
  );
  const content = await readFile(workbenchPath, "utf8");

  assert.match(content, /_checkingFileUrlParam/);
  assert.match(
    content,
    /try\s*\{[\s\S]*?importProjectFile\(jsonStr\)[\s\S]*?\}\s*catch/,
  );
});
