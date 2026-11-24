# AGENTS.md — ShadowClaw DAW (Daw)

> Guidance for AI agents working on the ShadowClaw DAW site, tools, and agentic skills.

## Project Snapshot

In-browser Digital Audio Workstation (DAW) workbench, Web Audio API synthesis engine, TC39 Signals, declarative WebMCP tools, and autonomous skills:

- **Assistant Name**: `ShadowClaw DAW` (`Daw`)
- **Prefix Isolation**:
  - Tools prefix: `scdaw_*` (50 declarative tools)
  - Custom Elements prefix: `scdaw-*` (15 modular Web Components)
  - Broadcast Channels: `scdaw-commands`, `scdaw-results`, `scdaw-state`
  - Pinned workbench: `pages/main/index.html` (`/main/`)

## Subsystem Architecture & Guardrails

1. **Direct-Rendered Pinned Workbench (`pages/main/index.html`)**:
   - `AudioContext` requires top-level execution contexts and user gestures to resume audio rendering.
   - `pages/main/index.html` specifies `iframe: false` in frontmatter and is configured as `defaultPinnedPage` and listed in `pages.directPages` in `shadow-claw.config.json`.
   - The audio engine singleton lives in `globalThis.__scdaw` to survive page transitions.
   - Leader election via Web Locks (`navigator.locks.request("scdaw-engine")`) ensures only one active workbench tab controls the AudioContext and replies to agent tool requests over `BroadcastChannel`.

2. **Namespace Isolation**:
   - Strictly enforced by `npm run check:compat` (`bin/check-namespace.mjs`).
   - Every tool must start with `scdaw_`.
   - Every custom element must start with `scdaw-`.
   - All BroadcastChannels must start with `scdaw-`.

3. **Pure Logic, Storage & Transports Separation**:
   - Core musical math, `20–300` BPM bounds (`MIN_BPM`/`MAX_BPM`), PPQN=960 constants (including dotted, triplet, and 32nd durations), mixed time-signature timeline helpers (`getNormalizedSignatureMap`, `getBarTimeline`, `pulseToBarBeat`, `computeProjectTotalPulses`), score view (`projectToScoreView`), project validation, transaction reducers (including non-destructive audio clip editing `split`/`trim`/`duplicate`/`join`/`crossfade`/fades/envelopes/`pitch`/`speed`, project `labels` + `split_at_labels`, `RESERVED_MIDI_CCS`, `MIDI_CONTROLLER_PRESETS` `"smc-mixer"`, `resolveMidiMappingDefaults`, `clear_midi_learn_mappings`, `apply_midi_controller_preset`, and `import_midi_learn_mappings`), audio clip scheduling (`evaluateClipGainEnvelope`, `computeClipPlaybackParams`), continuous parameter automation interpolation (`automationValueAt`), and WAV encoding live in `.agents/scripts/scdaw.js` (zero DOM / Web Audio dependencies, 100% unit tested).
   - Pure-JS `Float32Array` offline audio DSP (`scdaw-audio-dsp.js`), FFT/STFT spectral restoration & analysis (`scdaw-spectral-dsp.js`), WSOLA time-stretch/pitch-shift & silence truncation (`scdaw-time-dsp.js`), and optional Web Worker / Rust-WASM backend adapter with automatic pure-JS fallback (`scdaw-audio-dsp-worker.js`) run identically in Node.js and browsers.
   - High-level song composition engine, multi-bar arrangement compiler (`compileSong` with `legato` phrasing and compound/odd meter bar math), multi-chord bar parser (`parseProgression`), rest parsing (`parseMotif`), custom signature motifs (`motifs: { bass, rhythm, lead }`), and genre feel templates live in `.agents/scripts/scdaw-compose.js`.
   - SoundFont 2 (SF2) RIFF parser, sample decoding, generator resolution, zone simplification, voice DSP (pitch interpolation, ADSR envelope, filter smoothing, pan), GM instrument map (128 melodic programs + drum kit aliases), and sample caching live in `.agents/scripts/scdaw-soundfont.js`.
   - Parameter schemas (`TRANSPORT_SCHEMA`, `INSTRUMENT_SCHEMAS`, `FX_SCHEMAS`), automatable parameter definitions (`AUTOMATABLE_PARAMS`), curated presets, and custom DSP curves/processors (overdrive, wavefolder, bitcrusher, stereo tool, plate reverb, mix analysis) live in `.agents/scripts/scdaw-schema.js`, `.agents/scripts/scdaw-presets.js`, and `.agents/scripts/scdaw-dsp.js`.
   - SMF MIDI codec (with `tempoMap`/`signatureMap` conductor tracks and Format 0 velocity scaling), live MIDI message parsing/encoding, DAWproject v1.0 XML/ZIP interchange (including Points automation lanes, embedded Audio clips with fades/envelopes/pitch/speed, and project `<Markers>` labels), optional lazy FFmpeg WASM audio export (`mp3`, `ogg`, `opus`, `flac`, `m4a` alongside native WAV), zero-dependency ZIP archive encoding/decoding, compressed `#file=` / `?file=` URL sharing (`CompressionStream`/`DecompressionStream` + Base64URL with `validateBase64UrlLength`/`validateCompressedUrl` pre-validation; see `pages/main/~/content/07-examples.md` `/main/examples/` for the headless Python `zlib` `wbits=-15` generator pattern), and OPFS conversation storage live in `.agents/scripts/scdaw-midi.js`, `.agents/scripts/scdaw-dawproject.js`, `.agents/scripts/scdaw-encoders.js`, `.agents/scripts/scdaw-zip.js`, `.agents/scripts/scdaw-compress.js`, `.agents/scripts/scdaw-url-param.js`, and `.agents/scripts/scdaw-fs.js`.
   - Web MIDI API integration, hot-plug device enumeration, multi-target MIDI Learn CC mapping (tracks, `mute`/`solo`/`recordArm`, `master`, `transport`), `continuous`/`toggle`/`momentary`/`trigger` modes, 80 ms twin-port duplicate filtering, per-port input filtering, Soft Takeover, live MIDI monitor, hardware MIDI output, and `SoftwareMidiInput` QWERTY keyboard fallback (dual `QWERTY_LAYOUTS` `"ableton"` and `"two-octave"`, `e.code`-first Shift-safe tracking, reactive `state` signal, `shouldHandleSoftwareKeyboardEvent` modifier/editable/dialog guard, and selective `releaseHeldKeys`) live in `.agents/scripts/scdaw-midi-io.js`.
   - Reactive signal primitives live in `.agents/scripts/scdaw-signals.js`.
   - Instrument synthesis (`Vaporisateur` synth, `Tubular` 6-operator / 32-algorithm DX7 FM, `PSG` YM2149 chiptune, `Playfield` drums, and SoundFont GM voices), DX7 `.syx` cartridge codec (`.agents/scripts/scdaw-syx.js`), timeline audio clip buffer playback with fade/envelope/rate/detune automation, versioned immutable sample keys (`processAudioClip`), base64/RIFF-WAVE PCM import fallback (`importAudioFile`), `splitClipAtSilences`, `analyzeAudioClip` (`stats`, `spectrum`, `clipping`, `silence_finder`, `beat_finder`, `spectrogram` + optional `createLabels`), user-facing error surfacing (`formatUserError`, `reportError`/`clearError`), real-time lookahead scheduling with clock stall recovery, Play/Pause/Seek (`pause()`, `seek(ppqn)`), live parameter modulation fast paths (`liveRevision`), auxiliary send/bus routing, reactive track selection (`selectedTrackId`), and offline WAV/stems bouncing live in `.agents/scripts/scdaw-engine.js` and `.agents/scripts/scdaw-instruments.js`.
   - UI Web Components live in `.agents/scripts/scdaw-element.js` and `.agents/scripts/components/scdaw-*.js` (including `scdaw-wave-editor.js`, `scdaw-spectrum.js`, `scdaw-synth.js`, and `scdaw-midi-keyboard.js`), featuring native modal `<dialog id="scdaw-error-dialog">` recording/MIDI error surfacing + `#scdaw-error-banner` + `#error-stat`, timeline label lane + audio fade handles + drag-and-drop audio import, pointer drag-glissando play/audition on `<scdaw-midi-keyboard>` and `<scdaw-editor>`, and `setupWorkbenchMidiKeyboard` (`scdaw-workbench.js`).
   - Worker-to-main IPC bridge and WebMCP registration live in `.agents/scripts/scdaw-adapter.js`.

