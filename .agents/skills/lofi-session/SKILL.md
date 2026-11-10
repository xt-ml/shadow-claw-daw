---
name: lofi-session
description: Arrange cozy lofi chillhop and ambient tracks with warm noise pads, detuned tape drift, humanized jazz chords, and crunchy vinyl drums.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_project scdaw_new_project scdaw_set_instrument scdaw_add_track scdaw_set_track scdaw_write_notes scdaw_set_transport scdaw_manage_fx scdaw_apply_groove scdaw_play scdaw_render_surface
  execution:
    type: prompt
---

# Lofi Session Skill (Atmospheric Noise Pads & Chillhop Beats)

Produces relaxing, nostalgic lofi hip-hop and chillhop tracks featuring textured ambient pads, laid-back SP-1200 grooves, and warm bit-crushed aesthetics.

## Sonic Character & Engine Details

- **Noise Pad**: Dual detuned tone oscillators layered with an organic stereo colored hiss generator, slow evolving ADSR envelopes, and wide stereo drift.
- **Bitcrush & Saturation**: Subtle sample rate reduction (`crusher`) and tape warmth (`fold`).
- **Groove & Strum**: Laid-back groove templates (`scdaw_apply_groove` with `template: "laidback"`) or humanized micro-timing.

## Instructions for Agent

1. Inspect project state using `scdaw_get_project`.
2. Set relaxed tempo (75 to 88 BPM, typically 80 BPM, 2 or 4 bars) with `scdaw_set_transport`.
3. Add an ambient pad track with `noise-pad`:
   - Call `scdaw_set_instrument` with `instrument: "noise-pad"`, `attack: 0.8`, `decay: 2.5`, `sustain: 0.7`, `release: 2.2`, `texture: 0.4`, `width: 1.5`.
4. Write 7th / 9th jazz chord progressions (e.g. Dm9 -> G13 -> Cmaj9 -> Am7).
5. Apply laid-back micro-timing groove or humanize via `scdaw_apply_groove` (`template: "laidback"`, `amount: 0.6`).
6. Add low-key lofi drums: soft kick, rimshot or woodblock snare, and swung hats.
7. Add bitcrusher and chorus/tremolo FX via `scdaw_manage_fx` (`fxType: "crusher"`, `fxType: "tidal"`).
8. Render the workbench via `scdaw_render_surface`.
