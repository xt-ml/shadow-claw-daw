---
name: acid-jam
description: Create and perform acid house and techno jams with the Cubed TB-303 synthesizer, diode ladder filter sweeps, accent recharge dynamics, and slide portamento.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_project scdaw_new_project scdaw_set_instrument scdaw_add_track scdaw_set_track scdaw_write_notes scdaw_set_transport scdaw_manage_fx scdaw_apply_preset scdaw_play scdaw_render_surface
  execution:
    type: prompt
---

# Acid Jam Skill (TB-303 Acid Basslines & Diode Ladder Filter Sweeps)

Generates authentic 16-step Roland TB-303 acid bass patterns using the **Cubed** physical modeling engine, driving accent circuits, resonant filter envelopes, slides, and distorted drum grooves.

## Sonic Character & Engine Details

- **Synthesis**: Single oscillator (switchable sawtooth or square) through an authentic 4-pole diode ladder resonant low-pass filter.
- **Accents**: Simulates analog capacitor recharge time—accents hitting after rests punch significantly harder than rapid consecutive accents.
- **Slides**: Portamento glide between notes without re-triggering the envelope generator.
- **Distortion & FX**: Warm distortion/overdrive via `manage_fx` (wavefolder or sat) followed by stereo tape delay.

## Instructions for Agent

1. Inspect project with `scdaw_get_project`.
2. Set up an acid project tempo (typically 128 to 138 BPM) using `scdaw_set_transport`.
3. Ensure a 303 bass track exists (`scdaw_add_track` or configure existing track).
4. Set instrument to `cubed`:
   - `scdaw_set_instrument` with `instrument: "cubed"`, `cutoff: 450`, `resonance: 14.0`, `accent: 0.7`, `decay: 0.35`, `waveform: "sawtooth"`.
5. Write an authentic 16-step bassline with octave jumps, accents (higher velocity > 0.8), and overlapping slide notes (`scdaw_write_notes`).
6. Add punchy 909-style 4-on-the-floor kick, clap, and rolling 16th hats on the `drums` track.
7. Add subtle distortion and delay to the 303 track via `scdaw_manage_fx` (`fxType: "delay"`, `fxType: "fold"`).
8. Render the workbench or devices via `scdaw_render_surface` (`element: "workbench"` or `"devices"`).
