/**
 * bin/tool-manifest.mjs
 *
 * Single source of truth for all 36 declarative scdaw_* tools.
 * Generates .agents/tools/scdaw_*.json via bin/generate-tools.mjs.
 */

function makeBroadcastCode(toolName, timeoutMs = 5000) {
  return `
let toolParams = {};
try {
  toolParams = typeof input !== "undefined" && input && typeof input === "object"
    ? input
    : (typeof $PIPE_DATA !== "undefined" && $PIPE_DATA ? (typeof $PIPE_DATA === "string" ? JSON.parse($PIPE_DATA) : $PIPE_DATA) : (typeof data !== "undefined" && data ? (typeof data === "string" ? JSON.parse(data) : data) : {}));
} catch (_) {}

const cmdCh = new BroadcastChannel("scdaw-commands");
const resCh = new BroadcastChannel("scdaw-results");
const reqId = "req_" + Math.random().toString(36).slice(2);

const timeout = new Promise((_, reject) =>
  setTimeout(() => {
    cmdCh.close();
    resCh.close();
    reject(new Error("Timeout awaiting DAW response for ${toolName}. Ensure workbench is open at /pages/main/scdaw.html."));
  }, ${timeoutMs})
);

const reply = new Promise((resolve, reject) => {
  const handler = (e) => {
    if (e.data && e.data.requestId === reqId) {
      if (e.data.ack) return;
      resCh.removeEventListener("message", handler);
      cmdCh.close();
      resCh.close();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.result);
    }
  };
  resCh.addEventListener("message", handler);
  cmdCh.postMessage({ type: "${toolName}", requestId: reqId, params: toolParams || {} });
});

return await Promise.race([reply, timeout]);
`.trim();
}

