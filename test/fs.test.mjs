import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  DEFAULT_GROUP_ID,
  DEFAULT_GROUP_NAME,
  LEGACY_OPFS_ROOT,
  LEGACY_DB_NAME,
  sanitizeGroupId,
  unsanitizeGroupId,
  getDeploymentNamespace,
  getOpfsRootName,
  getDbName,
  classifyFile,
  formatFileSize,
  getFileIcon,
  listConversations,
  listConversationFiles,
  readConversationFile,
  writeConversationFile,
  deleteConversationFile,
  setMockFsStorage,
  resetMockFsStorage,
} from "../.agents/scripts/scdaw-fs.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";

test("scdaw-fs: sanitizeGroupId & unsanitizeGroupId handles group identifiers cleanly", () => {
  assert.equal(sanitizeGroupId("br:main"), "br-main");
  assert.equal(sanitizeGroupId("br:session-01"), "br-session-01");
  assert.equal(sanitizeGroupId("server:main"), "server-main");
  assert.equal(sanitizeGroupId(""), "br-main");
  assert.equal(sanitizeGroupId(null), "br-main");

  assert.equal(unsanitizeGroupId("br-main"), "br:main");
  assert.equal(unsanitizeGroupId("br-session-01"), "br:session-01");
  assert.equal(unsanitizeGroupId("server-main"), "server:main");
  assert.equal(unsanitizeGroupId(""), DEFAULT_GROUP_ID);
});

test("scdaw-fs: classifyFile & getFileIcon identifies project and audio types accurately", () => {
  const jsonFile = classifyFile("my-song.scdaw.json");
  assert.equal(jsonFile.format, "scdaw-json");
  assert.equal(jsonFile.isProject, true);
  assert.equal(jsonFile.isAudio, false);
  assert.equal(getFileIcon("my-song.scdaw.json"), "📄");

  const dawprojFile = classifyFile("techno.dawproject");
  assert.equal(dawprojFile.format, "dawproject");
  assert.equal(dawprojFile.isProject, true);
  assert.equal(getFileIcon("techno.dawproject"), "📦");

  const midiFile = classifyFile("bassline.mid");
  assert.equal(midiFile.format, "midi");
  assert.equal(midiFile.isProject, true);
  assert.equal(getFileIcon("bassline.mid"), "🎼");

  const wavFile = classifyFile("mixdown.wav");
  assert.equal(wavFile.format, "wav");
  assert.equal(wavFile.isAudio, true);
  assert.equal(getFileIcon("mixdown.wav"), "🎵");

  const stemsFile = classifyFile("session-stems.zip");
  assert.equal(stemsFile.format, "stems");
  assert.equal(getFileIcon("session-stems.zip"), "🗂️");

  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(1572864), "1.5 MB");
});

test("scdaw-fs: listConversations defaults to Main conversation and sorts Main first", async () => {
  resetMockFsStorage();

  const initial = await listConversations();
  assert.ok(initial.length >= 1);
  assert.equal(initial[0].groupId, DEFAULT_GROUP_ID);
  assert.equal(initial[0].name, DEFAULT_GROUP_NAME);
  assert.equal(initial[0].isDefault, true);

  // Add multiple conversations to mock storage
  setMockFsStorage({
    conversations: [
      { groupId: "br:main", name: "Main" },
      { groupId: "br:ambient-session", name: "Ambient Pad Session" },
      { groupId: "br:acid-jam", name: "Acid 303 Jam" },
    ],
  });

  const updated = await listConversations();
  assert.equal(updated.length, 3);
  // Main must always be first
  assert.equal(updated[0].groupId, "br:main");
  assert.equal(updated[0].name, "Main");
  // Others sorted by name
  assert.equal(updated[1].name, "Acid 303 Jam");
  assert.equal(updated[2].name, "Ambient Pad Session");
});

