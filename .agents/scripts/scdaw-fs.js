/**
 * .agents/scripts/scdaw-fs.js
 *
 * ShadowClaw File System & OPFS (Origin Private File System) integration for Daw.
 * Provides conversation discovery, file listing, file reading, and saving to any
 * conversation's workspace in ShadowClaw storage.
 *
 * Directory hierarchy in OPFS:
 *   [opfsRoot] / [shadowclaw | shadowclaw-<namespace>] / groups / <safeGroupId> / <filename>
 *   where safeGroupId = groupId.replace(/:/g, "-")
 *   Default groupId: "br:main" -> folder "br-main"
 */

export const DEFAULT_GROUP_ID = "br:main";
export const DEFAULT_GROUP_NAME = "Main";
export const LEGACY_OPFS_ROOT = "shadowclaw";
export const LEGACY_DB_NAME = "shadowclaw";

// In-memory fallback / mock store for environments without native OPFS (e.g. Node.js unit tests)
const mockGroups = new Map([
  [
    DEFAULT_GROUP_ID,
    {
      groupId: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_NAME,
      createdAt: 0,
      isDefault: true,
    },
  ],
]);

// Map<safeGroupId, Map<filename, { name, data: Uint8Array, size, lastModified }>>
const mockFiles = new Map();

let forceMockStorage = false;

/**
 * Configure or reset mock storage for testing.
 */
export function setMockFsStorage(options = {}) {
  if (options.clearAll) {
    mockGroups.clear();
    mockFiles.clear();
    mockGroups.set(DEFAULT_GROUP_ID, {
      groupId: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_NAME,
      createdAt: 0,
      isDefault: true,
    });
  }

  if (Array.isArray(options.conversations)) {
    for (const group of options.conversations) {
      const gid = group.groupId || DEFAULT_GROUP_ID;
      mockGroups.set(gid, {
        groupId: gid,
        name: group.name || gid,
        createdAt: group.createdAt || Date.now(),
        isDefault: gid === DEFAULT_GROUP_ID,
      });
    }
  }

  if (options.files && typeof options.files === "object") {
    for (const [gid, files] of Object.entries(options.files)) {
      const safeId = sanitizeGroupId(gid);
      if (!mockFiles.has(safeId)) {
        mockFiles.set(safeId, new Map());
      }
      const dirMap = mockFiles.get(safeId);
      for (const [fname, content] of Object.entries(files)) {
        let u8;
        if (typeof content === "string") {
          u8 = new TextEncoder().encode(content);
        } else if (content instanceof Uint8Array) {
          u8 = content;
        } else if (content instanceof ArrayBuffer) {
          u8 = new Uint8Array(content);
        } else {
          u8 = new Uint8Array(0);
        }
        dirMap.set(fname, {
          name: fname,
          data: u8,
          size: u8.byteLength,
          lastModified: Date.now(),
        });
      }
    }
  }

  if (typeof options.forceMock === "boolean") {
    forceMockStorage = options.forceMock;
  }
}

export function resetMockFsStorage() {
  forceMockStorage = false;
  mockGroups.clear();
  mockFiles.clear();
  mockGroups.set(DEFAULT_GROUP_ID, {
    groupId: DEFAULT_GROUP_ID,
    name: DEFAULT_GROUP_NAME,
    createdAt: 0,
    isDefault: true,
  });
}

/**
 * Sanitize a groupId for directory naming by replacing colons with dashes.
 * Example: "br:main" -> "br-main"
 */
export function sanitizeGroupId(groupId) {
  if (!groupId || typeof groupId !== "string") return "br-main";
  return groupId.trim().replace(/:/g, "-");
}

/**
 * Reconstruct a probable groupId from a sanitized directory name.
 * Example: "br-main" -> "br:main"
 */
export function unsanitizeGroupId(safeId) {
  if (!safeId || typeof safeId !== "string") return DEFAULT_GROUP_ID;
  if (safeId.startsWith("br-")) {
    return `br:${safeId.slice(3)}`;
  }
  if (safeId.startsWith("server-")) {
    return `server:${safeId.slice(7)}`;
  }
  if (safeId.startsWith("peer-")) {
    return `peer:${safeId.slice(5)}`;
  }
  if (safeId.startsWith("room-")) {
    return `room:${safeId.slice(5)}`;
  }
  return safeId;
}

