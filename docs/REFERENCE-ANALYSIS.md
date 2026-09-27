# Reference analysis

Source: `ScreenRecording_09-23-2026 10-48-29_1.MP4` — an 18-second phone recording of a
monitor showing a desktop guitar-AR prototype.

## What the reference actually does

| Observed | Evidence in the recording |
| --- | --- |
| Live camera feed is the primary UI surface | The whole window is the webcam image; panels are drawn *on* it |
| Neck tracked in 3D | A wireframe quad follows the fretboard as the player moves; label text is rotated to the neck's angle ("SCALE: B major") |
| Controls anchored to the instrument | A metronome panel with `TEMPO 189 BPM`, `START`/`STOP` is projected onto the guitar body in perspective; `START` turns green when engaged and the tempo changes to 135 mid-clip |
| Hand tracking | Thin green skeleton lines over the picking hand — MediaPipe-style landmarks |
| Live chord recognition | A right-hand column streams `Amaj`, `A6sus4(no5)`, `Bmaj`, `F#maj`, `C5`, `B7addb13(no3)` with pulsing dots beside entries |
| Persistent scale map | A full 24-fret diagram pinned to the bottom, split at the 12th, green triangles for scale tones, a yellow box marking the active position |
| Developer HUD | `REF YES`, `alpha 0.85`, `frets 24`, `DOTS off`, and a shortcut bar `M hands / F fret-readout / +- alpha / [/] frets / Q quit` |

## Reading of it

It is an impressive **research prototype**, and it reads as one: keyboard-driven, debug
text over the video, chord names that change faster than anyone can use them
(`A6sus4(no5)` is an artefact of frame-by-frame chord matching, not something a player
acts on), and a layout where the most important information — what to play next — is the
least prominent thing on screen.

## What is worth keeping

1. **The camera as a surface, not a decoration.** Overlaying the real neck is the
   genuinely novel idea.
2. **Controls anchored to the instrument.** Not having to put the guitar down to change
   the tempo is a real ergonomic win.
3. **The persistent scale map.** Always-visible neck context is right.
4. **Position boxes highlighted inside the wider map** — local detail without losing the
   global picture.

## What this product should do differently

| Reference | Here |
| --- | --- |
| Chord label changes every frame | Detection is **stabilised** before it is shown; a reading must hold for N frames to be reported |
| Debug HUD over the video | Silkscreen-style labels in a deliberate layout; diagnostics behind a toggle |
| Camera required | Camera is **Level 2**. Audio alone is a complete product; the app degrades to it cleanly |
| No stated feedback loop | "What next / was that right / how accurate" is the centre of the practice screen |
| Keyboard-only, desktop-only | Responsive, touch-first, shortcuts as an accelerator |
| Guitar only | Bass is a first-class citizen, down to a 30.87 Hz low B |

The camera work is Phase 5 precisely *because* it is the hard part. Building the audio,
theory and practice layers first means the CV layer has something worth attaching to,
rather than being the only thing holding the product up.