test("scdaw-fs: writeConversationFile and readConversationFile supports saving and loading across any conversation", async () => {
  resetMockFsStorage();

  // 1. Save to default Main conversation
  const mainSave = await writeConversationFile(
    DEFAULT_GROUP_ID,
    "main-beat.scdaw.json",
    JSON.stringify({ name: "Main Beat", bpm: 124 }),
  );
  assert.equal(mainSave.ok, true);
  assert.equal(mainSave.name, "main-beat.scdaw.json");
  assert.equal(mainSave.groupId, DEFAULT_GROUP_ID);

  // 2. Save to another conversation
  const customGid = "br:ambient-session";
  const customSave = await writeConversationFile(
    customGid,
    "ambient-groove.scdaw.json",
    JSON.stringify({ name: "Ambient Groove", bpm: 90 }),
  );
  assert.equal(customSave.ok, true);
  assert.equal(customSave.name, "ambient-groove.scdaw.json");
  assert.equal(customSave.groupId, customGid);

  // 3. List files in Main conversation
  const mainFiles = await listConversationFiles(DEFAULT_GROUP_ID);
  assert.equal(mainFiles.length, 1);
  assert.equal(mainFiles[0].name, "main-beat.scdaw.json");
  assert.equal(mainFiles[0].format, "scdaw-json");

  // 4. List files in Custom conversation
  const customFiles = await listConversationFiles(customGid);
  assert.equal(customFiles.length, 1);
  assert.equal(customFiles[0].name, "ambient-groove.scdaw.json");

  // 5. Read back file from custom conversation
  const loaded = await readConversationFile(
    customGid,
    "ambient-groove.scdaw.json",
  );
  assert.equal(loaded.name, "ambient-groove.scdaw.json");
  const parsed = JSON.parse(loaded.text);
  assert.equal(parsed.name, "Ambient Groove");
  assert.equal(parsed.bpm, 90);

  // 6. Delete file
  await deleteConversationFile(customGid, "ambient-groove.scdaw.json");
  const remaining = await listConversationFiles(customGid);
  assert.equal(remaining.length, 0);
});

test("scdaw-engine: saveProject and loadProjectFromFs round-trip across conversations", async () => {
  resetMockFsStorage();

  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  // Mutate project tempo
  await engine.sendCommand("set_transport", { bpm: 135 });
  const p = engine.getProject();
  assert.equal(p.bpm, 135);

  // 1. Save project to Main conversation by default
  const saveMainResult = await engine.saveProject({
    filename: "techno-anthem.scdaw.json",
  });
  assert.equal(saveMainResult.ok, true);
  assert.equal(saveMainResult.conversationId, DEFAULT_GROUP_ID);

  // 2. Save project to custom conversation
  const customGid = "br:hiphop-lab";
  const saveCustomResult = await engine.saveProject({
    conversationId: customGid,
    filename: "boom-bap.scdaw.json",
  });
  assert.equal(saveCustomResult.ok, true);
  assert.equal(saveCustomResult.conversationId, customGid);

  // Verify files exist in their respective conversations
  const mainFiles = await engine.listConversationFiles(DEFAULT_GROUP_ID);
  assert.ok(mainFiles.some((f) => f.name === "techno-anthem.scdaw.json"));

  const customFiles = await engine.listConversationFiles(customGid);
  assert.ok(customFiles.some((f) => f.name === "boom-bap.scdaw.json"));

  // Change project to a blank project
  await engine.sendCommand("new_project", { template: "empty", bpm: 80 });
  assert.equal(engine.getProject().bpm, 80);

  // 3. Load project FROM custom conversation
  const loadResult = await engine.loadProjectFromFs({
    conversationId: customGid,
    filename: "boom-bap.scdaw.json",
  });
  assert.equal(loadResult.ok, true);
  assert.equal(engine.getProject().bpm, 135);

  // 4. Save and load DAWproject interchange format
  const dawprojSave = await engine.saveProject({
    conversationId: customGid,
    filename: "stems-session.dawproject",
    format: "dawproject",
  });
  assert.equal(dawprojSave.ok, true);
  assert.equal(dawprojSave.format, "dawproject");

  await engine.sendCommand("new_project", { template: "empty", bpm: 100 });
  assert.equal(engine.getProject().bpm, 100);

  const dawprojLoad = await engine.loadProjectFromFs({
    conversationId: customGid,
    filename: "stems-session.dawproject",
  });
  assert.equal(dawprojLoad.ok, true);
  assert.equal(engine.getProject().bpm, 135);
});

