# Fretlight

An intelligent practice companion for guitar and bass. You play a real instrument; the app
listens, works out what you played, and shows you where you are on the neck — all computed
on your device.

**Not "ChatGPT for guitar."** The intelligence here is DSP, music theory and real-time
interaction. No AI call sits anywhere in the practice loop.

## Status: microphone and camera both live

The deterministic engine, the full UI, real microphone input and the camera overlay are
built and tested. A virtual instrument is still there as a fallback for when no microphone
is available — or when you want to explore the app without picking anything up.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm test             # 87 unit tests, ~600 ms
npm run typecheck    # strict, both packages
npm run build        # production build
```

Requires Node 20, 22 or 24 (see `.nvmrc`). Node 23 is an odd-numbered release that
the test runner does not list as supported — it works, but npm will warn.

`.npmrc` sets `legacy-peer-deps=true` to work around a crash in npm 10.9.x's peer
resolution; the file explains when it can be removed.

`packages/core` uses extension-less relative imports. Carrying `.js` required a webpack
`resolve.extensionAlias` shim, and that shim was where hot reloads of core corrupted the
module graph and killed the dev server. The trade-off: the emitted `dist/` is not directly
runnable by Node's bare ESM resolver, which nothing currently needs (bundlers and Metro
resolve extension-less imports fine).

Dev runs on webpack. Turbopack in Next 15.5 fails this app with "can't infer type of chunk
from URL app-pages-internals" and renders nothing — worth retrying on a later Next.

## What works today

| Screen | What it does |
| --- | --- |
| **Home** | Instrument and tuning selection, capability levels, local progress |
| **Tuner** | Chromatic tuner, ±0.1¢ resolution, cents meter, every position of the detected note |
| **Fretboard** | 13 scales, 16 chord types, generated position boxes, degree/interval labels, chords that fit the scale |
| **Metronome** | Audio-clock scheduling, subdivisions, odd meters, tap tempo, keyboard transport |
| **Practice** | Note, fret and interval drills plus scale runs, boxes and arpeggios; live grading, streak, reaction time, saved history |
| **Live** | Camera overlay drawn onto your real neck, note log, picking-movement analysis |

Everything runs offline. Nothing is uploaded.

## Layout

```
packages/core   @fretlight/core — theory, fretboard, DSP, timing, practice. No DOM.
apps/web        Next.js app. All browser APIs live here.
docs/           Architecture, reference analysis, roadmap.
```

The core package is deliberately platform-free so a React Native app can import the same
engines rather than reimplementing them.

## Connecting an input

Pick **Microphone** or **Audio interface**, choose the device, and press **Connect input**.
The browser asks for permission once.

Both types run the *identical* pipeline — the browser exposes an interface as just
another audio input, and there is no second detector. The choice narrows the device list
and sets the noise floor, which genuinely differs: a DI signal has no room in it, so the
gate can sit lower and still catch quiet playing.

Unplugging an interface mid-session is handled: the app says so and falls back to the
virtual instrument rather than looking live while hearing nothing.

Speech processing is switched off deliberately — echo cancellation, noise suppression and
auto-gain are all tuned for voice and will strip a sustained bass fundamental or pump a
decaying note. Detection runs in a Web Worker on your device; no audio is uploaded, and
none is recorded unless you ask for it.

If the microphone is blocked or missing, the app falls back to the virtual instrument
rather than going silent.

**Talking near the microphone will not produce notes.** Speech overlaps a guitar in
frequency, so the detector judges it on behaviour instead: a fretted string holds pitch to
within a few cents, while speech slides continuously. Combined with spectral and harmonic
checks, that rejects conversation, TV and room noise while still hearing a note played
over the top of them.

**Playing one note highlights one position**, not every place that pitch exists on the
neck.

**The note is never the whole answer.** Every detection carries pitch *and* octave *and*
string *and* fret — "A" is true of both the 5th fret of a bass E string and the open A
string, and telling you "A" leaves you exactly as lost as before.

The estimator works out where you played from an inferred hand position, updated by each
fretted note you play (open strings deliberately do not move it — they need no hand). A
run up the E string now stays on the E string:

| Played | Reported |
| --- | --- |
| G1 — E string, fret 3 | String 2 · E, fret 3 |
| A1 — E string, fret 5 | String 2 · E, fret 5 |
| B1 — E string, fret 7 | String 2 · E, fret 7 |

**Set where your hand is** when starting cold. The opening note of a phrase is genuinely
ambiguous — an A2 played on the low E at the 5th fret and the open A string are *the same
waveform*, and nothing in the audio separates them.

Measured on a guitar, with no hand position set:

| What you play | No hand set | Hand set |
| --- | --- | --- |
| Open strings | 6/6 | 6/6 |
| Run up one string | 5/5 | 5/5 |
| 5th position | 3/6 | 6/6 |
| 12th position | — | 6/6 |
| A-minor pentatonic box 1 | 8/12 | 12/12 | The **Hand at**
control sits above the fretboard on the Tuner and Fretboard screens, and the assumed
window is drawn on the neck so you can see and correct what the app is assuming. Camera
hand tracking will eventually set it for you.

## Practice drills

Three drills, in the order they build on each other:

| Drill | Asks | Teaches |
| --- | --- | --- |
| **Note** | "Play an A — anywhere" | The sound and the name |
| **Fret** | "Play the A on the D string, 7th fret" | Where notes actually live |
| **Interval** | "From A, play the 5th" | The shapes scales and bass lines are made of |

Each tracks accuracy, streak and reaction time. Wrong notes hold position so you can
correct yourself rather than being dragged onward.

**A limitation worth knowing:** audio alone cannot tell an A2 played on the low E at fret
5 from the open A string — they are the same waveform. So fret drills target only
positions whose pitch is unique on your neck, which are genuinely markable by ear. Ask for
a range that contains none and the drill widens, and says the position cannot be
confirmed. Camera hand tracking will lift that restriction.

## Using the camera

On the **Live** screen, press **Start camera**. In **Auto track** the app finds your neck
by itself and the overlay follows the instrument as you move it. A badge shows the
tracking state and confidence.

When it cannot hold a lock — the neck is too far away, too dark, or out of frame — a
**stable fretboard panel** appears at the bottom of the camera view instead. It does not
move or flicker; it is there so you always have a fretboard.

**Manual** mode is the reliable fallback for awkward angles or lighting: drag four handles
onto the neck (1 and 4 at the nut, 2 and 3 at the fret in the dropdown; 1 and 2 on the
lowest-string side). The alignment is saved per instrument, so it is a one-time job.

Either way the app recovers the plane of your fretboard and draws the scale onto it in
correct perspective — fret lines land on real fret wires, because the spacing uses the
actual rule rather than even spacing.

## Bass is a first-class citizen

The pitch detector is tested against synthesised plucks where the fundamental is weaker
than the 2nd harmonic — the case that makes naive detectors report the octave above.
Measured through the live microphone path, not just in unit tests:

| String | Frequency | Reported |
| --- | --- | --- |
| B0 | 30.87 Hz | B0 +1¢ |
| E1 | 41.20 Hz | E1 −1¢ |
| A1 | 55.00 Hz | A1 −1¢ |
| D2 | 73.42 Hz | D2 +0¢ |
| G2 | 98.00 Hz | G2 +0¢ |

Each instrument profile carries its own search range, so a 4-string bass does not waste
effort (or invite errors) hunting below its lowest note, while a 5-string reaches down to
the low B.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — pipelines, state tiers, technology choices
- [Reference analysis](docs/REFERENCE-ANALYSIS.md) — what the reference recording does, and what to do differently
- [Roadmap](docs/ROADMAP.md) — phases 2 through 7

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Start / stop transport |
| `↑` `↓` | ±1 BPM |
| `←` `→` | ±5 BPM |
| `T` | Tap tempo |
| `M` | Toggle metronome (practice screen) |
| `S` | Skip note (practice screen) |

## Privacy

Audio and video are processed on your device and never leave it. There is no backend, no
analytics and no model call anywhere in the practice loop.
