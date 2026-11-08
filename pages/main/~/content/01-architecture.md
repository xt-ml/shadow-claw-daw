---
title: "Architecture & Audio Pipeline"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "architecture"
---

# Architecture & Audio Pipeline

Daw is built upon a 4-tier modular architecture designed for maximum performance, offline resilience, and seamless control by AI agents.

## Architectural Layers

1. **Pure Logic & Math (`scdaw.js`, `scdaw-signals.js`)**:
   - Zero DOM or browser dependencies.
   - Exact Pulses Per Quarter Note (PPQN = 960) musical timebase math.
   - Deterministic transaction reducers (`applyCommand`).
   - 16-bit PCM RIFF WAVE binary encoder.
   - Microtask-batched reactive Signals for UI and engine state.

2. **Web Audio Synthesis & Scheduling (`scdaw-engine.js`, `scdaw-instruments.js`)**:
   - Non-blocking Web Worker clock tick (25ms) impervious to background tab throttling.
   - Lookahead event scheduler buffering audio nodes 100ms in advance.
   - Polyphonic synthesizers and procedural drum generators.
   - Dynamic audio node graph with track gain, panning, analysis, and a master bus safety limiter.

3. **IPC Bridge & WebMCP Adapter (`scdaw-adapter.js`)**:
   - Web Locks leader election ensuring exactly one document holds the AudioContext and replies to agent tool dispatches.
   - Dual BroadcastChannel protocol (`scdaw-commands`, `scdaw-results`) providing sub-millisecond local RPC between the ShadowClaw agent worker and workbench.
   - `scdaw-state` event broadcasting keeping detached UI surfaces synchronized at 10 Hz.
   - Native ModelContext API registration.

4. **Web Component Workbench (`scdaw-element.js`)**:
   - Encapsulated Custom Elements `<scdaw-workbench>`, `<scdaw-transport>`, `<scdaw-mixer>`, `<scdaw-sequencer>`.
   - Shadow DOM styling using system `--shadow-claw-*` design tokens.
