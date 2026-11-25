# [ShadowClaw DAW](https://xt-ml.github.io/shadow-claw-daw/main/)

[![ShadowClaw](https://img.shields.io/badge/Github-xt--ml%2Fshadow--claw-red.svg)](https://github.com/xt-ml/shadow-claw)
[![ShadowClaw DAW](https://img.shields.io/badge/Github-xt--ml%2Fshadow--claw--daw-green.svg)](https://github.com/xt-ml/shadow-claw-daw)
[![Ask DeepWiki](https://img.shields.io/badge/DeepWiki-xt--ml%2Fshadow--claw--daw-blue.svg)](https://deepwiki.com/xt-ml/shadow-claw-daw)

An in-browser digital audio workstation (DAW) template powered by **[ShadowClaw](https://github.com/xt-ml/shadow-claw)**, featuring a Vanilla JS Web Audio API engine, TC39-shaped reactive Signals, Web Components, and autonomous agent skills.

## Overview

- **Zero Runtime Dependencies**: 100% native Web Audio API, Web Components, Web MIDI API, Web Streams compression, and Vanilla JavaScript (with optional Web Worker and Rust/WASM DSP acceleration hooks that fall back automatically to pure JS).
- **Audio Clip Editing, Spectral Restoration & Analysis**: Non-destructive clip editing (`split`, `trim`, `duplicate`, `join`, equal-power `crossfade`, fade curves, gain envelopes, `split_at_silences`, non-destructive `pitch`/`speed`/`stretchToMatchTempo`), pure-JS offline `Float32Array` DSP with lossless versioned undo (`normalize`, EBU R128 LUFS/RMS `loudness`, DC offset, invert, reverse, `click_removal`, tone/noise/DTMF/silence generators), radix-2 FFT/STFT spectral suite (two-step `noise_profile` + `noise_reduction`, spectrogram palettes/scales, `spectral_edit`, `clipping`/`silence_finder`/`beat_finder` analysis), WSOLA time-stretching & pitch-shifting, `truncate_silence`, and project point/region/spectral label tracks (`split_at_labels`).
- **Autonomous Song Composition**: Multi-bar arrangement engine (`shadow-claw-daw-compose.js`) compiling complete multi-track songs from high-level `SongSpec` declarations, chord progressions, genre feel templates, and custom signature motifs with rest parsing.
- **SoundFont 2 Synthesis**: Built-in SF2 engine (`shadow-claw-daw-soundfont.js`) bundling General MIDI SoundFonts (`A320U.sf2`, `gm-lofi.sf2`) with 128 GM instruments, multi-zone sample decoding, voice DSP, and procedural drum synthesis fallback.
- **Web MIDI & Software Keyboard**: Native Web MIDI API hardware I/O (`shadow-claw-daw-midi-io.js`) with hot-plug device enumeration, multi-target MIDI Learn CC mapping (track volume `0–1.5`, pan, mute/solo/record-arm toggles, master volume, transport play/stop/BPM/swing), interactive MIDI dialog & right-click / mixer `🎯 Learn` UI, 80 ms twin-port deduplication, per-port toggles, Soft Takeover, `M-VAVE SMC-Mixer` controller preset with 8-channel bank paging, portable JSON mapping export/import, live MIDI monitor, live note capture, and an accessible on-screen / QWERTY `<shadow-claw-daw-midi-keyboard>` fallback featuring multi-touch & pointer drag-glissando play, toggleable Ableton (`A–'`, `Z`/`X` octave) and 2-octave (`Z–M` / `Q–U`, `-`/`=` octave) QWERTY layouts with on-key shortcut badges, Hold/Sustain modes, and Piano Roll key glissando auditioning.
- **Agent Controllable**: 50 declarative `scdaw_*` WebMCP tools allowing AI assistants to compose complete songs (`20–300` BPM, compound/mixed meters, `legato` phrasing), inspect score views (`scdaw_get_project` `view: "score"`), query schemas (`scdaw_list_schemas`), design sounds (`scdaw_design_sound`), import & arrange audio clips, process offline/spectral/WSOLA DSP, manage project labels, arm recording, toggle metronomes, automate parameters, configure sends, patch synthesizers, manage MIDI & Audio FX chains, route and trigger live MIDI, analyze mix dynamics, exchange DAWproject / MIDI sessions, and bounce audio.
- **Reactive UI & Mobile-First Workbench**: 15 modular Custom Elements (`<shadow-claw-daw-workbench>`, `<shadow-claw-daw-transport>`, `<shadow-claw-daw-browser>`, `<shadow-claw-daw-timeline>`, `<shadow-claw-daw-editor>`, `<shadow-claw-daw-wave-editor>`, `<shadow-claw-daw-spectrum>`, `<shadow-claw-daw-sequencer>`, `<shadow-claw-daw-synth>`, `<shadow-claw-daw-devices>`, `<shadow-claw-daw-mixer>`, `<shadow-claw-daw-knob>`, `<shadow-claw-daw-resize-handle>`, `<shadow-claw-daw-status-bar>`, `<shadow-claw-daw-midi-keyboard>`) synchronized via microtask-batched Signals, designed mobile-first with CSS Container Queries, `@supports not (container-type: inline-size)` fallbacks, `@media (pointer: coarse)` 44×44px touch targets, BEM conventions, WCAG 2.1 AA ARIA compliance & keyboard navigation, native modal recording error dialogs + workbench error alerts, distraction-free full-screen focus mode, full-width focus views (`📁 Browser (Full)`, `🎚 Mixer (Full)`, `🎹 Piano Roll (Full)`, `🥁 Drum Matrix (Full)`, `🎛️ Synth (Full)`, `🌊 Audio (Full)`), `20–300` BPM and extended time signature controls, Play/Pause & timeline ruler scrubbing, interactive bar length controls, zero-pause live note/parameter editing, magnetic audio snapping, drag-and-drop audio import, and touch-friendly track re-ordering.
- **Autonomous Skills**: Agent routines including `/song`, `/beat`, `/jam`, `/acid-jam`, `/trap-beat`, `/lofi-session`, `/soundfont-orchestra`, `/mixdown`, `/bounce`, `/scdaw-status`, `/scdaw-doctor`, `/scdaw-automate`, `/scdaw-audio-clip`, `/audio-editing`, and `/scdaw-record`.
- **Storage, Interchange, URL Sharing & Offline Bounce**: High-speed offline 16/24/32-bit WAV rendering (`OfflineAudioContext`), multi-tap stem ZIP exports, SMF MIDI (`.mid` with `tempoMap`/`signatureMap`), DAWproject v1.0 (`.dawproject`) interchange preserving clip fades, gain envelopes, and labels, length-pre-validated compressed `#file=` / `?file=` URL song sharing (`🔗 Press a URL` + `?autoplay=true`), and direct OPFS conversation file persistence and browser downloads.

## Documentation

| Topic                                 | Source                                                                              | Live Site                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Live Workbench                        | [pages/main/index.html](pages/main/index.html)                                      | [shadow-claw-daw/main/](https://xt-ml.github.io/shadow-claw-daw/main/)                                 |
| Architecture & Engine                 | [01-architecture.md](pages/main/~/content/01-architecture.md)                       | [main/architecture/](https://xt-ml.github.io/shadow-claw-daw/main/architecture/)                       |
| WebMCP Tools Reference                | [02-tools.md](pages/main/~/content/02-tools.md)                                     | [main/tools/](https://xt-ml.github.io/shadow-claw-daw/main/tools/)                                     |
| Autonomous Agent Skills               | [03-skills.md](pages/main/~/content/03-skills.md)                                   | [main/skills/](https://xt-ml.github.io/shadow-claw-daw/main/skills/)                                   |
| Workbench, Piano Roll & MIDI Keyboard | [04-workbench.md](pages/main/~/content/04-workbench.md)                             | [main/workbench/](https://xt-ml.github.io/shadow-claw-daw/main/workbench/)                             |
| Attribution & Provenance              | [05-porting-and-attribution.md](pages/main/~/content/05-porting-and-attribution.md) | [main/porting-and-attribution/](https://xt-ml.github.io/shadow-claw-daw/main/porting-and-attribution/) |
| Troubleshooting & URL Sharing         | [06-troubleshooting.md](pages/main/~/content/06-troubleshooting.md)                 | [main/troubleshooting/](https://xt-ml.github.io/shadow-claw-daw/main/troubleshooting/)                 |
| Song Showcase & Programmatic Examples | [07-examples.md](pages/main/~/content/07-examples.md)                               | [main/examples/](https://xt-ml.github.io/shadow-claw-daw/main/examples/)                               |
| Agent Memory                          | [MEMORY.md](pages/main/MEMORY.md)                                                   | [main/memory/](https://xt-ml.github.io/shadow-claw-daw/main/memory/)                                   |

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
