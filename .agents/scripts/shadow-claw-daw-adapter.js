/**
 * .agents/scripts/shadow-claw-daw-adapter.js
 *
 * ShadowClaw Page Adapter & WebMCP IPC Bridge for Daw.
 * Bridges worker declarative tools to the Web Audio engine via BroadcastChannel.
 * Coordinates leader election via Web Locks so only one document answers tool commands.
 */

import { scdaw } from "./shadow-claw-daw-engine.js";
import {
  MIN_BPM,
  MAX_BPM,
  projectToScoreView,
  beatsPerBar,
} from "./shadow-claw-daw.js";
import { TOOLS_METADATA } from "./shadow-claw-daw-tools-metadata.js";
import "./shadow-claw-daw-element.js";
import {
  createToolAdapterBridge,
  registerNativeWebMcp as registerWebMcpTools,
} from "shadow-claw/utils/tool-adapter-bridge";

let lastBroadcastProjectRef = null;

function buildSnapshotPayload() {
  const projRef = scdaw.project.get();
  const payload = {
    type: "snapshot",
    state: scdaw.getState(),
  };
  if (projRef !== lastBroadcastProjectRef) {
    lastBroadcastProjectRef = projRef;
    payload.project = scdaw.getProject();
  }
  return payload;
}

const bridge = createToolAdapterBridge({
  lockName: "shadow-claw-daw-engine",
  commandsChannel: "scdaw-commands",
  resultsChannel: "scdaw-results",
  stateChannel: "scdaw-state",
  tools: TOOLS_METADATA,
  dispatch: (name, params) => handleToolDispatch(name, params),
  getStateSnapshot: () => buildSnapshotPayload(),
  shouldBroadcastIntervalSnapshot: () => Boolean(scdaw.getState().playing),
  snapshotIntervalMs: 100,
  onLeadershipChange: (isLeader) => {
    scdaw._updateState({ isLeader });
  },
});

export async function init(_container) {
  return await bridge.init();
}

