---
name: trap-beat
description: Produce hard-hitting modern trap beats featuring gliding 808 sub bass, Karplus-Strong plucked melodies, half-time snares, and fast hi-hat rolls.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_project scdaw_new_project scdaw_set_instrument scdaw_set_808 scdaw_add_track scdaw_set_track scdaw_write_notes scdaw_set_transport scdaw_manage_fx scdaw_apply_groove scdaw_play scdaw_render_surface
  execution:
    type: prompt
---

# Trap Beat Production Skill (808 Sub Bass & Plucked Melodies)

Arranges trap music productions with continuous-phase gliding 808 sub bass, crisp acoustic Karplus-Strong string plucks, and syncopated percussion.

## Sonic Character & Engine Details

- **808 Sub Bass**: Pure monophonic sine sub oscillator with `tanh` softclip drive to prevent digital clipping while boosting perceived low-end harmonics on small monitors.
- **Pluck (Karplus-Strong)**: Dual-polarization physical string modeling excited by noise bursts with adjustable damping and stereo width.
- **Groove**: MPC 60 / SP-1200 micro-timing groove or humanize micro-timing via `scdaw_apply_groove`.

## Instructions for Agent

1. Inspect active tracks with `scdaw_get_project`.
2. Set tempo between 135 and 155 BPM (e.g. 140 BPM, 2 bars) using `scdaw_set_transport`.
3. Add or configure the `808` sub bass track:
   - Call `scdaw_set_808` with `glide: 180`, `decay: 2.2`, `drive: 0.4`, `harmonics: "grit"`.
4. Write gliding 808 sub basslines with overlapping notes to trigger portamento slides.
5. Add a melody track with the `pluck` instrument (`scdaw_set_instrument` with `instrument: "pluck"`, `tone: 0.8`, `width: 1.4`).
6. Write minor-key or pentatonic trap bell/pluck melody lines.
7. Program trap drums: heavy kick, snappy snare/clap on steps 8 & 24 (half-time beats 2 & 4), and rolling 16th/32nd hi-hats.
8. Apply sidechain ducking or limiter using `scdaw_manage_fx` (`fxType: "sidechain"`, `fxType: "maximizer"`).
9. Render the interactive workbench with `scdaw_render_surface`.