test("scdaw-engine: bounce, exportMidi, and bounceStems save to conversation OPFS files", async () => {
  resetMockFsStorage();

  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  const customGid = "br:stems-vault";

  // 1. Bounce audio mixdown to conversation files
  const bounceMeta = await engine.bounce({
    loops: 1,
    bitDepth: 24,
    conversationId: customGid,
    filename: "club-mix.wav",
    saveToWorkspace: false,
  });
  assert.ok(bounceMeta.bytes > 44);

  // 2. Export MIDI to conversation files
  const midiMeta = engine.exportMidi({
    loops: 1,
    conversationId: customGid,
    filename: "groove.mid",
    saveToWorkspace: false,
  });
  assert.ok(midiMeta.bytes > 0);

  // 3. Bounce stems to conversation files
  const stemsMeta = await engine.bounceStems({
    loops: 1,
    conversationId: customGid,
    filename: "track-stems.zip",
    saveToWorkspace: false,
  });
  assert.ok(stemsMeta.zipBytes > 0);

  // Verify all files present in the conversation
  const files = await engine.listConversationFiles(customGid);
  const names = files.map((f) => f.name);
  assert.ok(names.includes("club-mix.wav"));
  assert.ok(names.includes("groove.mid"));
  assert.ok(names.includes("track-stems.zip"));
});

