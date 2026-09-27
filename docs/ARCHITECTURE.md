# Architecture

## 1. The governing constraint

Everything in the real-time loop runs locally:

```
pluck → microphone → AudioWorklet → conditioning → YIN → frequency
      → MIDI → note + cents → theory context → practice engine → UI
```

There is no network hop anywhere in that chain, and there is no model call. A round trip
to anything — a server, an inference endpoint — costs tens to hundreds of milliseconds,
and a note that lights up 200 ms after you played it is not feedback, it is a replay.

AI is a **separate, optional layer** that never sits in this path. It may explain why a
scale works, propose a practice plan, or summarise a session after the fact. It is never
required to detect a note, tune a string, compute a scale, or grade a run.

## 2. Package layout

```
guitar-app/
├── packages/
│   └── core/                 @fretlight/core — pure TypeScript, no DOM
│       └── src/
│           ├── theory/       pitch, intervals, scales, chords, arpeggios
│           ├── instrument/   tunings, instrument profiles, fretboard engine
│           ├── audio/        YIN, signal conditioning, note stabiliser
│           ├── timing/       metronome grid, tap tempo, timing evaluation
│           ├── practice/     sequence builders, practice engine, scoring
│           └── events/       typed event bus
└── apps/
    └── web/                  Next.js 15 · React 19 · Tailwind 4 · Zustand
        └── src/
            ├── app/          routes: /, /tuner, /fretboard, /metronome, /practice
            ├── components/   fretboard, tuner, practice, ui primitives, layout
            ├── lib/audio/    PitchSource interface, mock source, detection hub,
            │                 metronome engine (the only Web Audio code)
            ├── hooks/        useDetection, useMetronome, useFretboard, useKeyboard
            └── store/        session preferences, practice history
```

### Why the split

`@fretlight/core` has a hard rule: **no DOM, no Web Audio, no React, no fetch.** It is
plain functions and small stateful classes over plain data.

That rule is what buys three things:

- **Testability.** 87 unit tests run under Node in ~600 ms, including DSP correctness on
  synthetic bass plucks. No browser, no mocking of `AudioContext`.
- **Portability.** A React Native app imports the same package. The music theory, the
  fretboard geometry and the scoring rules do not get rewritten or forked.
- **Placement freedom.** The same detector can run on the main thread, in a Worker, or
  inside an AudioWorklet, because it makes no assumption about where it is.

Browser-specific code lives in `apps/web/src/lib/audio` and depends on core — never the
reverse.

## 3. Real-time audio pipeline

| Stage | Where it lives | Notes |
| --- | --- | --- |
| Capture | `lib/audio/microphone-pitch-source.ts` | `echoCancellation`, `noiseSuppression` and AGC all **off** — they are tuned for speech and destroy a bass fundamental |
| Framing | `public/worklets/frame-collector.js` | Audio thread. Ring buffer only; frame size derived from the instrument's lowest note, hop = frame/8 |
| Transport | `postMessage` with transfer | Frames are moved, not copied |
| Conditioning | `core/audio/conditioning.ts` | DC blocker → high-pass below the lowest fundamental → low-pass below the decimated Nyquist. Allocation-free |
| Decimation | `core/audio/decimate.ts` | Two-stage anti-alias low-pass, then downsample. ~80x less work per frame |
| Detection | `core/audio/yin.ts` | YIN + parabolic interpolation + octave recovery, in a Web Worker |
| Quality | `core/audio/fft.ts`, `quality.ts` | Spectral flatness, harmonic ratio, ZCR, onset |
| Gating | `core/audio/quality.ts` | Is this the instrument, or the room? Rejects speech and noise |
| Stabilisation | `core/audio/stabilizer.ts` | Median filter, N-frame agreement, release counter |
| Display state | `core/audio/pitch-state.ts` | What the tuner shows: commit, hold, switch, hysteresis |
| Position | `core/instrument/position-estimator.ts` | *Which* string and fret it was played on |
| Distribution | `lib/audio/detection-hub.ts` | Observable + typed event bus |
| Consumption | React via `useSyncExternalStore` | Notifications coalesced onto an animation frame |

### Telling an instrument from a person talking

Speech and a guitar overlap heavily in frequency, so a band filter cannot separate them,
and neither can periodicity alone — a spoken vowel is periodic, and a naive
"clarity > 0.8" gate happily reports notes while someone talks.

