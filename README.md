# [ShadowClaw DAW](https://xt-ml.github.io/shadow-claw-daw/main/)

[![ShadowClaw](https://img.shields.io/badge/Github-xt--ml%2Fshadow--claw-red.svg)](https://github.com/xt-ml/shadow-claw)
[![ShadowClaw DAW](https://img.shields.io/badge/Github-xt--ml%2Fshadow--claw--daw-green.svg)](https://github.com/xt-ml/shadow-claw-daw)
[![Ask DeepWiki](https://img.shields.io/badge/DeepWiki-xt--ml%2Fshadow--claw--daw-blue.svg)](https://deepwiki.com/xt-ml/shadow-claw-daw)

An in-browser digital audio workstation (DAW) template powered by **[ShadowClaw](https://github.com/xt-ml/shadow-claw)**, featuring a Vanilla JS Web Audio API engine, TC39-shaped reactive Signals, Web Components, and autonomous agent skills.

## Overview

- **Zero Runtime Dependencies**: 100% native Web Audio API, Web Components, and Vanilla JavaScript.
- **Autonomous Song Composition**: Multi-bar arrangement engine (`scdaw-compose.js`) compiling complete multi-track songs from high-level `SongSpec` declarations, chord progressions, genre feel templates, and custom signature motifs with rest parsing.
- **SoundFont 2 Synthesis**: Built-in SF2 engine (`scdaw-soundfont.js`) bundling General MIDI SoundFonts (`A320U.sf2`, `gm-lofi.sf2`) with 128 GM instruments, multi-zone sample decoding, voice DSP, and procedural drum synthesis fallback.
- **Agent Controllable**: 40 declarative `scdaw_*` WebMCP tools allowing AI assistants to compose complete songs, arrange audio tracks and clips, arm recording, toggle metronomes, automate parameters, configure sends, patch synthesizers, manage MIDI & Audio FX chains, analyze mix dynamics, exchange DAWproject / MIDI sessions, and bounce audio.
- **Reactive UI & Mobile-First Workbench**: 11 modular Custom Elements (`<scdaw-workbench>`, `<scdaw-transport>`, `<scdaw-browser>`, `<scdaw-timeline>`, `<scdaw-editor>`, `<scdaw-sequencer>`, `<scdaw-devices>`, `<scdaw-mixer>`, `<scdaw-knob>`, `<scdaw-resize-handle>`, `<scdaw-statusbar>`) synchronized via microtask-batched Signals, designed mobile-first with CSS Container Queries, BEM conventions, WCAG 2.1 AA ARIA compliance, distraction-free full-screen focus mode, magnetic audio snapping, and touch-friendly track re-ordering.
- **Autonomous Skills**: Agent routines including `/song`, `/beat`, `/jam`, `/acid-jam`, `/trap-beat`, `/lofi-session`, `/soundfont-orchestra`, `/mixdown`, `/bounce`, `/scdaw-status`, `/scdaw-doctor`, `/scdaw-automate`, `/scdaw-audio-clip`, and `/scdaw-record`.
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
