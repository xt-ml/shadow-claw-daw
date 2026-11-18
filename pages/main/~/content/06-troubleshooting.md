---
title: "Troubleshooting Guide"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "troubleshooting"
---

## Troubleshooting Guide

### 1. Audio is Locked / No Sound

Modern browsers prevent Web Audio contexts from producing sound without a user interaction.

- **Solution**: Open the workbench page at [`/main/`](/main/) and click the **"🔊 Start Audio"** button in the transport bar.
- Note: Background tools (`scdaw_set_track`, `scdaw_write_notes`, `scdaw_bounce`) continue to function even while real-time audio playback is locked.

### 2. Tool Timed Out Awaiting DAW Response

Worker tools dispatch commands via `BroadcastChannel("scdaw-commands")`. If no browser tab has the workbench open, commands will time out after 5 seconds (or 30 seconds for `scdaw_bounce`).

- **Solution**: Navigate to [`/main/`](/main/) in an active browser tab.

### 3. Multiple Tabs & Leader Election

Only one tab acts as the primary audio leader to avoid audio stutter and duplicate tool executions.

- Web Locks elect the first tab as the leader. Closing the leader tab automatically passes control to the next open workbench tab.

### 4. Metronome Click Sound

- **How it Works**: Clicking **"🔔 Metro"** (`#metro-btn`) enables the metronome click track. When toggled on while stopped, the DAW unlocks audio (if needed) and plays an instant audition click. During playback or recording, the metronome synthesizes woodblock-style click pulses on every quarter-note beat with an accented pitch on beat 1 (downbeat) following the project tempo and time signature.

### 5. Web MIDI API & Hardware Controllers

- **Browser Support & Permissions**: Hardware MIDI via `navigator.requestMIDIAccess()` requires a Chromium-based or Web MIDI-enabled browser served over HTTPS (or `localhost`).
- **Fallback**: When Web MIDI is unavailable or permission is denied, Daw gracefully degrades to the on-screen `<scdaw-midi-keyboard>` and QWERTY keyboard input without disrupting audio playback or editing.
- **MIDI Learn & Right-Click Mapping**: Click **🎹 MIDI** in the transport bar to open the MIDI Devices & Routing dialog, use the **🎯 Learn** toggle in `<scdaw-mixer>`, or right-click any mixer fader, pan knob, M/S/R button, synth/device knob, or transport control to arm MIDI Learn for the next incoming CC.
- **Channel Numbering & `omni`**: Internal MIDI channels are 0-based (`0–15`, shown as `Ch 1–16` in the UI). Setting `channel: "omni"` (or omitting it in `set_midi_learn_mapping` / `scdaw_configure_midi`) matches messages on any MIDI channel; `"omni"` is the default for UI Learn and controller presets.
- **Default Parameter Ranges & Control Modes**:
  - Track `volume`: `0.0–1.5` (where `1.0` = `100` unity and `1.5` = `150` top of mixer fader)
  - Master `volume` (`trackId: "master"`): `0.0–1.0` (`0–100`)
  - Track `pan`: `-1.0–1.0`
  - Transport (`trackId: "transport"`): `play`, `stop`, `pause`, `panic` (`trigger` mode on press `>= 64`); `toggle_play`, `record`, `metronome` (`toggle` mode); `bpm` (`20–300`); `swing` (`0–0.5`)
  - Track buttons (`mute`, `solo`, `recordArm`): default to `toggle` mode (latches on CC value `>= 64` and ignores release `< 64`), with `momentary` and `trigger` modes also selectable.
- **Twin-Port De-duplication & Soft Takeover**: Controllers that expose paired USB inputs (such as `SINCO SMC-Mixer-Master` and `SINCO SMC-Mixer-Private`) are automatically de-duplicated within an 80 ms cross-port window, and individual input ports can be enabled or disabled in the MIDI dialog. Enable **Soft Takeover** to ignore hardware fader moves until they cross the current parameter value.
- **Reserved CCs, Presets & JSON Export/Import**: `CC 64` (Sustain Pedal), `CC 120` (All Sound Off), and `CC 123` (All Notes Off) trigger built-in DAW behavior and show a warning if mapped. Mappings persist with the project, can be exported/imported as portable JSON (`midi-mappings.json`), or populated in one click via the **M-VAVE SMC-Mixer** preset with 8-channel bank paging (`Tracks 1–7`, `8–14`, etc.).
- **Console / WebMCP Access**: Programmatic control is exposed on `window.__scdaw` (`sendCommand("set_midi_learn_mapping", ...)`, `sendCommand("apply_midi_controller_preset", ...)`) and via the `scdaw_configure_midi` and `scdaw_get_midi_status` tools.

### 6. Sharing Songs via Compressed URLs (`#file=`)

- **How it Works**: Clicking **"🔗 Press a URL"** in the Export modal compresses the `.scdaw.json` project using Web Streams (`deflate-raw`) + Base64URL and places it in the URL `#file=` hash fragment by default so large arrangements never trigger HTTP 431 / 414 header size limits. `?file=` query parameters are also supported on load.
- **Length Pre-Validation**: `validateBase64UrlLength` and `validateCompressedUrl` check candidate share URLs against browser length budgets (`MAX_HASH_URL_LENGTH` = `65536` chars; `MAX_QUERY_URL_LENGTH` = `8192` chars) before presenting a link, displaying an error in the modal recommending `.mid` or `.scdaw.json` export when exceeded.
- **Autoplay (`?autoplay=true`)**: Append `?autoplay=true` (or `?autoplay=1`, or `#...&autoplay=true`) to start playback automatically once the workbench loads—or immediately after confirming the **"Load Song from URL"** dialog when combined with `#file=` / `?file=`.
