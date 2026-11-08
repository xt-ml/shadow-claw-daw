---
title: "Interactive Workbench UI"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "workbench"
---

## Interactive Workbench UI

Accessible directly at `/pages/main/index.html` (`/main/`):

- **Main Shell (`<scdaw-workbench>`)**: Integrated studio docking workbench featuring collapsible dock toggles (`📁 Browser`, `🎛 Studio`, `🎛 Mixer`), full-width focus views (`🎚 Mixer (Full)`, `🎹 Piano Roll (Full)`, `🥁 Drum Matrix (Full)`), an in-studio Detail Editor Switcher (`🎹 Piano Roll`, `🥁 Step Sequencer`, `🎛️ Device Rack`), accessible `<shadow-claw-dialog>` confirmation modals, OPFS Save/Export and Open/Import dialogs, context-sensitive drag-and-drop import, Undo history, and instant offline WAV bouncing.
- **Transport Bar (`<scdaw-transport>`)**: Mobile-first Play/Stop transport controls, Start Audio unlock button, LCD musical position readout (`Bar : Beat : 16th`), wheel-adjustable BPM tempo and swing timing controls, loop length badge, and Panic (`All Notes Off`) button.
- **Library Browser (`<scdaw-browser>`)**: Left-hand library dock with categorized tabs for Presets, Devices (Instruments, Audio FX, MIDI FX), Conversation Files (OPFS), and All items with instant search filtering, drag-and-drop payload support, and one-click track loading.
- **Arrangement Timeline (`<scdaw-timeline>`)**: Multi-track timeline view with measure ruler, playhead scrubber, sticky track headers with Mute and Solo controls, click-to-select track synchronization across the studio, and visual clip blocks showing pattern activity.
- **Note Editor & Piano Roll (`<scdaw-editor>`)**: 2D chromatic piano roll editor with sticky piano key labels, octave/pitch grid, scroll-position preservation, velocity stalks, chord insertion shortcut, and a responsive Note Inspector.
- **Pattern Step Sequencer (`<scdaw-sequencer>`)**: 16-step drum and synth matrix sequencer with step-memory preservation (toggling steps preserves original pitch and duration) and active playhead tracking.
- **Device Rack Inspector (`<scdaw-devices>`)**: Modular horizontal device rack synchronized to the selected track, displaying its MIDI FX, Instrument voice engine (`Vaporisateur` or `Playfield`), and Audio FX chain with `<scdaw-knob>` rotary controls and device reset actions.
- **Mixer Console (`<scdaw-mixer>`)**: Multi-channel mixing console with pointer-captured vertical faders (supporting drag, mouse wheel, and double-click reset), `<scdaw-knob>` stereo pan controls, 14-segment peak/clipping LED meters, track selection highlighting, mute/solo/reset actions, and master output strip.
- **Rotary Parameter Knob (`<scdaw-knob>`)**: High-precision rotary control supporting linear and exponential scaling, mouse/touch drag, mouse wheel adjustment, and double-click to restore parameter schema default.
- **Split-Pane Resize Handle (`<scdaw-resize-handle>`)**: Accessible, touch-friendly vertical panel splitter supporting pointer-captured dragging, `invert` direction awareness for right-hand docks, keyboard adjustment via Arrow keys (with Shift acceleration and Home/End boundaries), and WCAG 2.1 AA `role="separator"` ARIA telemetry.
- **Status Bar (`<scdaw-statusbar>`)**: Responsive bottom telemetry strip displaying audio context state, project summary (`Name · BPM · Tracks`), bounce telemetry, and leader lock status.

### Responsive Design, BEM & Accessibility

All components use strict BEM naming and declare `container-type: inline-size;` with `@container` queries and `@media` fallbacks:

- **Mobile First (`< 640px`)**: Single-column stacked layout with responsive toolbar button grids, zero horizontal page overflow, touch-friendly horizontal scroll containers (`overscroll-behavior-x: contain`), and sticky track/key headers.
- **Multi-Pane Studio Layout (`>= 640px` & `>= 1024px`)**: Resizable 3-column CSS Grid studio arrangement (`Browser` | `<scdaw-resize-handle>` | `Center Stack` | `<scdaw-resize-handle>` | `Mixer`) where either side dock can be independently toggled while keeping the Timeline, Detail Editor, and Device Rack centered.
- **Full-Width Focus Modes**: Instant 100%-width workspace expansion for `🎚 Mixer (Full)`, `🎹 Piano Roll (Full)`, and `🥁 Drum Matrix (Full)`, automatically hiding inactive docks and resize splitters via `.hidden` / `[hidden]`.
