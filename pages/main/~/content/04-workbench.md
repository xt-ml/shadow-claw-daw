---
title: "Interactive Workbench UI"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "workbench"
---

## Interactive Workbench UI

Accessible at `/pages/main/scdaw.html` (`/main/scdaw/`):

- **Main Shell (`<scdaw-workbench>`)**: Integrated studio docking workbench featuring collapsible dock toggles for Browser, Sequencer/Editor, Devices, and Mixer panels, project renaming, Undo/Redo history buttons, panic button (All Notes Off), and instant offline WAV bouncing.
- **Transport Bar (`<scdaw-transport>`)**: Play/Stop/Loop transport controls, LCD musical position readout (`Bar.Beat.16th`), BPM tempo control, time signature (`4/4`), swing timing slider, panic button, and master volume output fader.
- **Library Browser (`<scdaw-browser>`)**: Left-hand library dock with categorized browsing for Presets (Bass, Pluck, Pad, Lead), Devices (Instruments, Audio FX, MIDI FX), and All items with instant search filtering and one-click track audition/loading.
- **Arrangement Timeline (`<scdaw-timeline>`)**: Multi-track timeline view with measure ruler, playhead scrubber, track headers with Mute, Solo, and Reset controls, and visual clip blocks showing note activity.
- **Note Editor & Piano Roll (`<scdaw-editor>`)**: 2D chromatic piano roll editor with octave/pitch grid, note creation, velocity stalks, and a detailed Note Inspector showing pitch, start pulse, duration, and velocity.
- **Pattern Step Sequencer (`<scdaw-sequencer>`)**: 16-step matrix sequencer with step-memory preservation (toggling steps preserves original pitch and duration), track mute/solo buttons, and active playhead tracking.
- **Device Rack Inspector (`<scdaw-devices>`)**: Modular horizontal device rack displaying the selected track's MIDI FX, Instrument voice engine, and Audio FX chain with bypass switches, parameter rotary knobs, and device reset buttons.
- **Mixer Console (`<scdaw-mixer>`)**: Multi-channel mixing console with vertical faders, `<scdaw-knob>` stereo pan controls, 12-segment peak/clipping LED meters, track mute/solo/reset actions, and master output strip.
- **Rotary Parameter Knob (`<scdaw-knob>`)**: High-precision rotary control supporting linear and exponential scaling, mouse drag, mouse wheel adjustment, and double-click to restore parameter schema default.
- **Split-Pane Resize Handle (`<scdaw-resize-handle>`)**: Accessible, touch-friendly panel divider supporting mouse/touch pointer dragging (`setPointerCapture`), keyboard adjustment via Arrow keys (Home/End boundaries), and WCAG 2.1 AA `role="separator"` ARIA telemetry.
- **Status Bar (`<scdaw-statusbar>`)**: Bottom telemetry and diagnostics strip displaying DSP sample rate, buffer size, active audio latency, voice count, and openDAW provenance attribution.

### Responsive Design & CSS Container Queries

All components declare `container-type: inline-size;` and adapt component layouts using `@container`:

- **Mobile (< 640px)**: Single-column stacked mode with touch-friendly horizontal swipe navigation and sticky track headers.
- **Full-Width Focus Modes**: Instant expansion for `🎹 Piano Roll (Full)`, `🥁 Drum Matrix (Full)`, and `🎚 Mixer (Full)` to utilize 100% of the available workbench space without cramped docks.
- **Desktop (> 1024px)**: 3-dock studio arrangement with resizable panel dividers between Library Browser, Arrangement Timeline / Editor, and Mixer Console.
