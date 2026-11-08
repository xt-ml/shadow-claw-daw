---
name: beat
description: Program or update a drum and bass rhythm for techno-bass, pop, house, trap, or synthwave styles.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_project scdaw_new_project scdaw_add_track scdaw_set_track scdaw_write_notes scdaw_clear_notes scdaw_set_transport scdaw_apply_preset scdaw_manage_fx scdaw_reset scdaw_render_surface
  execution:
    type: prompt
---

# Beat & Groove Production Skill

Generates and programs production-ready drum patterns, basslines, and presets into the active project.

## Capabilities & Styles

- **techno-bass**: 132 BPM, 2 bars. 4-on-the-floor kick, off-beat open hat (steps 2, 6, 10, 14), 16th closed hats, claps on 4 & 12, paired with a rolling 16th synth bassline using the `techno-bass` preset (punchy filter envelope, sub-oscillator, and drive).
- **pop**: 118 BPM, 2 bars, 8% swing. Modern radio pop groove with kick on 0, 8, 10, snappy snare on 4 and 12, 8th closed hats, syncopated bass, and `pop-pluck` melodic counter-rhythm.
- **house**: 124 BPM, 2 bars, 15% swing. Four-on-the-floor kick, clap on 4 & 12, open hat on 2, 6, 10, 14, and rolling 16th shaker with deep bass.
- **trap**: 140 BPM, 2 bars. Booming sub bass (`sub-808` preset), half-time snare on beats 2 & 4 (steps 8 & 24), and rapid hi-hat rolls.
- **synthwave**: 110 BPM, 2 bars. Driving 8th-note octaved bassline, gated snare on 4 and 12, and lush pad chords (`warm-pad` preset).

## Instructions for Agent

1. Inspect active tracks via `scdaw_get_project`.
2. If starting a full genre groove from scratch or requested to switch styles (e.g. `/beat techno-bass` or `/beat pop`):
   - You can call `scdaw_new_project` with `template: "techno-bass"` or `template: "pop"`, which loads the complete multi-track production instantly.
   - Alternatively, configure individual tracks:
     - Set tempo via `scdaw_set_transport` with `{ bpm, lengthBars: 2 }`.
     - Ensure a `drums` track exists (`scdaw_add_track` `{ kind: "drums", name: "Drums" }`).
     - Write drum notes using 16th step indices with velocity dynamics (`scdaw_write_notes` with `units: "steps"`).
     - Ensure a bass track exists (`scdaw_add_track` `{ kind: "synth", name: "Bass" }`).
     - Apply appropriate preset via `scdaw_apply_preset` (e.g. `{ trackId, preset: "techno-bass" }`).
     - Write complementary bass notes (`C2` = 36, `D2` = 38, `Eb2` = 39, `F2` = 41).
3. If requested to reset, call `scdaw_reset` with `{ scope: "project", template: "basic-beat" }` or `{ scope: "pattern", trackId }`.
4. Offer to display the live sequencer or workbench via `scdaw_render_surface` (`element: "workbench"` or `"sequencer"`).
