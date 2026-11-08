---
name: jam
description: Compose a musical synthesizer bassline or chord melody in a chosen musical key.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_project scdaw_add_track scdaw_write_notes scdaw_set_track scdaw_apply_preset scdaw_reset scdaw_render_surface
  execution:
    type: prompt
---

# Melodic Jam Skill

Composes melodic synth lines, bass riffs, and arpeggios synchronized with the active pattern.

## Instructions for Agent

1. Check active tracks via `scdaw_get_project`.
2. Find or add a synthesizer track using `scdaw_add_track` (`kind: "synth"`).
3. Apply a tailored synthesizer preset via `scdaw_apply_preset`:
   - Bass riffs: `"techno-bass"`, `"acid-303"`, `"sub-808"`
   - Melodic hooks & plucks: `"pop-pluck"`, `"supersaw-lead"`
   - Atmospheric chords: `"warm-pad"`
4. Choose musical key (default: C minor or A minor) and compose 16th-note melodies or bass grooves.
5. Program notes via `scdaw_write_notes` using note names (e.g. `"C3"`, `"Eb3"`, `"G3"`).
6. Optionally fine-tune synthesizer parameters (`cutoff`, `resonance`, `filterEnvAmount`, `drive`) via `scdaw_set_track`.
7. Render the updated workbench using `scdaw_render_surface`.
