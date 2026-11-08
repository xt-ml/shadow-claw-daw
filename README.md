# ShadowClaw DAW

An in-browser digital audio workstation (DAW) template powered by **ShadowClaw**, featuring a Vanilla JS Web Audio API engine, TC39-shaped reactive Signals, Web Components, and autonomous agent skills.

## Overview

- **Zero Runtime Dependencies**: 100% native Web Audio API, Web Components, and Vanilla JavaScript.
- **Agent Controllable**: 15 declarative `scdaw_*` WebMCP tools allowing AI assistants to compose beats, patch synthesizers, mix channels, inspect telemetry, and bounce audio.
- **Reactive UI**: Custom elements (`<scdaw-workbench>`, `<scdaw-transport>`, `<scdaw-mixer>`, `<scdaw-sequencer>`) synchronized via microtask-batched Signals.
- **Autonomous Skills**: Agent routines including `/beat`, `/jam`, `/mixdown`, `/bounce`, `/scdaw-status`, and `/scdaw-doctor`.
- **Offline WAV Bounce**: High-speed offline rendering via `OfflineAudioContext` with immediate in-browser download and metadata export.

## Commands

```bash
npm test                  # Run node:test unit suites
npm run check             # Run namespace and tool schema verification
npm run build:tools       # Regenerate .agents/tools/*.json from manifest
npm run skills:index      # Regenerate .well-known/agent-skills/index.json
npx shadow-claw dev       # Start local development preview server
npx shadow-claw build     # Production static build to dist/public
```

## License

AGPLv3.

## Attribution & Provenance

This software contains ported concepts and formulas derived from **[openDAW](https://github.com/andremichelle/openDAW)** (commit `10088021dc881adf2aa981686e0e8be9cf3a1cd4`), licensed under **AGPL-3.0-or-later**, copyright © André Michelle and openDAW contributors. Detailed porting records can be found in ["Porting and Attribution"](pages/main/~/content/05-porting-and-attribution.md).
