---
title: "Architecture & Audio Pipeline"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "architecture"
---

## Architecture & Audio Pipeline

Daw is built upon a 4-tier modular architecture designed for maximum performance, offline resilience, and seamless control by AI agents.

### Architectural Layers

1. **Pure Logic, Schemas & Codecs (`scdaw.js`, `scdaw-schema.js`, `scdaw-presets.js`, `scdaw-dsp.js`, `scdaw-midi.js`, `scdaw-dawproject.js`, `scdaw-zip.js`, `scdaw-signals.js`)**:
   - Zero DOM or browser dependencies.
   - Exact Pulses Per Quarter Note (`PPQN = 960`) musical timebase math and 16th-note swing displacement.
   - Deterministic transaction reducers (`applyCommand`) and undo snapshot history.
   - 16-bit, 24-bit PCM, and 32-bit Float RIFF WAVE binary encoders, pure-JS ZIP archive codec with CRC-32 integrity, SMF Format 0/1 MIDI codec, and DAWproject v1.0 XML/ZIP interchange.
   - Microtask-batched reactive Signals for UI and engine state.

2. **Web Audio Synthesis, Scheduling & Storage (`scdaw-engine.js`, `scdaw-instruments.js`, `scdaw-fs.js`)**:
   - Non-blocking Web Worker clock tick (25ms) impervious to background tab throttling.
   - Lookahead event scheduler buffering audio nodes 100ms in advance.
   - Polyphonic `Vaporisateur` dual-oscillator synthesizers, procedural 12-drum `Playfield` synthesizers, and extended MIDI/Audio FX chains (equalizer, delay, reverb, bitcrusher, wavefolder, stereo tool).
   - Dynamic audio node graph with track gain, stereo panning, real-time peak/RMS analysis, master bus safety limiter, offline WAV/stem rendering, and direct OPFS conversation file persistence.

3. **IPC Bridge & WebMCP Adapter (`scdaw-adapter.js`)**:
   - Web Locks leader election ensuring exactly one document holds the AudioContext and replies to agent tool dispatches.
   - Dual BroadcastChannel protocol (`scdaw-commands`, `scdaw-results`) providing sub-millisecond local RPC between the ShadowClaw agent worker and workbench.
   - `scdaw-state` event broadcasting keeping detached UI surfaces synchronized at 10 Hz.
   - Native ModelContext API registration for all 25 `scdaw_*` tools.

4. **Mobile-First Web Component Workbench (`scdaw-element.js`, `components/scdaw-*.js`)**:
   - 11 encapsulated Custom Elements (`<scdaw-workbench>`, `<scdaw-transport>`, `<scdaw-browser>`, `<scdaw-timeline>`, `<scdaw-editor>`, `<scdaw-sequencer>`, `<scdaw-devices>`, `<scdaw-mixer>`, `<scdaw-knob>`, `<scdaw-resize-handle>`, `<scdaw-statusbar>`).
   - Mobile-first responsive CSS Container Queries (`@container`), `@media` graceful degradation fallbacks, strict BEM naming, WCAG 2.1 AA ARIA landmarks, and Shadow DOM styling using `--shadow-claw-*` design tokens.