What separates them is how the pitch *behaves over time*. Speech is never still: prosody
slides the fundamental tens of cents within a syllable. A fretted string is mechanically
fixed and holds pitch to within a few cents until it is released. `InstrumentGate` weights
pitch stability most heavily, backed by spectral flatness (vowels are noisier than
strings), harmonic structure and zero-crossing rate, with separate accept and release
thresholds so a marginal signal settles instead of oscillating.

Measured on the full chain (`detection-chain.test.ts`), against a synthetic voice with
continuous glide, formant movement and breath noise:

| Signal | Frames accepted | Notes put on screen |
| --- | --- | --- |
| Guitar A2 | >85% | A2 |
| Bass E1 / B0 | >85% | E1 / B0 |
| Speech, 150 Hz | <5% | none |
| Speech, bass register | — | none |
| Broadband noise | — | none |
| Guitar **over** background speech | >50% | the guitar note |

### Why display state is separate from detection state

The detector runs tens of times a second and its output is legitimately twitchy — a pick
attack is inharmonic, a hand mute drops the level, a finger shift passes through a
neighbouring pitch. Rendering that stream directly gives the
note-appears-disappears-appears flashing that makes a tuner feel broken, even though every
individual frame was a correct reading.

`PitchStateMachine` owns the display instead: commit slowly (a candidate must hold before
it is shown), release slowly (a note is *held* for ~700 ms after the signal stops), switch
reluctantly (replacing a note takes more evidence than showing the first one), and use
asymmetric thresholds throughout.

### Which string and fret, not every matching note

A single pitch appears in many places — A2 on a bass is playable on the E string at fret
5, the A string open, or the D string at fret 7. Lighting all of them is not information,
it is wallpaper.

`PositionEstimator` generates the candidates from the tuning, then ranks them on the
evidence available: where the hand was on the previous note, where the camera says it is
now, which string an exercise expects, and how playable each position is. Two properties
matter as much as the ranking — **continuity**, because a hand does not teleport, and
**hysteresis**, because two near-equal candidates would otherwise make the highlight
oscillate on a sustained note.

### Why YIN, and what it took to make bass work

Plain autocorrelation is biased toward short lags, so on a plucked low B — where the
fundamental at 30.87 Hz is *quieter* than the 2nd harmonic — it reports the octave above.
YIN's cumulative mean normalised difference removes that bias.

The remaining failure mode needed an explicit fix. `YinDetector.recoverOctave` checks
whether 2×, 3× or 4× the chosen lag sits in a decisively deeper dip — but **only when the
chosen lag is already a mediocre match** (`cmnd[tau] >= 0.10`). The first version of this
guard omitted that condition and happily doubled correct periods into sub-harmonics: a
clean D3 came back an octave low. The tests in `yin.test.ts` cover both directions.

`test-signals.ts` generates plucks with the fundamental at 0.35 relative amplitude against
a 2nd harmonic at 1.0, random per-harmonic phases and a decay envelope — the hard case,
not a convenient sine.

### Why decimation, and where the work actually goes

YIN costs O(tauMax x windowSize), and tauMax is sampleRate/minFrequency. At 48 kHz a
30.87 Hz low B needs tauMax ≈ 1850, which against an 8192-sample frame is ~11.7 million
operations per frame — roughly 234 million per second at 20 frames. That is a warm phone
and a dead battery for no benefit, because nothing above a few kHz says anything about a
30 Hz period.

`PitchPipeline` conditions, decimates to ~5 kHz, then runs YIN: about 150k operations per
frame. Accuracy is unchanged — parabolic interpolation recovers sub-sample precision on
the period either way, and the pipeline tests assert the decimated result agrees with the
undecimated one to within 5 cents.

The anti-alias filter before the downsample is not optional. Without it everything above
the new Nyquist folds back into the band being analysed and reads as spurious periodicity.

### Why three threads

- **Audio thread** (AudioWorklet): framing only. Overrunning the budget here causes
  audible glitches, so it does the minimum that must happen at capture time.
- **Worker**: the whole `PitchPipeline`. Keeps analysis off the main thread so the
  fretboard never stutters, and off the audio thread so audio never glitches.
- **Main thread**: stabilisation and rendering.

