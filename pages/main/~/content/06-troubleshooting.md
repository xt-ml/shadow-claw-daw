---
title: "Troubleshooting Guide"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "troubleshooting"
---

## Troubleshooting Guide

### 1. Audio is Locked / No Sound

Modern browsers prevent Web Audio contexts from producing sound without a user interaction.

- **Solution**: Open the workbench page at [`/main/scdaw/`](main/scdaw/) and click the **"🔊 Start Audio"** button in the transport bar.
- Note: Background tools (`scdaw_set_track`, `scdaw_write_notes`, `scdaw_bounce`) continue to function even while real-time audio playback is locked.

### 2. Tool Timed Out Awaiting DAW Response

Worker tools dispatch commands via `BroadcastChannel("scdaw-commands")`. If no browser tab has the workbench open, commands will time out after 5 seconds (or 30 seconds for `scdaw_bounce`).

- **Solution**: Navigate to [`/main/scdaw/`](main/scdaw/) in an active browser tab.

### 3. Multiple Tabs & Leader Election

Only one tab acts as the primary audio leader to avoid audio stutter and duplicate tool executions.

- Web Locks elect the first tab as the leader. Closing the leader tab automatically passes control to the next open workbench tab.