test("scdaw-workbench UI: Save/Export dialog supports destination conversation selection & OPFS saving", async () => {
  const workbenchSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf-8",
  );

  // Export dialog has destination conversation dropdown
  assert.match(
    workbenchSrc,
    /<label[^>]+for=["']export-conversation-select["']/i,
    "Export dialog must have label for export-conversation-select",
  );
  assert.match(
    workbenchSrc,
    /<select[^>]+id=["']export-conversation-select["']/i,
    "Export dialog must have export-conversation-select dropdown",
  );

  // Export dialog has filename input
  assert.match(
    workbenchSrc,
    /<input[^>]+id=["']export-filename-input["']/i,
    "Export dialog must have export-filename-input",
  );

  // Export dialog has option to save to conversation files
  assert.match(
    workbenchSrc,
    /id=["']export-save-to-fs["']/i,
    "Export dialog must have export-save-to-fs checkbox",
  );
});

test("scdaw-workbench UI: Open/Load dialog allows loading FROM any conversation's files", async () => {
  const workbenchSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf-8",
  );

  // Open modal exists
  assert.match(
    workbenchSrc,
    /<dialog[^>]+id=["']import-modal["']/i,
    "Workbench must contain import-modal dialog",
  );

  // Source conversation selector
  assert.match(
    workbenchSrc,
    /<select[^>]+id=["']import-conversation-select["']/i,
    "Import dialog must have import-conversation-select dropdown",
  );

  // File list in selected conversation
  assert.match(
    workbenchSrc,
    /id=["']import-file-list["']/i,
    "Import dialog must render import-file-list container",
  );

  // Action buttons
  assert.match(
    workbenchSrc,
    /id=["']import-modal-submit["']/i,
    "Import dialog must have submit button to load selected file",
  );
  assert.match(
    workbenchSrc,
    /id=["']import-from-disk-btn["']/i,
    "Import dialog must offer option to load from disk as fallback",
  );
});

test("scdaw-browser UI: contains Files tab for browsing conversation files", async () => {
  const browserSrc = await fs.readFile(
    new URL("../.agents/scripts/components/scdaw-browser.js", import.meta.url),
    "utf-8",
  );

  // Browser has Files tab
  assert.match(
    browserSrc,
    /data-tab=["']files["']/i,
    "Browser must have Files tab button",
  );

  // Browser has conversation selector
  assert.match(
    browserSrc,
    /browser-conversation-select/i,
    "Browser Files tab must have conversation selector",
  );
});

test("scdaw-fs: resolves deployment namespace from <base href> and location pathname to match ShadowClaw OPFS root", () => {
  // Save originals
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;

  try {
    // 1. With explicit <base href="/shadow-claw-daw/">
    globalThis.window = {
      location: {
        pathname: "/shadow-claw-daw/pages/main/",
        origin: "https://xt-ml.github.io",
      },
    };
    globalThis.document = {
      querySelector: (selector) => {
        if (selector === "base[href]") {
          return {
            getAttribute: (attr) =>
              attr === "href" ? "/shadow-claw-daw/" : null,
          };
        }
        return null;
      },
    };

    assert.equal(getDeploymentNamespace(), "shadow-claw-daw");
    assert.equal(getOpfsRootName(), "shadowclaw-shadow-claw-daw");
    assert.equal(getDbName(), "shadowclaw-shadow-claw-daw");

    // 2. Without base tag but on subpath pathname
    globalThis.document = { querySelector: () => null };
    globalThis.window = {
      location: {
        pathname: "/shadow-claw-daw/index.html",
        origin: "https://xt-ml.github.io",
      },
    };
    assert.equal(getDeploymentNamespace(), "shadow-claw-daw");
    assert.equal(getOpfsRootName(), "shadowclaw-shadow-claw-daw");

    // 3. At root domain
    globalThis.window = {
      location: {
        pathname: "/pages/main/index.html",
        origin: "http://localhost:3000",
      },
    };
    assert.equal(getDeploymentNamespace(), "");
    assert.equal(getOpfsRootName(), LEGACY_OPFS_ROOT);
    assert.equal(getDbName(), LEGACY_DB_NAME);

    // 4. Explicit deploy id override takes highest priority
    globalThis.window = {
      __SHADOWCLAW_DEPLOY_ID__: "custom-deploy-site",
      location: {
        pathname: "/shadow-claw-daw/",
        origin: "https://example.com",
      },
    };
    assert.equal(getDeploymentNamespace(), "custom-deploy-site");
    assert.equal(getOpfsRootName(), "shadowclaw-custom-deploy-site");
  } finally {
    globalThis.window = origWindow;
    globalThis.document = origDocument;
  }
});

test("scdaw-fs: writeConversationFile falls back to worker-based sync access handle when main-thread writable stream is unavailable", async () => {
  const origNavigatorDesc = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const origWorker = globalThis.Worker;
  const origBlob = globalThis.Blob;
  const origURL = globalThis.URL;

  try {
    let workerSpawned = false;
    let workerPostMessagePayload = null;

    // Simulate environment where createWritable is unavailable (Safari / iOS / iPadOS)
    // and calling createSyncAccessHandle on the main thread throws
    const mockFileHandle = {
      createWritable: undefined,
      createSyncAccessHandle: () => {
        throw new Error(
          "createSyncAccessHandle is only allowed in dedicated workers",
        );
      },
    };

    const mockDirHandle = {
      getFileHandle: async () => mockFileHandle,
    };

    const mockGroupsDir = {
      getDirectoryHandle: async () => mockDirHandle,
    };

    const mockAppDir = {
      getDirectoryHandle: async () => mockGroupsDir,
    };

    const mockRoot = {
      getDirectoryHandle: async () => mockAppDir,
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        storage: {
          getDirectory: async () => mockRoot,
        },
      },
      configurable: true,
      writable: true,
    });

    // Mock Worker
    class MockWorker {
      constructor(scriptUrl) {
        workerSpawned = true;
        this.scriptUrl = scriptUrl;
        setTimeout(() => {
          if (this.onmessage) {
            this.onmessage({ data: { ok: true } });
          }
        }, 10);
      }
      postMessage(payload) {
        workerPostMessagePayload = payload;
      }
      terminate() {}
    }

    globalThis.Worker = MockWorker;
    globalThis.Blob = class {
      constructor(parts) {
        this.content = parts.join("");
      }
    };
    globalThis.URL = {
      createObjectURL: () => "blob:mock-worker",
      revokeObjectURL: () => {},
    };

    const writeResult = await writeConversationFile(
      "br:main",
      "test-export.wav",
      new Uint8Array([82, 73, 70, 70]),
    );

    assert.equal(writeResult.ok, true);
    assert.equal(
      workerSpawned,
      true,
      "Worker must be spawned for OPFS sync fallback",
    );
    assert.ok(workerPostMessagePayload, "Worker must receive message payload");
    assert.deepEqual(workerPostMessagePayload.pathSegments.slice(1), [
      "groups",
      "br-main",
      "test-export.wav",
    ]);
  } finally {
    if (origNavigatorDesc) {
      Object.defineProperty(globalThis, "navigator", origNavigatorDesc);
    } else {
      delete globalThis.navigator;
    }
    globalThis.Worker = origWorker;
    globalThis.Blob = origBlob;
    globalThis.URL = origURL;
  }
});
