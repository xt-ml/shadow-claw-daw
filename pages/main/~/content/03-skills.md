---
title: "Autonomous Agent Skills"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "skills"
---

## Autonomous Agent Skills

Daw includes autonomous slash skills located in `.agents/skills/`:

### 1. `/song [title] [artist]`

Autonomous multi-bar, multi-track song composition compiling complete arrangements from high-level `SongSpec` structures, chord progressions, signature riff motifs with rests, genre feel templates (e.g. `blues-rock` with eighth-note shuffle hi-hats), and General MIDI SoundFont instruments (`A320U.sf2`).

### 2. `/beat [style]`

Generates rhythmic drum patterns across kick, snare, clap, and hats for electronic, hip-hop, or house styles.

### 3. `/jam [key] [progression]`

Composes melodic synth lines and bass progressions matching requested musical scales and chords.

### 4. `/acid-jam`

Generates Roland TB-303-style acid basslines with filter resonance sweeps, square/saw waveforms, distortion overdrive, and driving 4-on-the-floor drum patterns.

### 5. `/trap-beat`

Arranges authentic modern trap productions with tuned 808 sub bass glides, rolling hi-hat triplets, snappy snares, and atmospheric melody hooks.

### 6. `/lofi-session`

Composes chill lofi hip hop arrangements with dusty rhodes/piano chords, relaxed swung drums, warm basslines, and subtle saturation/vinyl textures.

### 7. `/soundfont-orchestra`

Composes rich acoustic and electric arrangements using real General MIDI SoundFont instruments (guitars, upright/electric basses, strings, brass, organs, keyboards).

### 8. `/mixdown`

Analyzes track decibel levels using `scdaw_get_levels` and `scdaw_analyze_mix`, balances track volume faders, checks for headroom, verifies 3-band energy distribution, and eliminates clipping.

### 9. `/bounce`

Triggers high-speed offline audio rendering into a broadcast-quality WAV file and reports audio duration and peak decibel levels.

### 10. `/scdaw-automate`

Creates continuous parameter automation curves (volume fades, stereo panning, filter cutoff sweeps) with precise beat coordinates and interpolation.

### 11. `/scdaw-audio-clip`

Adds and configures audio clips (vocal takes, audio stems, drum loops) on timeline audio tracks with beat snapping and duration trimming.

### 12. `/scdaw-record`

Arms audio tracks, configures input gain, enables metronome counting, and manages audio recording takes.

### 13. `/scdaw-status`

Quick diagnostics on transport status, audio context state, tempo, and track composition.

### 14. `/scdaw-doctor`

Diagnoses common environment faults, browser autoplay lockouts, or missing leader workbench tabs.
