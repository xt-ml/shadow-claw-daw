---
title: "Autonomous Agent Skills"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "skills"
---

## Autonomous Agent Skills

Daw includes autonomous slash skills located in `.agents/skills/`:

### 1. `/scdaw-status`

Quick diagnostics on transport status, audio context state, tempo, and track composition.

### 2. `/beat [style]`

Generates rhythmic drum patterns across kick, snare, clap, and hats for electronic, hip-hop, or house styles.

### 3. `/jam [key] [progression]`

Composes melodic synth lines and bass progressions matching requested musical scales and chords.

### 4. `/mixdown`

Analyzes track decibel levels using `scdaw_get_levels`, balances track volume faders, checks for headroom, and eliminates clipping.

### 5. `/bounce`

Triggers high-speed offline audio rendering into a broadcast-quality WAV file and reports audio duration and peak decibel levels.

### 6. `/scdaw-doctor`

Diagnoses common environment faults, browser autoplay lockouts, or missing leader workbench tabs.