export const TOOLS = [
  {
    name: "scdaw_get_status",
    description:
      "Return current DAW playback position, audio engine state, track count, BPM, and recent bounce metrics.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_get_status"),
    },
  },
  {
    name: "scdaw_get_project",
    description:
      "Return the complete project JSON graph including all tracks, notes, volume, pan, and synthesis parameters.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_get_project"),
    },
  },
  {
    name: "scdaw_new_project",
    description:
      "Create and initialize a new project from a template ('basic-beat' or 'empty').",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name" },
        bpm: { type: "number", description: "Initial tempo (40-240)" },
        template: {
          type: "string",
          enum: [
            "basic-beat",
            "straight-beat",
            "empty",
            "techno-bass",
            "pop",
            "house",
            "trap",
            "synthwave",
          ],
          description: "Starter template",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_new_project"),
    },
  },
  {
    name: "scdaw_load_project",
    description:
      "Validate and load a complete DAW project schema into the active workbench session, or load an existing project file from OPFS conversation storage.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "object", description: "Valid DAW project object" },
        filename: {
          type: "string",
          description:
            "Project filename to load from conversation files (.scdaw.json, .dawproject, .mid)",
        },
        conversationId: {
          type: "string",
          description:
            "Conversation ID to load from (defaults to 'br:main' / Main)",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_load_project"),
    },
  },
  {
    name: "scdaw_set_transport",
    description:
      "Update transport properties: BPM (40-240), signature ([4,4] or [3,4]), pattern length in bars (1-4), or swing factor (0-0.5).",
    input_schema: {
      type: "object",
      properties: {
        bpm: { type: "number", description: "Beats per minute (40-240)" },
        signature: {
          type: "array",
          items: { type: "number" },
          description: "Time signature [nominator, denominator]",
        },
        lengthBars: {
          type: "number",
          description: "Loop pattern length in bars (1-4)",
        },
        swing: {
          type: "number",
          description: "16th-note swing factor (0.0 to 0.5)",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_set_transport"),
    },
  },
  {
    name: "scdaw_play",
    description: "Start playback of the looping pattern.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_play"),
    },
  },
  {
    name: "scdaw_stop",
    description:
      "Stop playback and rewind the transport playhead to the start of the loop.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_stop"),
    },
  },
  {
    name: "scdaw_add_track",
    description:
      "Add a new instrument track ('drums' or 'synth') with custom name and initial synthesis parameters.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["drums", "synth"],
          description: "Track instrument kind",
        },
        name: { type: "string", description: "Track label" },
        params: {
          type: "object",
          description: "Optional synthesizer or effect parameters",
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_add_track"),
    },
  },
  {
    name: "scdaw_remove_track",
    description: "Remove an existing track from the project by track ID.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Track identifier to delete" },
      },
      required: ["trackId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_remove_track"),
    },
  },
  {
    name: "scdaw_set_track",
    description:
      "Adjust track mixing parameters (volume, pan, mute, solo) or synthesis parameters (waveform, cutoff, resonance, ADSR).",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track identifier" },
        name: { type: "string", description: "Rename track" },
        volume: {
          type: "number",
          description: "Track volume fader (0.0 to 1.5)",
        },
        pan: {
          type: "number",
          description: "Stereo pan (-1.0 left to 1.0 right)",
        },
        mute: { type: "boolean", description: "Mute track audio" },
        solo: { type: "boolean", description: "Solo track" },
        params: {
          type: "object",
          description: "Synthesizer parameter overrides",
        },
      },
      required: ["trackId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_set_track"),
    },
  },
  {
    name: "scdaw_write_notes",
    description:
      "Write or merge notes into a track. Supports step indices (0-15 per bar), musical beat units, or raw PPQN pulses. Pitch can be MIDI number, note name ('C4'), or drum name ('kick', 'snare', 'hat', 'clap').",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        units: {
          type: "string",
          enum: ["steps", "beats", "ppqn"],
          description: "Timebase units used in notes array (default 'steps')",
        },
        mode: {
          type: "string",
          enum: ["replace", "merge"],
          description:
            "'replace' overwrites all notes in track, 'merge' appends to existing notes",
        },
        notes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              step: {
                type: "number",
                description: "16th step index (0-15 per bar)",
              },
              beat: {
                type: "number",
                description: "Beat position (0, 0.5, 1, 1.25...)",
              },
              position: { type: "number", description: "PPQN position" },
              pitch: {
                description:
                  "Note pitch (MIDI number 0-127, note string 'C4', or drum name 'kick')",
              },
              durationSteps: {
                type: "number",
                description: "Duration in 16th steps",
              },
              duration: {
                type: "number",
                description: "Duration in PPQN pulses",
              },
              velocity: {
                type: "number",
                description: "Velocity (0.0 to 1.0)",
              },
            },
          },
          description: "List of notes to write",
        },
      },
      required: ["trackId", "notes"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_write_notes"),
    },
  },
  {
    name: "scdaw_clear_notes",
    description:
      "Clear notes on a specific track, optionally within a specified step range.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        fromStep: {
          type: "number",
          description: "Start 16th step index (inclusive)",
        },
        toStep: {
          type: "number",
          description: "End 16th step index (exclusive)",
        },
      },
      required: ["trackId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_clear_notes"),
    },
  },
  {
    name: "scdaw_get_levels",
    description:
      "Read real-time peak and RMS audio decibel meter levels for master bus and all active tracks.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_get_levels"),
    },
  },
  {
    name: "scdaw_bounce",
    description:
      "Render project offline into a WAV audio file (16-bit, 24-bit, or 32-bit Float) via OfflineAudioContext, initiating browser download and returning audio metadata.",
    input_schema: {
      type: "object",
      properties: {
        loops: {
          type: "number",
          description:
            "Number of pattern loop repetitions to render (1-8, default 1)",
        },
        bitDepth: {
          type: "number",
          enum: [16, 24, 32],
          description:
            "Audio bit depth: 16 (CD standard), 24 (studio standard, default), or 32 (32-bit float)",
        },
        tailSeconds: {
          type: "number",
          description:
            "Decay tail duration in seconds for reverb/release (default 0.5)",
        },
        trimSilence: {
          type: "boolean",
          description:
            "Whether to trim tail silence below -72dBFS threshold (default true)",
        },
        saveToWorkspace: {
          type: "boolean",
          description: "Whether to preserve audio metadata in session storage",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_bounce", 30000),
    },
  },
  {
    name: "scdaw_export_stems",
    description:
      "Renders consolidated Bar 1 Beat 1 audio stems across all tracks with multi-tap routing (post-fader, pre-fader, pre-fx), silence-tail trimming, and bundles stems, MIDI, and project into a ZIP archive.",
    input_schema: {
      type: "object",
      properties: {
        loops: {
          type: "number",
          description: "Number of loop repetitions to render (1-8, default 1)",
        },
        tap: {
          type: "string",
          enum: ["post-fader", "pre-fader", "pre-fx"],
          description:
            "Tap routing: post-fader (default), pre-fader (raw track level), pre-fx (raw synth voice)",
        },
        bitDepth: {
          type: "number",
          enum: [16, 24, 32],
          description: "Audio bit depth: 16, 24 (default), or 32 (float)",
        },
        tailSeconds: {
          type: "number",
          description: "Decay tail duration in seconds (default 1.0)",
        },
        trimSilence: {
          type: "boolean",
          description:
            "Whether to trim tail silence below -72dBFS threshold (default true)",
        },
        bundleZip: {
          type: "boolean",
          description:
            "Whether to package all stems into a single ZIP bundle (default true)",
        },
        includeMaster: {
          type: "boolean",
          description: "Whether to include 00_Master.wav stem (default true)",
        },
        includeMidi: {
          type: "boolean",
          description:
            "Whether to include Standard MIDI File (.mid) in bundle (default true)",
        },
        includeProject: {
          type: "boolean",
          description:
            "Whether to include native .scdaw.json project in bundle (default true)",
        },
        saveToWorkspace: {
          type: "boolean",
          description:
            "Whether to trigger browser download of the stems ZIP archive",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_export_stems", 60000),
    },
  },
  {
    name: "scdaw_export_midi",
    description:
      "Exports the active song or track notes as a Standard MIDI File (.mid) Format 1 (multi-track) or Format 0 (single track), baking active MIDI FX and swing.",
    input_schema: {
      type: "object",
      properties: {
        format: {
          type: "number",
          enum: [0, 1],
          description:
            "SMF format: 1 (multi-track, default) or 0 (single track merged)",
        },
        loops: {
          type: "number",
          description: "Number of pattern repetitions to export (default 1)",
        },
        bakeMidiFx: {
          type: "boolean",
          description:
            "Whether to bake arpeggiator/pitch/velocity MIDI FX into notes (default true)",
        },
        bakeSwing: {
          type: "boolean",
          description:
            "Whether to bake 16th-note swing timing offsets into notes (default true)",
        },
        saveToWorkspace: {
          type: "boolean",
          description: "Whether to trigger browser download of .mid file",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_export_midi", 10000),
    },
  },
  {
    name: "scdaw_import_midi",
    description:
      "Imports a Standard MIDI File (.mid) buffer or base64 data into the DAW project or a target track.",
    input_schema: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: "Base64-encoded SMF (.mid) file data",
        },
        targetTrackId: {
          type: "string",
          description:
            "Optional track ID to import notes into; if omitted, loads whole project",
        },
      },
      required: ["data"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_import_midi", 10000),
    },
  },
  {
    name: "scdaw_export_project",
    description:
      "Exports the current project as a native .scdaw.json schema or a DAWproject v1.0 interchange archive (.dawproject) to OPFS conversation storage and/or browser download.",
    input_schema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "dawproject"],
          description:
            "Export format: 'json' (native .scdaw.json, default) or 'dawproject' (DAWproject v1.0 ZIP)",
        },
        filename: {
          type: "string",
          description: "Target filename to save as",
        },
        conversationId: {
          type: "string",
          description:
            "Destination conversation ID in OPFS (defaults to 'br:main' / Main)",
        },
        saveToOpfs: {
          type: "boolean",
          description:
            "Whether to save to OPFS conversation storage (default: true)",
        },
        saveToWorkspace: {
          type: "boolean",
          description:
            "Whether to trigger browser download of the exported file",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_export_project", 15000),
    },
  },
  {
    name: "scdaw_import_project",
    description:
      "Imports a project from native .scdaw.json or .dawproject archive data (JSON string or Base64 string).",
    input_schema: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description:
            "Native JSON string or Base64-encoded .dawproject / .scdaw.json file data",
        },
      },
      required: ["data"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_import_project", 15000),
    },
  },
  {
    name: "scdaw_undo",
    description:
      "Undo the last project edit, restoring the previous snapshot from the undo history stack.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_undo"),
    },
  },
  {
    name: "scdaw_render_surface",
    description:
      "Return custom element HTML tag to embed the live DAW workbench, mixer, transport, or sequencer surface in chat.",
    input_schema: {
      type: "object",
      properties: {
        element: {
          type: "string",
          enum: [
            "workbench",
            "mixer",
            "sequencer",
            "transport",
            "browser",
            "timeline",
            "editor",
            "devices",
            "statusbar",
            "knob",
            "resize-handle",
          ],
          description: "Surface element to render (default 'workbench')",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_render_surface"),
    },
  },
  {
    name: "scdaw_reset",
    description:
      "Reset parameter, device, track, pattern notes, or entire project to defaults (supports scopes: 'param', 'track', 'pattern', 'project').",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["param", "track", "pattern", "project"],
          description: "Reset target scope",
        },
        trackId: { type: "string", description: "Target track ID" },
        param: {
          type: "string",
          description: "Parameter name (if scope is 'param')",
        },
        mode: {
          type: "string",
          enum: ["mixer", "params", "all"],
          description: "Track reset mode (if scope is 'track')",
        },
        template: {
          type: "string",
          enum: [
            "basic-beat",
            "straight-beat",
            "empty",
            "techno-bass",
            "pop",
            "house",
            "trap",
            "synthwave",
          ],
          description: "Starter template (if scope is 'project')",
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_reset"),
    },
  },
  {
    name: "scdaw_apply_preset",
    description:
      "Apply a curated synthesizer preset ('init-saw', 'techno-bass', 'acid-303', 'pop-pluck', 'warm-pad', 'sub-808', 'supersaw-lead') to a synth track.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        preset: {
          type: "string",
          enum: [
            "init-saw",
            "techno-bass",
            "acid-303",
            "pop-pluck",
            "warm-pad",
            "sub-808",
            "supersaw-lead",
          ],
          description: "Preset name",
        },
      },
      required: ["trackId", "preset"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_apply_preset"),
    },
  },
  {
    name: "scdaw_panic",
    description:
      "Emergency All Notes Off: immediately silences all active synthesizer voices and stops the transport.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_panic"),
    },
  },
  {
    name: "scdaw_manage_fx",
    description:
      "Add, update, reset, or remove an audio effect ('fold', 'crusher', 'stereoTool', 'delay', 'reverb', 'compressor', 'revamp') or MIDI effect ('arpeggio', 'pitch', 'velocity') on a track.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        action: {
          type: "string",
          enum: ["add", "update", "reset", "remove"],
          description: "Action to perform on track FX rack",
        },
        fxType: {
          type: "string",
          enum: [
            "fold",
            "crusher",
            "stereoTool",
            "delay",
            "reverb",
            "compressor",
            "revamp",
            "arpeggio",
            "pitch",
            "velocity",
          ],
          description: "Effect type",
        },
        fxId: {
          type: "string",
          description: "Specific FX instance ID (optional if fxType is unique)",
        },
        params: {
          type: "object",
          description: "Effect parameter key-value pairs to set or update",
        },
      },
      required: ["trackId", "action", "fxType"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_manage_fx"),
    },
  },
  {
    name: "scdaw_set_automation",
    description:
      "Set or update continuous parameter automation points (time in beats, value) for a track parameter such as 'volume', 'pan', or 'cutoff'.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        param: {
          type: "string",
          description:
            "Target parameter name ('volume', 'pan', 'cutoff', etc.)",
        },
        points: {
          type: "array",
          description: "List of automation points { time, value }",
          items: {
            type: "object",
            properties: {
              time: {
                type: "number",
                description: "Point time in musical beats",
              },
              value: {
                type: "number",
                description: "Target parameter value at this time",
              },
            },
            required: ["time", "value"],
          },
        },
        time: {
          type: "number",
          description:
            "Point time in musical beats (when setting a single point)",
        },
        value: {
          type: "number",
          description: "Point value (when setting a single point)",
        },
      },
      required: ["trackId", "param"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_set_automation"),
    },
  },
  {
    name: "scdaw_clear_automation",
    description:
      "Clear continuous automation points for a specific track parameter, or clear all automation for the track if no parameter is specified.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        param: {
          type: "string",
          description:
            "Specific parameter name to clear (omitted to clear all parameters on track)",
        },
      },
      required: ["trackId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_clear_automation"),
    },
  },
  {
    name: "scdaw_add_audio_clip",
    description:
      "Add an audio clip (sample, vocal take, stem) to an audio track at a specified time position in beats.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target audio track ID" },
        clip: {
          type: "object",
          description: "Audio clip configuration",
          properties: {
            id: { type: "string", description: "Unique clip ID (optional)" },
            name: { type: "string", description: "Clip label / name" },
            sample: {
              type: "string",
              description: "Sample file name or URI reference",
            },
            time: {
              type: "number",
              description: "Clip start position in musical beats",
            },
            duration: {
              type: "number",
              description: "Clip playback duration in beats",
            },
            offset: {
              type: "number",
              description: "Source audio offset in seconds",
            },
            gain: {
              type: "number",
              description: "Clip gain multiplier (default 1.0)",
            },
          },
          required: ["name"],
        },
      },
      required: ["trackId", "clip"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_add_audio_clip"),
    },
  },
  {
    name: "scdaw_set_audio_clip",
    description:
      "Update properties (time, duration, offset, gain, name) of an existing audio clip on an audio track.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        clipId: { type: "string", description: "Audio clip ID" },
        patch: {
          type: "object",
          description: "Patch object containing updated clip properties",
          properties: {
            name: { type: "string" },
            sample: { type: "string" },
            time: { type: "number" },
            duration: { type: "number" },
            offset: { type: "number" },
            gain: { type: "number" },
          },
        },
      },
      required: ["trackId", "clipId", "patch"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_set_audio_clip"),
    },
  },
  {
    name: "scdaw_set_track_send",
    description:
      "Configure an auxiliary send routing level (0.0 to 1.0) from a source track to a destination track or submix.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Source track ID" },
        targetTrackId: {
          type: "string",
          description: "Target destination track or bus ID",
        },
        level: {
          type: "number",
          description: "Send level multiplier (0.0 to 1.0)",
        },
      },
      required: ["trackId", "targetTrackId", "level"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_set_track_send"),
    },
  },
  {
    name: "scdaw_record_arm",
    description: "Arm or disarm an audio track for live recording.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        armed: {
          type: "boolean",
          description: "Whether track is armed for recording",
        },
      },
      required: ["trackId", "armed"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_record_arm"),
    },
  },
  {
    name: "scdaw_set_metronome",
    description: "Toggle the metronome click track and configure click volume.",
    input_schema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Enable or disable audible metronome",
        },
        volume: {
          type: "number",
          description: "Metronome volume multiplier (0.0 to 1.0)",
        },
      },
      required: ["enabled"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: false,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_set_metronome"),
    },
  },
  {
    name: "scdaw_set_instrument",
    description:
      "Set the synthesis instrument on an existing track (808, cubed, pluck, tubular, neon, noise-pad, korpus, nano, soundfont, synth, drums).",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        instrument: {
          type: "string",
          enum: [
            "808",
            "cubed",
            "pluck",
            "tubular",
            "neon",
            "noise-pad",
            "korpus",
            "nano",
            "soundfont",
            "synth",
            "drums",
          ],
          description: "Instrument synthesis model",
        },
        params: {
          type: "object",
          description: "Optional custom instrument parameter overrides",
        },
      },
      required: ["trackId", "instrument"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_set_instrument"),
    },
  },
  {
    name: "scdaw_set_808",
    description:
      "Configure and shape an authentic 808 sub bass voice with portamento glide, drive, decay, tone, and harmonics presets.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        glide: {
          type: "number",
          description: "Portamento slide time in PPQN ticks (0 to 480)",
        },
        decay: {
          type: "number",
          description:
            "Sub bass decay envelope duration in seconds (0.1 to 4.0)",
        },
        drive: {
          type: "number",
          description: "Tanh soft-clip drive factor (0.0 to 1.0)",
        },
        tone: {
          type: "number",
          description: "Low-pass filter brightness (0.1 to 1.0)",
        },
        harmonics: {
          type: "string",
          enum: ["clean", "dist", "growl", "grit"],
          description: "Harmonics saturation preset",
        },
      },
      required: ["trackId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_set_808"),
    },
  },
  {
    name: "scdaw_configure_fx",
    description:
      "Add, update, or remove an audio effect (autotune, vocoder, maximizer, tidal, transient, sidechain, fold, crusher, delay, reverb, stereoTool) on a track.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        action: {
          type: "string",
          enum: ["add", "update", "reset", "remove"],
          description: "Action to perform on track FX chain",
        },
        fxType: {
          type: "string",
          enum: [
            "autotune",
            "vocoder",
            "maximizer",
            "tidal",
            "transient",
            "sidechain",
            "fold",
            "crusher",
            "delay",
            "reverb",
            "stereoTool",
          ],
          description: "Audio effect type",
        },
        fxId: {
          type: "string",
          description: "Optional existing FX ID for update/remove/reset",
        },
        params: {
          type: "object",
          description: "Parameters for the effect",
        },
      },
      required: ["trackId", "fxType"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_configure_fx"),
    },
  },
  {
    name: "scdaw_apply_groove",
    description:
      "Apply micro-timing groove templates (Zeitgeist: mpc60, sp1200, swing16, shuffle, laidback, rushed) or humanize timing and velocity on a track.",
    input_schema: {
      type: "object",
      properties: {
        trackId: { type: "string", description: "Target track ID" },
        template: {
          type: "string",
          enum: [
            "straight",
            "swing16",
            "mpc60",
            "sp1200",
            "shuffle",
            "laidback",
            "rushed",
            "scurve",
            "power",
          ],
          description: "Groove shuffle template",
        },
        amount: {
          type: "number",
          description: "Groove displacement amount (0.0 to 1.0)",
        },
        timingTicks: {
          type: "number",
          description: "Humanize micro-timing jitter range in PPQN ticks",
        },
        velocity: {
          type: "number",
          description: "Humanize velocity jitter range (0 to 64)",
        },
        seed: {
          type: "number",
          description: "Deterministic PRNG seed for humanize",
        },
      },
      required: ["trackId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      consequentialHint: true,
    },
    execution: {
      type: "javascript",
      code: makeBroadcastCode("scdaw_apply_groove"),
    },
  },
];