The DSP exists in exactly one place — `@fretlight/core` — so the code the worker runs is
the code the tests exercise. An inlined copy inside the worklet would have been simpler to
wire up and would have drifted from the tested implementation within a week.

### Why the stabiliser is not optional

Raw per-frame output jitters. Without stabilisation a tuner needle shakes and the practice
engine scores phantom notes on every pick attack. Three mechanisms, all in
`NoteStabilizer`: a median filter over recent frequencies (absorbs single glitched
frames outright), an N-frame agreement requirement before a note is *confirmed*, and a
release counter so a momentary dropout during a sustain does not end the note.

It is frame-driven, not time-driven — the caller owns the clock, which keeps it testable
without fake timers.

## 4. State architecture

Three tiers, separated on purpose:

1. **Pitch frames (~60 Hz)** — `detectionHub`, outside React entirely. Components attach
   with `useSyncExternalStore`, so a tuner readout updating does not re-render the
   fretboard.
2. **Selection (rare)** — Zustand + `localStorage`. Instrument, tuning, root, scale,
   tempo. Survives reload; works offline.
3. **Derived (memoised)** — scale projections, shapes, sequences. Pure functions of tier 2,
   recomputed only when their inputs change.

Putting live detection into a React context would re-render the tree 60 times a second.
That is the mistake this layout exists to prevent.

## 5. Rendering

Detection and rendering are strictly separated. The detection hub emits events; renderers
subscribe. A renderer never performs audio processing, and the audio path never touches
the DOM.

The fretboard is a single SVG rather than positioned DOM nodes: one element tree,
resolution-independent, no JavaScript layout pass on resize. Every visual state comes from
a `tone` field on the marker, so the tuner, the scale finder and the practice screen all
render the same component with different data.

Coordinates are rounded to two decimals before reaching the DOM — an unrounded double
serialises to a 17-digit string, and the server and client can disagree on the last digit,
which React reports as a hydration mismatch on every marker.

Animation is restricted to `transform` and `opacity` so it stays on the compositor and
never competes with audio.

## 6. Where each thing runs

| Runs locally, always | May use a backend | May use AI (optional) |
| --- | --- | --- |
| Pitch and note detection | Accounts, sync across devices | Theory explanation |
| Tuning and cents | Licensed song content | Practice plans |
| Scales, chords, arpeggios | Shared exercises | Exercise generation |
| Fretboard geometry and shapes | Recording storage (opt-in) | Session summaries |
| Metronome and timing | Aggregate analytics | Natural-language questions |
| Practice grading and accuracy | | Advanced song analysis |
| Camera capture and CV (Phase 5) | | |
| All visualisation | | |

## 7. Computer-vision pipeline

Camera is **input**, not decoration — but it is also not on the critical path.

```
getUserMedia → <video>
  → overlay canvas   30 fps   homography → fret grid → markers
  → GreyscaleSampler 12 fps   160x90 → MotionDetector → StrokeCounter
```

Preview runs at 30 fps; motion analysis at 12. Running vision at display rate burns
battery to produce data nobody reads.

### Detection, tracking and fallback

```
frame → Sobel → Hough lines → orientation families → neck quad + confidence   (worker)
      → NeckTracker: outlier rejection → speed-adaptive smoothing → state machine
      → overlay, or the fallback panel
```

A fretboard is specific enough to find geometrically, with no trained model and nothing to
download: a long band bounded by two near-parallel edges, filled with more parallel lines
(the strings) and crossed by a ladder of perpendicular ones (the fret wires). That last
part is the decisive evidence — long parallel lines are everywhere in a room, but a table
edge has no frets.

**Confidence terms are absolute, not proportional.** An earlier version scored every term
relative to whatever was in the frame, so a nearly empty scene containing two crossing
lines scored 0.74 — as confidently as a real neck — because those two lines were 100% of
the available evidence. On screen it drew a large, wrong overlay in a room with no
instrument in it. Measuring against fixed expectations instead means a sparse scene simply
has too little of everything. There is a regression test for exactly that frame.

**Tracking is separate from detection.** Detection runs in a worker at a rate the tracker
chooses — a confident settled lock is re-checked a few times a second, a lost one is hunted
harder. Between detections the tracker supplies the pose: speed-adaptive smoothing (still
when the instrument is still, responsive when it moves), outlier rejection (a corner that
jumps a third of the frame in one step is a mis-detection, not movement), and a state
machine with counted transitions.

