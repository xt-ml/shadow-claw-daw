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

### 6. Sharing Songs via Compressed URLs (`#file=`)

- **How it Works**: Clicking **"🔗 Press a URL"** in the Export modal compresses the `.scdaw.json` project using Web Streams (`deflate-raw`) + Base64URL and places it in the URL `#file=` hash fragment by default so large arrangements never trigger HTTP 431 / 414 header size limits. `?file=` query parameters are also supported on load.
