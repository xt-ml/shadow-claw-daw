/**
 * .agents/scripts/scdaw-adapter.js
 *
 * ShadowClaw Page Adapter & WebMCP IPC Bridge for Daw.
 * Bridges worker declarative tools to the Web Audio engine via BroadcastChannel.
 * Coordinates leader election via Web Locks so only one document answers tool commands.
 */

import { scdaw } from "./scdaw-engine.js";
import "./scdaw-element.js";

let cmdChannel = null;
let resChannel = null;
let stateChannel = null;
let initialized = false;
let isLeader = false;

export async function init(container) {
  if (initialized) return;
  initialized = true;

  // Initialize state broadcast channel for UI synchronization across all documents
  stateChannel = new BroadcastChannel("scdaw-state");

  // Leader Election via Web Locks
  if (
    typeof navigator !== "undefined" &&
    navigator.locks &&
    typeof navigator.locks.request === "function"
  ) {
    try {
      navigator.locks.request(
        "scdaw-engine",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            // Another tab is the leader; this document operates in follower/remote client mode
            scdaw._updateState({ isLeader: false });
            return;
          }
          isLeader = true;
          scdaw._updateState({ isLeader: true });
          setupLeaderBridge();

          // Hold lock until window unloads
          return new Promise(() => {});
        },
      );
    } catch (_) {
      // If Web Locks fails, operate standalone
      isLeader = true;
      scdaw._updateState({ isLeader: true });
      setupLeaderBridge();
    }
  } else {
    // Environments without Web Locks (e.g. Node or older testbeds)
    isLeader = true;
    scdaw._updateState({ isLeader: true });
    setupLeaderBridge();
  }

  // Register Native WebMCP when supported
  await registerNativeWebMcp();
}

function setupLeaderBridge() {
  // Explicit string literals are required for ShadowClaw iframe proxy matching
  cmdChannel = new BroadcastChannel("scdaw-commands");
  resChannel = new BroadcastChannel("scdaw-results");

  cmdChannel.addEventListener("message", async (event) => {
    const msg = event.data;
    if (!msg || !msg.requestId || !msg.type) return;

    // Send immediate ACK to satisfy worker race condition
    resChannel.postMessage({
      requestId: msg.requestId,
      ack: true,
    });

    try {
      const result = await handleToolDispatch(msg.type, msg.params || {});
      resChannel.postMessage({
        requestId: msg.requestId,
        result,
      });
      // Broadcast state update to all UI surfaces
      broadcastState();
    } catch (err) {
      resChannel.postMessage({
        requestId: msg.requestId,
        error: err.message || String(err),
      });
    }
  });

  // Start periodic telemetry broadcast (10 Hz)
  setInterval(() => {
    if (scdaw.getState().playing) {
      broadcastState();
    }
  }, 100);
}

function broadcastState() {
  if (!stateChannel) return;
  stateChannel.postMessage({
    type: "snapshot",
    state: scdaw.getState(),
    project: scdaw.getProject(),
  });
}

