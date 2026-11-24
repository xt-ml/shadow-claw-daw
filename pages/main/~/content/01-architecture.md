---
title: "Architecture & Audio Pipeline"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-23T00:00:00Z"
slug: "architecture"
---

## Architecture & Audio Pipeline

Daw is built upon a 4-tier modular architecture designed for maximum performance, offline resilience, offline/non-destructive audio editing, and seamless control by AI agents.

### Architectural Layers

1. **Pure Logic, Composition, Schemas, DSP & Codecs (`scdaw.js`, `scdaw-audio-dsp.js`, `scdaw-spectral-dsp.js`, `scdaw-time-dsp.js`, `scdaw-audio-dsp-worker.js`, `scdaw-compose.js`, `scdaw-soundfont.js`, `scdaw-schema.js`, `scdaw-presets.js`, `scdaw-dsp.js`, `scdaw-midi.js`, `scdaw-dawproject.js`, `scdaw-zip.js`, `scdaw-compress.js`, `scdaw-url-param.js`, `scdaw-signals.js`)**:
   - Zero DOM or browser dependencies in all pure logic, DSP, spectral, time-stretch, and codec modules.
   - Pure-JS offline `Float32Array` DSP suite (`scdaw-audio-dsp.js`, `scdaw-spectral-dsp.js`, `scdaw-time-dsp.js`) supporting zero-crossing lookup, DC offset removal, invert, reverse, amplify, peak & EBU R128 LUFS / RMS loudness normalization, fade baking, click/pop removal, tone/noise/DTMF/silence generators, radix-2 FFT/IFFT with 6 windows, two-step spectral noise reduction, spectrogram matrices, spectral selection filtering, clipping/silence/beat-onset analysis, Catmull-Rom resampling, phase-locked WSOLA time-stretching & pitch-shifting, and crossfaded silence truncation.
   - Pluggable DSP backend registry (`registerDspBackend`) paired with `scdaw-audio-dsp-worker.js` providing optional Web Worker offloading and Rust/WASM module acceleration with automatic zero-config pure-JS fallback.
   - Non-destructive audio clip editing (`split_audio_clip`, `trim_audio_clip`, `duplicate_audio_clip`, `join_audio_clips`, equal-power `crossfade_audio_clips`, `set_clip_fades` with `linear`/`logarithmic`/`scurve` curves, `set_clip_gain_envelope`, `silence_clip_range`, non-destructive `pitch`/`speed`/`stretchToMatchTempo`/`sourceBpm` parameters) and project-level point/region/spectral `labels` (`add_label`, `update_label`, `remove_label`, `clear_labels`, `split_at_labels`).
   - High-level multi-bar arrangement compiler (`scdaw-compose.js`) with multi-chord bar parsing (`parseProgression`), rest parsing (`parseMotif`), custom signature motifs (`motifs: { bass, rhythm, lead }`), and genre feel templates.
   - SoundFont 2 (SF2) RIFF parser, sample decoding, generator resolution, zone simplification, voice DSP (pitch-rate interpolation, linear ADSR, 3ms filter smoothing, pan), 128-instrument GM program map, and sample caching (`scdaw-soundfont.js`).
   - Exact Pulses Per Quarter Note (`PPQN = 960`) musical timebase math, auto-expanding bar length calculations, and 16th-note swing displacement.
   - 16-bit, 24-bit PCM, and 32-bit Float RIFF WAVE binary encoders, pure-JS ZIP archive codec with CRC-32 integrity, SMF Format 0/1 MIDI codec + live MIDI message parsing/encoding, Web Streams (`CompressionStream`/`DecompressionStream`) + Base64URL `#file=` / `?file=` URL song sharing (`scdaw-compress.js`, `scdaw-url-param.js`), and DAWproject v1.0 XML/ZIP interchange including audio clip fades, gain envelopes, time/pitch properties, and `<Markers>` labels.
   - Microtask-batched reactive Signals for UI and engine state.

