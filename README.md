# Fretlight

Learn the guitar and bass fretboard by seeing notes, hearing them, understanding
their relationships and playing them yourself. Audio is processed on your device.

## Three screens

- **Fretboard** opens first. Notes & chords shows scales, chord tones and positions.
  Relationships connects selected notes to intervals, keys and chords.
  Play & listen accepts microphone/interface input for single notes or chords.
  A compact metronome provides tempo alongside the fretboard.
- **Tuner** provides chromatic tuning, reference string sounds and custom tuning.
- **Settings** holds instrument, tuning, language, display and sound preferences.

Tap a fret to hear it. Choose note names, degrees or intervals in Display.
Recorded instrument samples load in the background; a modelled string works
offline. The Sound menu shows loading status and offers a cancellable preview.

Audio alone cannot always identify the string and fret for a pitch. Hand-position
selection narrows the estimate. Chord recognition is available; strumming rhythm
and downstroke/upstroke grading are not implemented yet.

## Development

Requires Node 20, 22 or 24.

~~~sh
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run test:e2e --workspace @fretlight/web # installed Chrome required
~~~

Core theory, DSP and timing live in packages/core. The Next.js browser app lives
in apps/web. The current feature scope is documented in docs/ROADMAP.md and
docs/ARCHITECTURE.md.

## Hosting

The existing Vercel project publishes Git updates to main. Verify the live commit
at /api/version. The former feature URLs redirect to /fretboard. No new hosting
project is required.

## Privacy

Microphone input is analysed locally. Record take explicitly saves captured audio and
timestamped detection events to this browser (IndexedDB); nothing is uploaded.
Export audio and timeline JSON to keep a portable copy, or delete individual takes.
Preferences stay in this browser. Stored data from retired features is left
untouched and is no longer read by the app.

Audio repair details, validation results and hardware limitations are in [docs/AUDIO-REPAIR.md](docs/AUDIO-REPAIR.md).