export async function handleToolDispatch(name, params) {
  switch (name) {
    case "scdaw_get_status": {
      return scdaw.getState();
    }

    case "scdaw_get_project": {
      return scdaw.getProject();
    }

    case "scdaw_new_project": {
      return await scdaw.sendCommand("new_project", params);
    }

    case "scdaw_load_project": {
      if (params.filename) {
        return await scdaw.loadProjectFromFs({
          conversationId: params.conversationId || "br:main",
          filename: params.filename,
        });
      }
      return await scdaw.sendCommand("load_project", params);
    }

    case "scdaw_set_transport": {
      return await scdaw.sendCommand("set_transport", params);
    }

    case "scdaw_play": {
      return await scdaw.sendCommand("play", params);
    }

    case "scdaw_stop": {
      return await scdaw.sendCommand("stop", params);
    }

    case "scdaw_add_track": {
      return await scdaw.sendCommand("add_track", params);
    }

    case "scdaw_remove_track": {
      return await scdaw.sendCommand("remove_track", params);
    }

    case "scdaw_set_track": {
      return await scdaw.sendCommand("set_track", params);
    }

    case "scdaw_write_notes": {
      return await scdaw.sendCommand("write_notes", params);
    }

    case "scdaw_clear_notes": {
      return await scdaw.sendCommand("clear_notes", params);
    }

    case "scdaw_get_levels": {
      return scdaw.getLevels();
    }

    case "scdaw_bounce": {
      return await scdaw.bounce(params);
    }

    case "scdaw_export_stems": {
      return await scdaw.bounceStems(params);
    }

    case "scdaw_export_midi": {
      return scdaw.exportMidi(params);
    }

    case "scdaw_import_midi": {
      let buf;
      if (typeof params.data === "string") {
        if (typeof atob === "function") {
          const bin = atob(params.data);
          buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        } else {
          buf = Buffer.from(params.data, "base64");
        }
      } else {
        buf = params.data;
      }
      return scdaw.importMidi(buf, params);
    }

    case "scdaw_export_project": {
      return scdaw.exportProject(params);
    }

    case "scdaw_import_project": {
      if (params.filename && !params.data && !params.content) {
        return await scdaw.loadProjectFromFs({
          conversationId: params.conversationId || "br:main",
          filename: params.filename,
        });
      }
      let content = params.data || params.content;
      if (
        typeof content === "string" &&
        !content.trim().startsWith("{") &&
        !content.trim().startsWith("<")
      ) {
        if (typeof atob === "function") {
          const bin = atob(content);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          content = buf;
        } else {
          content = Buffer.from(content, "base64");
        }
      }
      return await scdaw.importProjectFile(content, params);
    }

    case "scdaw_undo": {
      return await scdaw.sendCommand("undo", params);
    }

    case "scdaw_reset": {
      return await scdaw.sendCommand("reset", params);
    }

    case "scdaw_apply_preset": {
      return await scdaw.sendCommand("apply_preset", params);
    }

    case "scdaw_panic": {
      return await scdaw.sendCommand("panic", params);
    }

    case "scdaw_manage_fx": {
      return await scdaw.sendCommand("manage_fx", params);
    }

    case "scdaw_set_automation": {
      return await scdaw.sendCommand("set_automation", params);
    }

    case "scdaw_clear_automation": {
      return await scdaw.sendCommand("clear_automation", params);
    }

    case "scdaw_add_audio_clip": {
      return await scdaw.sendCommand("add_audio_clip", params);
    }

    case "scdaw_set_audio_clip": {
      return await scdaw.sendCommand("set_audio_clip", params);
    }

    case "scdaw_set_track_send": {
      return await scdaw.sendCommand("set_track_send", params);
    }

    case "scdaw_render_surface": {
      const el = params.element || "workbench";
      const tagMap = {
        workbench: "<scdaw-workbench></scdaw-workbench>",
        mixer: "<scdaw-mixer></scdaw-mixer>",
        sequencer: "<scdaw-sequencer></scdaw-sequencer>",
        transport: "<scdaw-transport></scdaw-transport>",
        browser: "<scdaw-browser></scdaw-browser>",
        timeline: "<scdaw-timeline></scdaw-timeline>",
        editor: "<scdaw-editor></scdaw-editor>",
        devices: "<scdaw-devices></scdaw-devices>",
        statusbar: "<scdaw-statusbar></scdaw-statusbar>",
        knob: "<scdaw-knob></scdaw-knob>",
        "resize-handle": "<scdaw-resize-handle></scdaw-resize-handle>",
      };
      return {
        ok: true,
        rendered: true,
        element: tagMap[el] || "<scdaw-workbench></scdaw-workbench>",
      };
    }

    default:
      throw new Error(`Unknown scdaw tool: ${name}`);
  }
}

export async function registerNativeWebMcp() {
  const modelContext =
    typeof document !== "undefined" && document.modelContext
      ? document.modelContext
      : typeof navigator !== "undefined" && navigator.modelContext
        ? navigator.modelContext
        : null;

  if (!modelContext || typeof modelContext.registerTool !== "function") {
    return;
  }

  const nativeTools = [
    {
      name: "scdaw_get_status",
      title: "Get DAW Playback & Engine Status",
      description:
        "Return current DAW playback position, audio engine state, track count, BPM, and recent bounce metrics.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, consequentialHint: false },
      execute: async () => scdaw.getState(),
    },
    {
      name: "scdaw_play",
      title: "Start DAW Playback",
      description: "Start playback of the looping pattern.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, consequentialHint: false },
      execute: async () => await scdaw.sendCommand("play"),
    },
    {
      name: "scdaw_stop",
      title: "Stop DAW Playback",
      description: "Stop playback and rewind playhead.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, consequentialHint: false },
      execute: async () => await scdaw.sendCommand("stop"),
    },
    {
      name: "scdaw_get_levels",
      title: "Get DAW Audio Meter Levels",
      description: "Read real-time peak and RMS audio decibel levels.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, consequentialHint: false },
      execute: async () => scdaw.getLevels(),
    },
  ];

  for (const tool of nativeTools) {
    try {
      const res = modelContext.registerTool(tool);
      if (res && typeof res.catch === "function") {
        await res.catch(() => {});
      }
    } catch (_) {}
  }
}
