---
name: soundfont-orchestra
description: Build orchestral and acoustic multi-instrument arrangements using the SoundFont General MIDI engine and SoundFont banks.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_project scdaw_new_project scdaw_set_instrument scdaw_add_track scdaw_set_track scdaw_write_notes scdaw_set_transport scdaw_manage_fx scdaw_play scdaw_render_surface
  execution:
    type: prompt
---

# SoundFont Orchestra Skill (General MIDI Acoustic Synthesis)

Composes rich acoustic and orchestral arrangements using the built-in SoundFont General MIDI synthesizer engine, supporting GM instruments across 16 channels.

## Sonic Character & Engine Details

- **SoundFont Engine**: Web Audio SoundFont player parsing SF2/SF3 sound banks.
- **Instruments**: Acoustic pianos, strings, brass, woodwinds, orchestral percussion, and full GM drum kits.
- **Spatialization & Ambience**: Wide stereo tool and lush plate reverb for orchestral hall depth.

## Instructions for Agent

1. Inspect active project with `scdaw_get_project`.
2. Configure tempo and time signature using `scdaw_set_transport`.
3. Create separate tracks for orchestral voices:
   - Strings / Violins: `scdaw_add_track` -> `scdaw_set_instrument` with `instrument: "soundfont"`, `programNumber: 48` (String Ensemble 1).
   - Piano / Harp: `scdaw_add_track` -> `scdaw_set_instrument` with `instrument: "soundfont"`, `programNumber: 0` (Acoustic Grand Piano).
   - Brass / Woodwinds: `scdaw_add_track` -> `scdaw_set_instrument` with `instrument: "soundfont"`, `programNumber: 60` (French Horn) or `programNumber: 73` (Flute).
4. Write polyphonic chords and counterpoint melodies using `scdaw_write_notes`.
5. Add hall reverb and stereo width via `scdaw_manage_fx` (`fxType: "reverb"`, `fxType: "stereoTool"`).
6. Render the workbench with `scdaw_render_surface`.