**Hysteresis everywhere**, because the failure mode is flicker:

```
searching → acquiring → tracking → degraded → fallback
              (4 good)   (5 bad)   (20 bad)
```

`degraded` keeps drawing the last good pose through a hand passing over the neck.
Recovering from `degraded` takes 2 good frames; recovering from `fallback` takes the full
acquisition evidence, because it swaps the whole UI.

**Manual alignment remains**, and is the right answer when the angle or the lighting
defeats detection: four corners the player drags, exact and never failing, stored per
instrument.

**The fallback is a stable panel**, pinned to the bottom of the camera view and
deliberately not driven by any tracking output. When detection is struggling the player
still gets a fretboard that does not move, fade or flicker.

Fret lines are positioned with the real rule — distance from the nut to fret n is
L(1 − 2^(−n/12)) — so they land on actual fret wires instead of drifting further out of
register the higher up the neck you look.

`createNeckProjection` returns null for a degenerate quad rather than emitting NaN
coordinates, so a mis-drag produces no overlay instead of a corrupted canvas.

### Motion without a model

Picking and strumming are large, fast, periodic movements. Frame differencing on a
160x90 greyscale copy finds them in a few thousand operations, with no model to download
and nothing to fail offline. `StrokeCounter` turns energy peaks into strokes per minute,
directly comparable with the metronome, with a refractory period so one physical stroke
does not register as several.

Hand landmarks can be layered on later for finger-level detail. They should not be the
thing standing between a player and a working app.

**Fusion rule: audio wins.** Camera output is corroborating evidence with a confidence
score, never the source of truth for which note was played. A hand near the 5th fret at
0.78 confidence does not override an A2 detected at 0.96. Below a confidence floor the app
says so ("move the camera closer to the fretboard") and carries on with audio plus the
virtual fretboard. Every CV feature must be removable without breaking anything.

## 8. Holographic rendering (Phase 6 design)

Three.js on a separate canvas, subscribing to the event bus. It reads `NOTE_CONFIRMED`,
`NOTE_CORRECT` and `BEAT_DETECTED`; it never touches audio buffers. Instanced meshes for
note markers, GPU-side particles, and a hard rule that a dropped frame in the renderer can
never stall detection. The 2D fretboard stays the default; 3D is an enhancement that can
be switched off on a weak device.

## 9. Event vocabulary

Defined in `core/events/types.ts` and emitted on a typed bus:

```
NOTE_DETECTED  NOTE_CONFIRMED  NOTE_RELEASED  SIGNAL_SILENT
NOTE_CORRECT   NOTE_WRONG      NOTE_MISSED
PRACTICE_STARTED  PRACTICE_STOPPED  PRACTICE_COMPLETED
BEAT_DETECTED  BPM_CHANGED
SCALE_CHANGED  CHORD_CHANGED  TUNING_CHANGED
CAMERA_READY  HAND_DETECTED  FRETBOARD_DETECTED  FRETBOARD_LOST
```

The vision events are declared now although Phase 5 is far off: fixing the contract early
is what lets the renderer and the practice engine be written against it without knowing
whether a camera will ever exist.

## 10. Technology choices

| Choice | Reason |
| --- | --- |
| Next.js 15 / React 19 | Static export of every route; all five pages prerender with no server needed |
| TypeScript, `strict` + `noUncheckedIndexedAccess` | DSP code indexes arrays constantly; this catches the off-by-one before it is a silent `undefined` |
| Tailwind 4 | CSS-first tokens; the design system is a token file, not a config object |
| Zustand | Selector-level subscriptions, trivial persistence, no provider tree |
| SVG for the fretboard | Resolution-independent, one tree, no layout pass |
| Web Audio lookahead scheduler | `setInterval` cannot click accurately, but it can *schedule* accurately |
| Vitest | Runs core under Node with no browser |

## 11. Deliberately not done yet

- No backend. Nothing in Phase 1 needs one, and adding one would be a lie about where the
  work happens.
- No song content. Licensing is a product problem, not a technical one; the sequence
  format is ready for it (Phase 4).
- No AI. It goes in last, behind a boundary, once the deterministic system is proven.
