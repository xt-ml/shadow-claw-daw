---
title: "Porting & Upstream Attribution"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-23T00:00:00Z"
slug: "porting-and-attribution"
---

## Porting & Upstream Attribution

This project derives architecture, DSP formulas, and concepts from **openDAW**, **OpenStudio**, and **Audacity**, ported into a zero-dependency Vanilla JS, Web Component, and Signal-based architecture for **ShadowClaw**.

### Upstream Provenance

- **Repository**: [andremichelle/openDAW](https://github.com/andremichelle/openDAW)
- **Commit SHA**: `10088021dc881adf2aa981686e0e8be9cf3a1cd4` (Thu Nov 5 18:01:29 2026 +0100)
- **License**: GNU Affero General Public License v3.0 or later (AGPLv3)
- **Copyright**: © André Michelle and openDAW contributors

### Audio Editing, Spectral & Restoration Reference (Audacity)

- **Repository**: [audacity/audacity](https://github.com/audacity/audacity)
- **Reference Branches & Commit SHAs**:
  - Audacity 4 (`master`): `f56f25d4c26ae5a0a1466c3f16876e547be0d179` (`2026-11-23`)
  - Audacity 3 (`audacity3`): `e168e5f70b8432efdd53c069b534c829065abcb0` (`2026-09-24`)
- **License**: GNU General Public License v3.0 (GPLv3) / GPLv2-or-later
- **Copyright**: © Audacity contributors and Muse Group

### Secondary UI Reference

- **Repository**: OpenStudio (hybrid DAW reference)
- **License**: GNU Affero General Public License v3.0 (AGPLv3)
- **Reference Scope**: Mixer and transport visual layout concepts only.

### Component Porting Mapping (openDAW & ShadowClaw)

| Upstream Source File (openDAW)                                               | Local File                                          | Ported Concepts / Code                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/lib/dsp/src/ppqn.ts`                                               | `.agents/scripts/scdaw.js`                          | Musical timebase math: `Quarter = 960`, `fromSignature`, `secondsToPulses`, `pulsesToSeconds`.          |
| `packages/lib/dsp/src/adsr.ts`                                               | `.agents/scripts/scdaw-instruments.js`              | Envelope curve shaping and ADSR timing stages.                                                          |
| `packages/lib/dsp/src/wav-file.ts`                                           | `.agents/scripts/scdaw.js`                          | RIFF WAVE 16-bit PCM binary encoder header format.                                                      |
| `packages/lib/dsp/src/midi-keys.ts`, `notes.ts`                              | `.agents/scripts/scdaw.js`                          | MIDI note number to note name parsing and formatting.                                                   |
| `packages/lib/dsp/src/rms.ts`, `core-processors/src/MeterProcessor.ts`       | `.agents/scripts/scdaw.js`                          | Peak and RMS level calculation, decibel conversions (`linToDb`).                                        |
| `packages/lib/dsp/src/grooves.ts`                                            | `.agents/scripts/scdaw.js`                          | 16th-note swing pulse displacement math.                                                                |
| `packages/lib/dsp/src/waveshaper.ts`, `Fold.ts`                              | `.agents/scripts/scdaw-dsp.js`                      | Symmetric wavefolder transfer curve (`createWavefolderCurve`).                                          |
| `packages/lib/dsp/src/crusher.ts`                                            | `.agents/scripts/scdaw-dsp.js`                      | Bitcrusher bit reduction and sample-rate reduction (`processCrusherBuffer`).                            |
| `packages/lib/dsp/src/stereo.ts`                                             | `.agents/scripts/scdaw-dsp.js`                      | Stereo width, mid/side processing, and panning (`processStereoTool`).                                   |
| `packages/lib/dsp/src/dattorro-reverb.ts`                                    | `.agents/scripts/scdaw-dsp.js`                      | Algorithmic stereo plate reverb impulse generator (`generateReverbImpulse`).                            |
| `packages/studio/core/src/synth/Vaporisateur.ts`                             | `.agents/scripts/scdaw-instruments.js`              | Dual-oscillator synth with sub-oscillator, filter ADSR sweep, and saturation drive.                     |
| `packages/studio/forge-boxes/src/schema/devices/`                            | `.agents/scripts/scdaw-schema.js`                   | Canonical parameter definitions for synth, drums, master, and audio FX devices.                         |
| `packages/studio/core/src/project/ProjectApi.ts`                             | `.agents/scripts/scdaw.js`                          | Single transactional reducer command dispatcher (`applyCommand`).                                       |
| `packages/studio/core/src/browser/`                                          | `.agents/scripts/components/scdaw-browser.js`       | Library browser with search and categorization.                                                         |
| `packages/studio/core/src/timeline/`                                         | `.agents/scripts/components/scdaw-timeline.js`      | Multi-track timeline lanes, measure grid, playhead.                                                     |
| `packages/studio/core/src/editor/`                                           | `.agents/scripts/components/scdaw-editor.js`        | Chromatic piano roll editor and note inspector.                                                         |
| `packages/studio/core/src/mixer/`                                            | `.agents/scripts/components/scdaw-mixer.js`         | Multi-channel vertical fader strips, knobs, and LED peak meters.                                        |
| `packages/studio/core/src/knob/`                                             | `.agents/scripts/components/scdaw-knob.js`          | Rotary parameter knob with linear/exponential mapping and double-click reset.                           |
| ShadowClaw `sidebar-resize-handle` / openDAW splitter                        | `.agents/scripts/components/scdaw-resize-handle.js` | Accessible split-pane separator with pointer capture, ARIA attributes, and keyboard control.            |
| `packages/lib/fusion/src/live-stream/`                                       | `.agents/scripts/scdaw-adapter.js`                  | Broadcast telemetry stream concept without SharedArrayBuffer.                                           |
| `packages/lib/midi/src/{MidiFile,MidiTrack,MidiFileDecoder,ControlEvent}.ts` | `.agents/scripts/scdaw-midi.js`                     | SMF Format 0 & 1 multi-track codec, VLQ delta times, Conductor track, GM Ch 10 drums.                   |
| `packages/studio/core/src/AudioBounce.ts`                                    | `.agents/scripts/scdaw-engine.js`, `scdaw.js`       | `audibleLength` silence trimming, multi-tap stems bounce (`post-fader`, `pre-fader`, `pre-fx`).         |
| `packages/lib/dawproject/src/`, `studio/core/dawproject/`                    | `.agents/scripts/scdaw-dawproject.js`               | DAWproject v1.0 XML schema mapping, pure-JS XML tokenizer/parser, Bitwig/openDAW interchange.           |
| Pure-JS ZIP Container Architecture                                           | `.agents/scripts/scdaw-zip.js`                      | Zero-dependency ZIP reader/writer (STORE and DEFLATE via `DecompressionStream`) & CRC-32.               |
| `claw_daw/arrange/`, openDAW `dsp/{chords,notes,grooves}.ts`                 | `.agents/scripts/scdaw-compose.js`                  | High-level SongSpec arrangement compiler, chord progression parser, and section generators.             |
| `packages/studio/core-wasm/src/soundfont-simplify.ts`                        | `.agents/scripts/scdaw-soundfont.js`                | SF2 zone intersection flattening and timecent-to-second generator resolution.                           |
| `crates/stock-devices/device-soundfont/src/voice.rs`                         | `.agents/scripts/scdaw-soundfont.js`                | Soundfont voice DSP: pitch-rate interpolation, linear ADSR, 3ms one-pole smoothing, pan math.           |
| `packages/lib/dsp/src/overdrive.ts`, claw-daw guitar saturation              | `.agents/scripts/scdaw-dsp.js`                      | Asymmetric analog overdrive transfer curve for guitar cabinet warmth (`createGuitarOverdriveCurve`).    |
| `packages/studio/core/src/analysis/`                                         | `.agents/scripts/scdaw-dsp.js`, `scdaw.js`          | Mix telemetry: peak/RMS dBFS, crest factor, clipping, and 3-band energy balance (`analyzeAudioBuffer`). |
| `packages/lib/midi/src/MidiFileDecoder.ts`                                   | `.agents/scripts/scdaw-midi.js`                     | Robust SMF import: kind allocation, canonical 0-1 velocity scaling, and lengthBars calculation.         |
| `packages/studio/core/src/project/ProjectSchema.ts`                          | `.agents/scripts/scdaw-schema.js`                   | Schema v2 migration with multi-tempo `tempoMap`, `signatureMap`, `sections`, and velocity repair.       |

### Audio Editing & DSP Porting Mapping (Audacity)

| Upstream Source File (Audacity 3 / 4)                                                                       | Local File                                                              | Ported Concepts / Code                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/trackedit/dom/clip.h`, `iclipsinteraction.h`, `itrackeditinteraction.h`                                | `.agents/scripts/scdaw.js`                                              | Non-destructive clip editing (`split`, `trim`, `duplicate`, `join`, equal-power `crossfade`, fade curves, `silence_range`, mute, pitch/speed). |
| `src/automation/automationtypes.h`, `iclipgaininteraction.h`                                                | `.agents/scripts/scdaw.js`, `scdaw-wave-editor.js`, `scdaw-timeline.js` | Per-clip gain envelopes, fade handles, and envelope point drag eat/restore semantics.                                                          |
| `src/trackedit/internal/au3/au3tracksinteraction.cpp` (`nearestZeroCrossing`)                               | `.agents/scripts/scdaw-audio-dsp.js`, `scdaw-wave-editor.js`            | Sub-sample-accurate rising zero-crossing lookup and waveform selection snapping.                                                               |
| `src/effects/builtin_collection/loudness/normalizeloudnesseffect.cpp`, `EBUR128.cpp`, `normalizeeffect.cpp` | `.agents/scripts/scdaw-audio-dsp.js`                                    | DC offset removal, peak normalize, K-weighted ITU-R BS.1770 / EBU R128 LUFS & RMS loudness normalization, and offline fade baking.             |
| `src/effects/builtin_collection/clickremoval/clickremovaleffect.cpp`                                        | `.agents/scripts/scdaw-audio-dsp.js`                                    | `removeClicksAudio` multi-width impulse detection and linear sample repair.                                                                    |
| `src/effects/builtin_collection/{tonegen,noisegen,dtmfgen,silencegen}/*`                                    | `.agents/scripts/scdaw-audio-dsp.js`                                    | Pure-JS waveform/chirp tone, white/pink/brownian noise, DTMF dual-tone, and silence generators.                                                |
| `au3/libraries/au3-fft/FFT.cpp`, `SpectrumAnalyst.cpp`                                                      | `.agents/scripts/scdaw-spectral-dsp.js`, `scdaw-spectrum.js`            | Radix-2 FFT/IFFT, 6 window functions (`hann`..`blackmanHarris`), calibrated power spectrum (`Plot Spectrum`), and note readout.                |
| `src/effects/builtin_collection/noisereduction/noisereductioneffect.cpp`                                    | `.agents/scripts/scdaw-spectral-dsp.js`                                 | Two-pass profile-based STFT noise reduction with sensitivity, reduction dB, frequency smoothing, and attack/release.                           |
| `src/spectrogram/spectrogramtypes.h`                                                                        | `.agents/scripts/scdaw-spectral-dsp.js`, `scdaw-wave-editor.js`         | Spectrogram matrices (`linear`/`logarithmic`/`mel`), palettes (`roseus`/`classic`/`grayscale`/`inverseGrayscale`), and spectral band editing.  |
| `au3-builtin-effects/FindClippingBase.cpp`, `TruncSilenceBase.cpp`, `au3-music-information-retrieval/`      | `.agents/scripts/scdaw-spectral-dsp.js`, `scdaw-time-dsp.js`            | Clipping finder, silence finder, Truncate/Compress Silence with crossfades, energy-flux beat/onset detection, WSOLA tempo & pitch shift.       |
| `src/trackedit/dom/label.h`                                                                                 | `.agents/scripts/scdaw.js`, `scdaw-timeline.js`, `scdaw-dawproject.js`  | Point, region, and spectral (`lowFrequency`/`highFrequency`) project label tracks, `split_at_labels`, and DAWproject `<Markers>` round-trip.   |

### Reactive Primitives Attribution

- **signal-polyfill**: Vendored under `.agents/scripts/vendor/signal-polyfill.js` from `signal-polyfill@0.2.2` (MIT License, Copyright Google LLC).