export async function handleToolDispatch(name, params) {
  switch (name) {
    case "scdaw_get_status": {
      const s = scdaw.getState();
      return {
        ...s,
        bpmRange: s.bpmRange || { min: MIN_BPM, max: MAX_BPM },
      };
    }

    case "scdaw_get_project": {
      const p = scdaw.getProject();
      if (params?.view === "score" || params?.scoreView) {
        return projectToScoreView(p);
      }
      return {
        timebase: {
          ppqnPerQuarter: 960,
          beatsPerBar: beatsPerBar(p.signature || [4, 4]),
          stepsPerBar: beatsPerBar(p.signature || [4, 4]) * 4,
          lengthBars: p.lengthBars || 1,
        },
        ...p,
      };
    }

    case "scdaw_new_project":
    case "scdaw_create_project": {
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

    case "scdaw_write_notes":
    case "scdaw_add_notes": {
      return await scdaw.sendCommand("write_notes", params);
    }

    case "scdaw_clear_notes": {
      return await scdaw.sendCommand("clear_notes", params);
    }

    case "scdaw_clear_project_notes": {
      return await scdaw.sendCommand("clear_project_notes", params);
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

    case "scdaw_get_midi_status": {
      const m = scdaw.midi?.state?.get?.() || {
        supported: false,
        status: "unsupported",
        inputs: [],
        outputs: [],
      };
      const proj = scdaw.getProject();
      return {
        ...m,
        captureCount: scdaw.midiCaptureCount?.get?.() || 0,
        midiMappings: proj.midiMappings || [],
      };
    }

    case "scdaw_configure_midi": {
      const action = params.action;
      if (action === "init") {
        const status = await scdaw.midi?.init?.({
          sysex: Boolean(params.sysex),
        });
        return { status, ...(scdaw.midi?.state?.get?.() || {}) };
      }
      if (action === "set_routing") {
        return await scdaw.sendCommand("set_track_midi_routing", params);
      }
      if (action === "set_learn") {
        return await scdaw.sendCommand("set_midi_learn_mapping", params);
      }
      if (action === "remove_learn") {
        return await scdaw.sendCommand("remove_midi_learn_mapping", params);
      }
      if (action === "clear_learn") {
        return await scdaw.sendCommand("clear_midi_learn_mappings", params);
      }
      if (action === "import_learn") {
        return await scdaw.sendCommand("import_midi_learn_mappings", params);
      }
      if (action === "start_learn") {
        const target = scdaw.midi?.startMidiLearn?.(params);
        return {
          ok: true,
          learning: scdaw.midi?.state?.get?.()?.learning || {
            active: false,
            target: null,
          },
          target,
        };
      }
      if (action === "cancel_learn") {
        scdaw.midi?.cancelMidiLearn?.();
        return {
          ok: true,
          learning: scdaw.midi?.state?.get?.()?.learning || {
            active: false,
            target: null,
          },
        };
      }
      if (action === "apply_preset") {
        return await scdaw.sendCommand("apply_midi_controller_preset", params);
      }
      if (action === "commit_captured") {
        return await scdaw.commitCapturedMidi(params.trackId);
      }
      throw new Error(`Unknown scdaw_configure_midi action: ${action}`);
    }

    case "scdaw_trigger_midi": {
      const action = params.action;
      const trackId = params.trackId || scdaw.selectedTrackId?.get?.();
      if (action === "note_on") {
        scdaw.liveNoteOn(trackId, params.pitch ?? 60, params.velocity ?? 0.8);
        return { ok: true, action, trackId, pitch: params.pitch ?? 60 };
      }
      if (action === "note_off") {
        scdaw.liveNoteOff(trackId, params.pitch ?? 60);
        return { ok: true, action, trackId, pitch: params.pitch ?? 60 };
      }
      if (action === "sustain") {
        scdaw.setSustainPedal(trackId, Boolean(params.down));
        return { ok: true, action, trackId, down: Boolean(params.down) };
      }
      if (action === "pitch_bend") {
        scdaw.setPitchBend(trackId, Number(params.value ?? 0));
        return { ok: true, action, trackId, value: Number(params.value ?? 0) };
      }
      if (action === "panic") {
        scdaw.panic();
        return { ok: true, action };
      }
      throw new Error(`Unknown scdaw_trigger_midi action: ${action}`);
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

    case "scdaw_import_audio": {
      const raw = String(params.data || "").replace(/^data:[^;]+;base64,/, "");
      let buf;
      if (typeof atob === "function") {
        const bin = atob(raw);
        buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      } else {
        buf = Buffer.from(raw, "base64");
      }
      return await scdaw.importAudioFile(params.trackId || null, buf, {
        name: params.name,
        time: params.time ?? 0,
      });
    }

    case "scdaw_set_audio_clip": {
      return await scdaw.sendCommand("set_audio_clip", params);
    }

    case "scdaw_edit_audio_clip": {
      const action = params.action;
      switch (action) {
        case "split":
          return await scdaw.sendCommand("split_audio_clip", params);
        case "trim":
          return await scdaw.sendCommand("trim_audio_clip", params);
        case "duplicate":
          return await scdaw.sendCommand("duplicate_audio_clip", params);
        case "join":
          return await scdaw.sendCommand("join_audio_clips", params);
        case "crossfade":
          return await scdaw.sendCommand("crossfade_audio_clips", params);
        case "set_fades":
          return await scdaw.sendCommand("set_clip_fades", params);
        case "set_envelope":
          return await scdaw.sendCommand("set_clip_gain_envelope", params);
        case "silence_range":
          return await scdaw.sendCommand("silence_clip_range", params);
        case "split_at_silences":
          return await scdaw.sendCommand("split_at_silences", params);
        case "mute":
          return await scdaw.sendCommand("silence_audio_clip", params);
        case "remove":
          return await scdaw.sendCommand("remove_audio_clip", params);
        default:
          throw new Error(
            `Unsupported scdaw_edit_audio_clip action: ${action}`,
          );
      }
    }

    case "scdaw_process_audio_clip": {
      const effect = String(params.effect || "");
      if (effect.startsWith("generate_")) {
        return await scdaw.sendCommand("generate_audio_clip", {
          ...params,
          generator: effect.replace(/^generate_/, ""),
        });
      }
      return await scdaw.sendCommand("process_audio_clip", params);
    }

    case "scdaw_analyze_audio_clip": {
      return await scdaw.sendCommand("analyze_audio_clip", params);
    }

    case "scdaw_manage_labels": {
      const action = params.action;
      switch (action) {
        case "add":
          return await scdaw.sendCommand("add_label", params);
        case "update":
          return await scdaw.sendCommand("update_label", params);
        case "remove":
          return await scdaw.sendCommand("remove_label", params);
        case "clear":
          return await scdaw.sendCommand("clear_labels", params);
        case "list":
          return await scdaw.sendCommand("list_labels", params);
        case "split_at_labels":
          return await scdaw.sendCommand("split_at_labels", params);
        default:
          throw new Error(`Unsupported scdaw_manage_labels action: ${action}`);
      }
    }

    case "scdaw_set_track_send": {
      return await scdaw.sendCommand("set_track_send", params);
    }

    case "scdaw_record_arm": {
      return await scdaw.sendCommand("set_track_record_arm", params);
    }

    case "scdaw_set_metronome": {
      return await scdaw.sendCommand("set_metronome", params);
    }

    case "scdaw_set_instrument": {
      return await scdaw.sendCommand("set_instrument", params);
    }

    case "scdaw_set_808": {
      const subParams = {};
      if (params.glide !== undefined) subParams.glide = params.glide;
      if (params.decay !== undefined) subParams.decay = params.decay;
      if (params.drive !== undefined) subParams.drive = params.drive;
      if (params.tone !== undefined) subParams.tone = params.tone;
      if (params.harmonics !== undefined)
        subParams.harmonics = params.harmonics;
      return await scdaw.sendCommand("set_instrument", {
        trackId: params.trackId,
        instrument: "808",
        params: subParams,
      });
    }

    case "scdaw_configure_fx": {
      return await scdaw.sendCommand("manage_fx", params);
    }

    case "scdaw_apply_groove": {
      const type = params.type || (params.template ? "zeitgeist" : "humanize");
      const fxParams = {};
      if (params.template) fxParams.template = params.template;
      if (params.amount !== undefined) fxParams.amount = params.amount;
      if (params.timingTicks !== undefined)
        fxParams.timingTicks = params.timingTicks;
      if (params.velocity !== undefined) fxParams.velocity = params.velocity;
      if (params.seed !== undefined) fxParams.seed = params.seed;
      return await scdaw.sendCommand("manage_fx", {
        action: params.action || "add",
        trackId: params.trackId,
        fxType: type,
        params: fxParams,
      });
    }

    case "scdaw_compose_song": {
      return await scdaw.sendCommand("compose_song", params);
    }

    case "scdaw_describe_arrangement": {
      return await scdaw.sendCommand("describe_arrangement", params);
    }

    case "scdaw_analyze_mix": {
      return await scdaw.sendCommand("analyze_mix", params);
    }

    case "scdaw_list_schemas": {
      return await scdaw.sendCommand("list_schemas", params);
    }

    case "scdaw_design_sound": {
      return await scdaw.sendCommand("design_sound", params);
    }

    case "scdaw_render_surface": {
      const el = params.element || "workbench";
      const tagMap = {
        workbench: "<shadow-claw-daw-workbench></shadow-claw-daw-workbench>",
        mixer: "<shadow-claw-daw-mixer></shadow-claw-daw-mixer>",
        sequencer: "<shadow-claw-daw-sequencer></shadow-claw-daw-sequencer>",
        transport: "<shadow-claw-daw-transport></shadow-claw-daw-transport>",
        browser: "<shadow-claw-daw-browser></shadow-claw-daw-browser>",
        timeline: "<shadow-claw-daw-timeline></shadow-claw-daw-timeline>",
        editor: "<shadow-claw-daw-editor></shadow-claw-daw-editor>",
        "wave-editor":
          "<shadow-claw-daw-wave-editor></shadow-claw-daw-wave-editor>",
        spectrum: "<shadow-claw-daw-spectrum></shadow-claw-daw-spectrum>",
        synth: "<shadow-claw-daw-synth></shadow-claw-daw-synth>",
        devices: "<shadow-claw-daw-devices></shadow-claw-daw-devices>",
        statusbar: "<shadow-claw-daw-status-bar></shadow-claw-daw-status-bar>",
        knob: "<shadow-claw-daw-knob></shadow-claw-daw-knob>",
        "resize-handle":
          "<shadow-claw-daw-resize-handle></shadow-claw-daw-resize-handle>",
      };
      return {
        ok: true,
        rendered: true,
        element:
          tagMap[el] ||
          "<shadow-claw-daw-workbench></shadow-claw-daw-workbench>",
      };
    }

    default:
      throw new Error(`Unknown scdaw tool: ${name}`);
  }
}

export async function registerNativeWebMcp() {
  const toolsToRegister =
    Array.isArray(TOOLS_METADATA) && TOOLS_METADATA.length > 0
      ? TOOLS_METADATA
      : [
          {
            name: "scdaw_get_status",
            title: "Get DAW Playback & Engine Status",
            description:
              "Return current DAW playback position, audio engine state, track count, BPM, and recent bounce metrics.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true, consequentialHint: false },
          },
          {
            name: "scdaw_play",
            title: "Start DAW Playback",
            description: "Start playback of the looping pattern.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: false, consequentialHint: false },
          },
          {
            name: "scdaw_stop",
            title: "Stop DAW Playback",
            description: "Stop playback and rewind playhead.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: false, consequentialHint: false },
          },
          {
            name: "scdaw_get_levels",
            title: "Get DAW Audio Meter Levels",
            description: "Read real-time peak and RMS audio decibel levels.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true, consequentialHint: false },
          },
        ];

  return await registerWebMcpTools(toolsToRegister, (name, input) =>
    handleToolDispatch(name, input),
  );
}
