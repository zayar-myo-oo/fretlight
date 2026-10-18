# Architecture

Fretlight has one learning surface and two supporting screens:

- `/fretboard`: notes and chords, relationships, and live input. A compact metronome stays on the same screen.
- `/tuner`: chromatic tuning and reference strings.
- `/settings`: instrument, tuning, language, display and sound.

`/` opens the fretboard. Retired screen URLs redirect there so saved links remain usable.

`packages/core` contains platform-independent music theory, instrument mapping,
pitch and chord DSP, timing and events. `apps/web` owns browser audio, React state
and the SVG fretboard. There is no camera, 3D renderer, song analyzer, generator,
looper or separate practice dashboard.

Live single notes use getUserMedia → AudioWorklet → Worker → detection hub.
Chord input uses a separate chord listener; the Listen screen switches between
the two consumers. Audio is processed on the device without uploads.

Note playback uses recorded samples with a local modelled-string fallback.
Pending playback is cancelled on Stop. The metronome schedules clicks on the
audio clock and releases its context when the fretboard is unmounted.

Preferences stay in browser storage. Retired features' existing local data is
left untouched; it is not read by the current app.

The existing Vercel Git integration publishes pushes to `main`.
`/api/version` reports the deployed commit for verification.
