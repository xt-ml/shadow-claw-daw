---
name: song
description: Compose, arrange, or set up a complete multi-track song from high-level prompt, style description, or reference track.
user-invocable: true
metadata:
  allowed-tools: scdaw_compose_song scdaw_describe_arrangement scdaw_play scdaw_stop scdaw_get_project scdaw_set_track scdaw_apply_preset scdaw_render_surface shadowclaw_local_web_search
  execution:
    type: prompt
---

# Song Creation & Arrangement Skill

Create full multi-bar, multi-track songs from high-level prompts (e.g. "set up Keep on the Sunny Side", "make an uplifting classic rock song in E", "compose a lofi beat").

## Operating Principles

### 1. Acoustic & Electric Realism (SoundFont First)

- **Never default to `"synth"` for rock, pop, blues, funk, or acoustic songs.** In ShadowClaw DAW, `"synth"` produces a raw, buzzy sawtooth electronic synthesizer wave.
- **Always specify SoundFont General MIDI instruments** for realistic instruments:
  - **Bass**: `"electric-bass-finger"`, `"electric-bass-pick"`, `"fretless-bass"`, `"acoustic-bass"`, `"slap-bass"`
  - **Guitars**: `"electric-guitar-clean"`, `"acoustic-guitar-steel"`, `"overdriven-guitar"`, `"distortion-guitar"`
  - **Keys/Organs**: `"rock-organ"`, `"electric-piano-1"`, `"acoustic-grand"`, `"clavinet"`
  - **Drums**: `"rock-kit"`, `"jazz-kit"`
- Reserve `"synth"` strictly for electronic chiptune, 80s synthwave, or acid house.

### 2. Capture the Song's Signature Hook & Riff

The identity of a classic song lives in its signature hook—especially the bassline or guitar riff:

- Use `motifs: { bass: "...", rhythm: "...", lead: "..." }` to specify the exact notes and rhythms.
- Use note:duration tokens with pitch names (e.g. `F2:8`, `C3:4`, `Bb2:8`).
- **Use rests for syncopation**: `r:8` (eighth rest), `r:4` (quarter rest), `_:16` (sixteenth rest).
- When a `bass` or `rhythm` motif is provided, the DAW automatically repeats that exact pattern across sections instead of falling back to a generic walking bassline.

### 3. Harmonic Rhythm: Single vs. Multi-Chord Bars

- Use `|` as the bar delimiter.
- For songs with 2 chords per bar, write both chords inside the bar: `"F Bb | C Bb"`. The DAW automatically gives each chord 2 beats.
- For 1 chord per bar: `"E | E | A | B"`.

### 4. Tempo & Rhythm Feel

- **Straight Rock** (e.g. _When the Saints Go Marching In_): BPM ~122, `feel: "straight-rock"`, `swing: 0.0`.
- **Blues-Rock Shuffle** (e.g. _Keep on the Sunny Side_): BPM ~86, `feel: "blues-rock"`, `swing: 0.3`. The DAW generates swung shuffle eighth-note hats and ghost snares.
- **Funk**: BPM ~105, `feel: "funk"`, `swing: 0.15`.
- **Lofi**: BPM ~84, `feel: "lofi"`, `swing: 0.22`.

---

## Reference Examples

### Example A: Public Domain — "Keep on the Sunny Side" (Upbeat Blues-Rock Shuffle)

```json
{
  "title": "Keep on the Sunny Side",
  "bpm": 86,
  "signature": [4, 4],
  "key": "F",
  "mode": "major",
  "feel": "blues-rock",
  "swing": 0.3,
  "instruments": {
    "drums": "rock-kit",
    "bass": "electric-bass-finger",
    "rhythm": "electric-guitar-clean",
    "lead": "overdriven-guitar"
  },
  "sections": [
    { "name": "intro", "bars": 4, "chords": "F Bb | C Bb", "energy": 0.6 },
    { "name": "verse", "bars": 8, "chords": "F Bb | C Bb", "energy": 0.7 },
    { "name": "chorus", "bars": 8, "chords": "F Bb | C Bb", "energy": 0.85 },
    { "name": "solo", "bars": 8, "chords": "F Bb | C Bb", "energy": 0.95 },
    { "name": "outro", "bars": 4, "chords": "F Bb | C Bb", "energy": 0.5 }
  ],
  "form": [
    "intro",
    "verse",
    "chorus",
    "verse",
    "chorus",
    "solo",
    "chorus",
    "outro"
  ],
  "motifs": {
    "bass": "F2:8 F2:8 r:8 A2:8 C3:8 D3:8 F3:4 r:8 G2:8 G2:8 r:8 Bb2:8 D3:8 C3:8 Bb2:4",
    "rhythm": "r:4 F4:8 r:8 r:4 Bb4:8 r:8 r:4 C5:8 r:8 r:4 Bb4:8 r:8",
    "lead": "F4:8 A4:8 C5:4 r:4 C5:8 D5:8 F5:2"
  },
  "seed": 42
}
```

### Example B: Public Domain — "When the Saints Go Marching In" (Upbeat Straight Rock)

```json
{
  "title": "When the Saints Go Marching In",
  "bpm": 122,
  "signature": [4, 4],
  "key": "E",
  "mode": "mixolydian",
  "feel": "straight-rock",
  "instruments": {
    "drums": "rock-kit",
    "bass": "electric-bass-finger",
    "rhythm": "overdriven-guitar",
    "lead": "distortion-guitar"
  },
  "sections": [
    { "name": "intro", "bars": 4, "chords": "E | E | A | E", "energy": 0.5 },
    {
      "name": "verse",
      "bars": 8,
      "chords": "E | E | A | E | B | A | E | E",
      "energy": 0.65
    },
    {
      "name": "chorus",
      "bars": 8,
      "chords": "A | E | A | E | B | A | E | B",
      "energy": 0.9
    },
    { "name": "outro", "bars": 4, "chords": "E | A | E | E", "energy": 0.4 }
  ],
  "form": ["intro", "verse", "chorus", "verse", "chorus", "outro"],
  "seed": 42
}
```

---

## Execution Workflow

1. **Analyze Request:** Determine the authentic key, tempo (BPM), genre feel, and whether the song is based on a signature riff.
2. **Compile Song:** Call `scdaw_compose_song` with the complete SongSpec including SoundFont instruments and custom riffs/motifs.
3. **Verify Arrangement:** Call `scdaw_describe_arrangement` to inspect the compiled bars and track note counts.
4. **Playback:** Call `scdaw_play` to start playback.
5. **Report to User:** State the title, BPM, key, track list, and confirm that SoundFont instruments and custom riffs were utilized.
