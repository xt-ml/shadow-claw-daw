/**
 * .agents/scripts/shadow-claw-daw-fs.js
 *
 * ShadowClaw File System & OPFS (Origin Private File System) integration for ShadowClaw DAW.
 * Delegates conversation discovery, storage handles, worker fallback, and mocks to
 * `shadow-claw/utils/workspace-fs`, adding DAW file classification, icons, and events.
 */

import {
  DEFAULT_GROUP_ID,
  DEFAULT_GROUP_NAME,
  LEGACY_OPFS_ROOT,
  LEGACY_DB_NAME,
  sanitizeGroupId,
  unsanitizeGroupId,
  getAppBasePath,
  getDeploymentNamespace,
  getOpfsRootName,
  getDbName,
  isOpfsAvailable,
  getConversationDirHandle,
  formatFileSize,
  listConversations,
  listWorkspaceFiles as listSharedWorkspaceFiles,
  readWorkspaceFile as readSharedWorkspaceFile,
  writeOpfsPathViaWorker,
  saveWorkspaceFile as saveSharedWorkspaceFile,
  deleteWorkspaceFile,
  setMockWorkspaceFsStorage as setMockFsStorage,
  resetMockWorkspaceFsStorage as resetMockFsStorage,
} from "shadow-claw/utils/workspace-fs";

export {
  DEFAULT_GROUP_ID,
  DEFAULT_GROUP_NAME,
  LEGACY_OPFS_ROOT,
  LEGACY_DB_NAME,
  setMockFsStorage,
  resetMockFsStorage,
  sanitizeGroupId,
  unsanitizeGroupId,
  getAppBasePath,
  getDeploymentNamespace,
  getOpfsRootName,
  getDbName,
  isOpfsAvailable,
  getConversationDirHandle,
  formatFileSize,
  listConversations,
  writeOpfsPathViaWorker,
};

/**
 * Helper to classify file extensions and format.
 */
export function classifyFile(filename) {
  const lower = String(filename || "").toLowerCase();
  let format = "other";
  let isProject = false;
  let isAudio = false;

  if (lower.endsWith(".shadow-claw-daw.json") || lower.endsWith(".json")) {
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

export async function listConversationFiles(groupId = DEFAULT_GROUP_ID) {
  return await listSharedWorkspaceFiles(groupId, { classify: classifyFile });
}

export async function readConversationFile(
  groupId = DEFAULT_GROUP_ID,
  filename,
) {
  return await readSharedWorkspaceFile(groupId, filename, {
    classify: classifyFile,
  });
}

export async function writeConversationFile(
  groupId = DEFAULT_GROUP_ID,
  filename,
  content,
  _options = {},
) {
  return await saveSharedWorkspaceFile(groupId, filename, content, {
    eventName: "scdaw-file-saved",
  });
}

export async function deleteConversationFile(
  groupId = DEFAULT_GROUP_ID,
  filename,
) {
  return await deleteWorkspaceFile(groupId, filename);
}
