# [ShadowClaw DAW](https://xt-ml.github.io/shadow-claw-daw/main/)

[![Ask DeepWiki](https://img.shields.io/badge/DeepWiki-xt--ml%2Fshadow--claw--daw-blue.svg)](https://deepwiki.com/xt-ml/shadow-claw-daw)

An in-browser digital audio workstation (DAW) template powered by **ShadowClaw**, featuring a Vanilla JS Web Audio API engine, TC39-shaped reactive Signals, Web Components, and autonomous agent skills.

## Overview

- **Zero Runtime Dependencies**: 100% native Web Audio API, Web Components, and Vanilla JavaScript.
- **Agent Controllable**: 25 declarative `scdaw_*` WebMCP tools allowing AI assistants to compose beats, patch synthesizers, manage MIDI & Audio FX chains, mix channels, inspect telemetry, exchange DAWproject / MIDI sessions, and bounce audio.
- **Reactive UI & Mobile-First Workbench**: 11 modular Custom Elements (`<scdaw-workbench>`, `<scdaw-transport>`, `<scdaw-browser>`, `<scdaw-timeline>`, `<scdaw-editor>`, `<scdaw-sequencer>`, `<scdaw-devices>`, `<scdaw-mixer>`, `<scdaw-knob>`, `<scdaw-resize-handle>`, `<scdaw-statusbar>`) synchronized via microtask-batched Signals, designed mobile-first with CSS Container Queries, BEM conventions, and WCAG 2.1 AA ARIA compliance.
- **Autonomous Skills**: Agent routines including `/beat`, `/jam`, `/mixdown`, `/bounce`, `/scdaw-status`, and `/scdaw-doctor`.
- **Storage, Interchange & Offline Bounce**: High-speed offline 16/24/32-bit WAV rendering (`OfflineAudioContext`), multi-tap stem ZIP exports, SMF MIDI (`.mid`), and DAWproject v1.0 (`.dawproject`) interchange with direct OPFS conversation file persistence and browser downloads.

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

## [Attribution & Provenance](pages/main/~/content/05-porting-and-attribution.md)