/**
 * Detect current deployment namespace from global scope or URL.
 */
export function getDeploymentNamespace() {
  const globalObj =
    typeof window !== "undefined"
      ? window
      : typeof self !== "undefined"
        ? self
        : globalThis;

  if (globalObj && globalObj.__SHADOWCLAW_DEPLOY_ID__) {
    const customId = String(globalObj.__SHADOWCLAW_DEPLOY_ID__).trim();
    if (customId) return customId.replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  const proc = (globalThis || {}).process;
  if (proc && proc.env && proc.env.SHADOWCLAW_DEPLOY_ID) {
    const envId = String(proc.env.SHADOWCLAW_DEPLOY_ID).trim();
    if (envId) return envId.replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  return "";
}

/**
 * Get active OPFS root directory name.
 */
export function getOpfsRootName() {
  const ns = getDeploymentNamespace();
  return ns ? `shadowclaw-${ns}` : LEGACY_OPFS_ROOT;
}

/**
 * Get active IndexedDB database name.
 */
export function getDbName() {
  const ns = getDeploymentNamespace();
  return ns ? `shadowclaw-${ns}` : LEGACY_DB_NAME;
}

/**
 * Check whether native OPFS is supported in current execution environment.
 */
export function isOpfsAvailable() {
  if (forceMockStorage) return false;
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.storage) &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/**
 * Get OPFS groups directory handle.
 */
async function getOpfsGroupsDirectory(create = true) {
  if (!isOpfsAvailable()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const primaryName = getOpfsRootName();
    let appDir = null;

    try {
      appDir = await root.getDirectoryHandle(primaryName, { create });
    } catch (_) {
      // Fallback to legacy unnamespaced directory name
      if (primaryName !== LEGACY_OPFS_ROOT) {
        appDir = await root.getDirectoryHandle(LEGACY_OPFS_ROOT, { create });
      }
    }

    if (!appDir) return null;
    return await appDir.getDirectoryHandle("groups", { create });
  } catch (err) {
    console.warn("Unable to access OPFS groups directory:", err);
    return null;
  }
}

/**
 * Fetch group metadata from ShadowClaw IndexedDB if present.
 */
async function queryIdbGroupMetadata() {
  if (typeof indexedDB === "undefined") return [];

  const dbNamesToTry = [getDbName()];
  if (getDbName() !== LEGACY_DB_NAME) {
    dbNamesToTry.push(LEGACY_DB_NAME);
  }

  for (const dbName of dbNamesToTry) {
    try {
      const db = await new Promise((resolve) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      });

      if (!db) continue;

      if (!db.objectStoreNames.contains("config")) {
        db.close();
        continue;
      }

      const result = await new Promise((resolve) => {
        try {
          const tx = db.transaction("config", "readonly");
          const store = tx.objectStore("config");
          const req = store.get("group_metadata");
          req.onsuccess = () => resolve(req.result?.value || null);
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });

      db.close();

      if (result) {
        const parsed = JSON.parse(result);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (_) {}
  }

  return [];
}

/**
 * List all conversations available in ShadowClaw storage.
 * Defaults to Main conversation if no others exist.
 */
export async function listConversations() {
  const conversationsMap = new Map();

  // 1. Always ensure Main is present
  conversationsMap.set(DEFAULT_GROUP_ID, {
    groupId: DEFAULT_GROUP_ID,
    name: DEFAULT_GROUP_NAME,
    isDefault: true,
  });

  // 2. Query IndexedDB group metadata
  try {
    const idbGroups = await queryIdbGroupMetadata();
    for (const g of idbGroups) {
      if (g && g.groupId) {
        conversationsMap.set(g.groupId, {
          groupId: g.groupId,
          name:
            g.name ||
            (g.groupId === DEFAULT_GROUP_ID ? DEFAULT_GROUP_NAME : g.groupId),
          createdAt: g.createdAt || 0,
          isDefault: g.groupId === DEFAULT_GROUP_ID,
        });
      }
    }
  } catch (_) {}

  // 3. Inspect OPFS groups directory for any on-disk conversation directories
  if (isOpfsAvailable()) {
    try {
      const groupsDir = await getOpfsGroupsDirectory(false);
      if (groupsDir) {
        for await (const [safeName, handle] of groupsDir.entries()) {
          if (handle.kind === "directory") {
            const reconstructedId = unsanitizeGroupId(safeName);
            if (!conversationsMap.has(reconstructedId)) {
              const displayName =
                safeName === "br-main"
                  ? DEFAULT_GROUP_NAME
                  : safeName.startsWith("br-")
                    ? `Conversation (${safeName.slice(3, 11)})`
                    : safeName;

              conversationsMap.set(reconstructedId, {
                groupId: reconstructedId,
                name: displayName,
                isDefault: reconstructedId === DEFAULT_GROUP_ID,
              });
            }
          }
        }
      }
    } catch (_) {}
  }

  // 4. Merge mock storage entries (if set)
  for (const [gid, g] of mockGroups.entries()) {
    if (!conversationsMap.has(gid)) {
      conversationsMap.set(gid, g);
    }
  }

  const list = Array.from(conversationsMap.values());

  // Sort: Main first, followed by custom conversations
  list.sort((a, b) => {
    if (a.groupId === DEFAULT_GROUP_ID) return -1;
    if (b.groupId === DEFAULT_GROUP_ID) return 1;
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Get conversation directory handle in OPFS.
 */
export async function getConversationDirHandle(
  groupId = DEFAULT_GROUP_ID,
  { create = false } = {},
) {
  const safeId = sanitizeGroupId(groupId);

  if (!isOpfsAvailable()) {
    return null;
  }

  const groupsDir = await getOpfsGroupsDirectory(create);
  if (!groupsDir) return null;

  try {
    return await groupsDir.getDirectoryHandle(safeId, { create });
  } catch (err) {
    if (create) throw err;
    return null;
  }
}

/**
 * Helper to classify file extensions and format.
 */
export function classifyFile(filename) {
  const lower = String(filename || "").toLowerCase();
  let format = "other";
  let isProject = false;
  let isAudio = false;

  if (lower.endsWith(".scdaw.json") || lower.endsWith(".json")) {
    format = "scdaw-json";
    isProject = true;
  } else if (lower.endsWith(".dawproject")) {
    format = "dawproject";
    isProject = true;
  } else if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
    format = "midi";
    isProject = true;
  } else if (lower.endsWith(".wav") || lower.endsWith(".wave")) {
    format = "wav";
    isAudio = true;
  } else if (lower.endsWith(".zip")) {
    format = lower.includes("stems") ? "stems" : "zip";
  }

  return { format, isProject, isAudio };
}

/**
 * Format bytes into human readable string.
 */
export function formatFileSize(bytes) {
  if (typeof bytes !== "number" || isNaN(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get suitable icon for file name.
 */
export function getFileIcon(filename) {
  const { format, isAudio } = classifyFile(filename);
  if (format === "scdaw-json") return "📄";
  if (format === "dawproject") return "📦";
  if (format === "midi") return "🎼";
  if (isAudio) return "🎵";
  if (format === "stems") return "🗂️";
  return "📁";
}

/**
 * List files in a specified conversation's workspace.
 */
export async function listConversationFiles(groupId = DEFAULT_GROUP_ID) {
  const safeId = sanitizeGroupId(groupId);
  const files = [];

  // Check mock store first if OPFS is not available
  if (!isOpfsAvailable()) {
    const dirMap = mockFiles.get(safeId);
    if (dirMap) {
      for (const item of dirMap.values()) {
        const { format, isProject, isAudio } = classifyFile(item.name);
        files.push({
          name: item.name,
          size: item.size,
          lastModified: item.lastModified || Date.now(),
          format,
          isProject,
          isAudio,
        });
      }
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  try {
    const dirHandle = await getConversationDirHandle(groupId, {
      create: false,
    });
    if (!dirHandle) return [];

    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "file") {
        try {
          const file = await handle.getFile();
          const { format, isProject, isAudio } = classifyFile(name);
          files.push({
            name,
            size: file.size,
            lastModified: file.lastModified,
            format,
            isProject,
            isAudio,
          });
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn(`Failed to list files for conversation ${groupId}:`, err);
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read a file from a specified conversation's workspace.
 */
export async function readConversationFile(
  groupId = DEFAULT_GROUP_ID,
  filename,
) {
  if (!filename) throw new Error("readConversationFile requires filename");
  const safeId = sanitizeGroupId(groupId);

  if (!isOpfsAvailable()) {
    const dirMap = mockFiles.get(safeId);
    const item = dirMap?.get(filename);
    if (!item) {
      throw new Error(
        `File "${filename}" not found in conversation "${groupId}"`,
      );
    }
    const uint8Array = item.data;
    const buffer = uint8Array.buffer.slice(
      uint8Array.byteOffset,
      uint8Array.byteOffset + uint8Array.byteLength,
    );
    const text = new TextDecoder("utf-8").decode(uint8Array);
    const { format, isProject, isAudio } = classifyFile(filename);

    return {
      name: filename,
      size: item.size,
      lastModified: item.lastModified,
      buffer,
      uint8Array,
      text,
      format,
      isProject,
      isAudio,
    };
  }

  const dirHandle = await getConversationDirHandle(groupId, { create: false });
  if (!dirHandle) {
    throw new Error(`Conversation directory "${safeId}" not found in storage.`);
  }

  const fileHandle = await dirHandle.getFileHandle(filename, { create: false });
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8").decode(uint8Array);
  const { format, isProject, isAudio } = classifyFile(filename);

  return {
    name: filename,
    size: file.size,
    lastModified: file.lastModified,
    buffer,
    uint8Array,
    text,
    format,
    isProject,
    isAudio,
  };
}

/**
 * Write a file to a specified conversation's workspace in OPFS.
 */
export async function writeConversationFile(
  groupId = DEFAULT_GROUP_ID,
  filename,
  content,
  options = {},
) {
  if (!filename) throw new Error("writeConversationFile requires filename");
  const safeId = sanitizeGroupId(groupId);

  let u8;
  if (typeof content === "string") {
    u8 = new TextEncoder().encode(content);
  } else if (content instanceof Uint8Array) {
    u8 = content;
  } else if (content instanceof ArrayBuffer) {
    u8 = new Uint8Array(content);
  } else if (typeof Blob !== "undefined" && content instanceof Blob) {
    const buf = await content.arrayBuffer();
    u8 = new Uint8Array(buf);
  } else {
    u8 = new Uint8Array(0);
  }

  if (!isOpfsAvailable()) {
    if (!mockFiles.has(safeId)) {
      mockFiles.set(safeId, new Map());
    }
    const dirMap = mockFiles.get(safeId);
    dirMap.set(filename, {
      name: filename,
      data: u8,
      size: u8.byteLength,
      lastModified: Date.now(),
    });

    return {
      ok: true,
      name: filename,
      bytes: u8.byteLength,
      groupId,
      path: `groups/${safeId}/${filename}`,
      storageType: "memory",
    };
  }

  const dirHandle = await getConversationDirHandle(groupId, { create: true });
  if (!dirHandle) {
    throw new Error(
      `Failed to create/access OPFS directory for conversation ${groupId}`,
    );
  }

  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });

  if (typeof fileHandle.createWritable === "function") {
    const writable = await fileHandle.createWritable();
    await writable.write(u8);
    await writable.close();
  } else if (typeof fileHandle.createSyncAccessHandle === "function") {
    const syncHandle = await fileHandle.createSyncAccessHandle();
    try {
      syncHandle.truncate(0);
      syncHandle.write(u8, { at: 0 });
      if (typeof syncHandle.flush === "function") {
        syncHandle.flush();
      }
    } finally {
      syncHandle.close();
    }
  } else {
    throw new Error(
      "No writable stream or sync handle available on file handle.",
    );
  }

  return {
    ok: true,
    name: filename,
    bytes: u8.byteLength,
    groupId,
    path: `groups/${safeId}/${filename}`,
    storageType: "opfs",
  };
}

/**
 * Delete a file from a specified conversation's workspace.
 */
export async function deleteConversationFile(
  groupId = DEFAULT_GROUP_ID,
  filename,
) {
  if (!filename) throw new Error("deleteConversationFile requires filename");
  const safeId = sanitizeGroupId(groupId);

  if (!isOpfsAvailable()) {
    const dirMap = mockFiles.get(safeId);
    if (dirMap) {
      dirMap.delete(filename);
    }
    return { ok: true, name: filename, groupId };
  }

  const dirHandle = await getConversationDirHandle(groupId, { create: false });
  if (dirHandle) {
    await dirHandle.removeEntry(filename);
  }
  return { ok: true, name: filename, groupId };
}