4. **Mobile-First Responsive Layout, BEM & Accessibility**:
   - All UI components follow a **Mobile-First** architecture with progressive enhancement via `min-width` `@container` queries (`< 640px` stacked mobile layout, `>= 640px` and `>= 1024px` multi-pane studio CSS Grid) and `@supports not (container-type: inline-size)` isolated `@media` fallbacks so desktop viewport widths never override narrow docked containers.
   - In `<scdaw-workbench>`, the 4 toolbar groups (`--project`, `--docks`, `--actions`, `--views`) are flattened sibling flex children of `.scdaw-workbench__toolbar` with `flex: 0 0 auto` at `>= 640px` so groups flow directly to the right of `Reset` and wrap cleanly as whole units without `overflow-x: auto` scrollbars or overlapping adjacent buttons.
   - Styling uses strict BEM naming conventions (`.scdaw-workbench__*`, `.scdaw-transport__*`, `.scdaw-statusbar__*`, `.scdaw-timeline__*`, `.scdaw-devices__*`, `.scdaw-knob__*`), `@media (pointer: coarse)` touch target sizing, and WCAG 2.1 AA ARIA landmarks, `role="slider"` / `role="separator"` / `role="button"` keyboard navigation (including piano roll, step sequencer, velocity stalks, and file lists), `aria-pressed` / `aria-selected` states, `"browser-full"` mobile focus view, and `:focus-visible` outlines.
   - Panel and splitter visibility in `<scdaw-workbench>` is controlled via `.hidden` / `[hidden]` (`display: none !important`). Never force `<scdaw-resize-handle>` visible with `!important` in container queries, and ensure `#mixer-handle` retains the `invert` attribute so dragging left expands the right-hand Mixer dock.
   - When checking Web IDL interfaces such as `LaunchParams`, always test property existence with `"files" in window.LaunchParams.prototype` rather than invoking prototype getters directly.

5. **Declarative Tools & WebMCP**:
   - Single source of truth for all 50 tools is `bin/tool-manifest.mjs`.
   - Generated into `.agents/tools/*.json` via `npm run build:tools` (`bin/generate-tools.mjs`).
   - Dynamically registered into `document.modelContext` by `scdaw-adapter.js` with WebMCP boolean annotations (`readOnlyHint`, `consequentialHint`) for full client discovery and execution.

6. **Agent Skills**:
   - Defined in `.agents/skills/<name>/SKILL.md`.
   - Agent skills discovery index generated at `.well-known/agent-skills/index.json`.

## Commands

```bash
npm test                  # Run node:test unit suites
npm run check             # Run compatibility and tool manifest checks
npm run build:tools       # Regenerate .agents/tools/*.json
npm run skills:index      # Regenerate .well-known/agent-skills/index.json
npx shadow-claw dev       # Launch local preview server
npx shadow-claw build     # Production build to dist/public
```