2. **Web Audio Synthesis, Scheduling, Web MIDI & Storage (`scdaw-engine.js`, `scdaw-instruments.js`, `scdaw-midi-io.js`, `scdaw-fs.js`)**:
   - Non-blocking Web Worker clock tick (25ms) impervious to background tab throttling, with clock stall recovery (dropping late pre-stall notes and re-anchoring on live BPM changes).
   - Lookahead event scheduler buffering audio nodes 100ms in advance with gapless loop wrap-around, Play/Pause/Seek (`pause()`, `seek(ppqn)`), audio clip fade/envelope gain curve automation (`scheduleClipGainAutomation`), non-destructive `playbackRate`/`detune` scheduling (`computeClipPlaybackParams`), and a resolved note cache with binary-search range lookup (`computeEventsInRange`).
   - Immutable versioned `_sampleCache` buffer keys for `processAudioClip`, keeping `scdaw_undo` lossless across destructive DSP edits, sub-range splices, and duration changes; pure-JS RIFF/WAVE PCM fallback decoding when `decodeAudioData` is unavailable; `splitClipAtSilences`; and `analyzeAudioClip` (`stats`, `spectrum`, `clipping`, `silence_finder`, `beat_finder`, `spectrogram` with optional `createLabels`).
   - Systemic user-facing error surfacing (`formatUserError`, `DawEngine.reportError`, `clearError`, `lastError` state) converting hardware/permission/import failures into actionable UI alerts.
   - Live parameter modulation fast paths (`setLiveTrackParam`, `setLiveMasterParam`, `setLiveTransportParam`) using `setTargetAtTime` and in-place synth AudioParam modulation with a `liveRevision` signal for immediate UI redraw without rebuilding the audio graph or flooding undo history.
   - Web MIDI API integration (`scdaw-midi-io.js`) with hot-plug port enumeration, track MIDI input/output routing, multi-target MIDI Learn CC mapping (`track`, `master`, `transport`), `toggle`/`momentary`/`trigger`/`continuous` modes, 80 ms twin-port deduplication, Soft Takeover, controller presets (`smc-mixer` with bank paging), live MIDI monitor, live note capture, and `SoftwareMidiInput` QWERTY keyboard fallback (`e.code`-first Shift-safe tracking, selectable Ableton `A–'` / `Z`/`X` octave and 2-octave tracker `Z–M` / `Q–U` / `-`/`=` octave layouts, reactive octave/layout `state`, and `shouldHandleSoftwareKeyboardEvent` modifier/editable/dialog filtering).
   - Polyphonic `Vaporisateur` dual-oscillator synthesizers, procedural 12-drum `Playfield` synthesizers, SoundFont 2 GM instrument engine (`A320U.sf2`, `gm-lofi.sf2`), and extended MIDI/Audio FX chains (equalizer, delay, reverb, bitcrusher, wavefolder, stereo tool, autotune, vocoder, maximizer limiter, transient shaper, guitar overdrive).
   - Dynamic audio node graph with track gain, stereo panning, real-time peak/RMS and mix analysis DSP (`analyzeAudioBuffer`), master bus safety limiter, offline WAV/stem rendering, and direct OPFS conversation file persistence.

3. **IPC Bridge & WebMCP Adapter (`scdaw-adapter.js`)**:
   - Web Locks leader election ensuring exactly one document holds the AudioContext and replies to agent tool dispatches.
   - Dual BroadcastChannel protocol (`scdaw-commands`, `scdaw-results`) providing sub-millisecond local RPC between the ShadowClaw agent worker and workbench.
   - `scdaw-state` event broadcasting keeping detached UI surfaces synchronized at 10 Hz.
   - Native ModelContext API registration for all 50 `scdaw_*` tools.

4. **Mobile-First Web Component Workbench (`scdaw-element.js`, `components/scdaw-*.js`)**:
   - 15 encapsulated Custom Elements (`<scdaw-workbench>`, `<scdaw-transport>`, `<scdaw-browser>`, `<scdaw-timeline>`, `<scdaw-editor>`, `<scdaw-wave-editor>`, `<scdaw-spectrum>`, `<scdaw-sequencer>`, `<scdaw-synth>`, `<scdaw-devices>`, `<scdaw-mixer>`, `<scdaw-knob>`, `<scdaw-resize-handle>`, `<scdaw-statusbar>`, `<scdaw-midi-keyboard>`).
   - Mobile-first responsive CSS Container Queries (`@container`), `@supports not (container-type: inline-size)` fallbacks, `@media (pointer: coarse)` 44×44px touch targets, strict BEM naming, WCAG 2.1 AA ARIA landmarks, and Shadow DOM styling using inherited `--shadow-claw-*` design tokens.
