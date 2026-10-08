# Fretlight UX audit and redesign plan

Audited against the code in this repository. "Done" means it exists in the repository now. Items marked "Open" are proposals.

## 1. What already existed (kept, not rebuilt)

- **App shell:** an icon rail on desktop and a bottom tab bar plus "More" sheet on phones. Pages share one content width.
- **Design tokens:** colour tokens (`--color-void`, `--color-signal`, `--color-root`, `--color-error`, …) in `app/globals.css`. Global `:focus-visible` outline and a `prefers-reduced-motion` block are already there.
- **Shared instrument and tuning:** one zustand session store (`store/session.ts`), used by Tuner, Fretboard, Companion, Practice, Looper and Bassline.
- **Shared music theory and audio:**
  - `@fretlight/core` holds notes, intervals, scales, chords, triads, key detection, tunings and fretboard mapping.
  - One synth (`fretSynth`) and one looper AudioContext with Web Audio scheduling.
- **Home** already asks "What do you want to do?" with six intents and a real-data "Next step".
- **Local-only data:**
  - Progress and weak areas in localStorage.
  - Loops in IndexedDB.
  - Recorded audio never leaves the device.
- **Cross-page links:** Analyzer → Companion, Practice and Looper. Bassline → Companion and Looper. Progress → Practice.

## 2. Audit

| Page | Issue | Severity | Why it matters | Fix | Status |
|---|---|---|---|---|---|
| Companion | No single "answer" button; users had to pick among 7 idea types first | Critical | The page's job is "what can I play?", but it asked a theory question back | "What should I play?" card with Safe / Melodic / Interesting picks, Hear, Slow, Tab, Why | Done |
| Companion | Opened on the Looper tab by default | High | First-time users landed on a recording screen | Default tab is Ideas | Done |
| Nav | 11 tools at equal weight with no grouping | High | Hard to see Companion vs Practice vs Analyzer | Rail and More sheet grouped into Learn / Play / Practice / Progress | Done |
| Nav | No home for app-wide settings | High | Instrument, language and data controls were scattered | New `/settings` page | Done |
| Companion | No transpose | Medium | Singers change key; ideas should follow | −½ / +½ buttons; every idea, tab and fretboard updates | Done |
| Companion | Strum patterns only shown as a D/U letter grid | Medium | Hard to read on a music stand | Large ↓ ↑ arrow line above the grid | Done |
| Looper | No mute/solo keys | Low | Hands are on the instrument | M / S toggle the newest line | Done |
| More sheet | Tap targets about 40px | Medium | Below the 44px guideline | `min-h-11` (44px) on sheet links and settings controls | Done |
| Fretboard | Screen readers only hear "fretboard, 6 strings" | Medium | Marker content is invisible to assistive technology | Add an sr-only list of the highlighted notes | Open |
| Tuner | The needle has no live text for screen readers | Medium | Blind players cannot tune | aria-live "Too low / In tune / Too high" with throttling | Open |
| All | Colour carries meaning (root pink, 3rd cyan) | Medium | Colour-blind users | Legends already name each colour; add a shape or letter mode | Partly done |
| All | Client-rendered pages share one metadata title | Low | Share previews are generic | Per-route `metadata` exports via server layout files | Open |
| Companion | Fills can jump across the neck | Medium | The ideas aren't always physically comfortable | Position-aware generation around a chosen fret window | Open |

## 3. Missing features

| Feature | User value | Effort | Where it lives |
|---|---|---|---|
| "What should I play?" with 3 graded picks | Instant playable answer | M | Companion, top of Ideas (done) |
| Settings page | One place for global choices and data deletion | S | `/settings` (done) |
| Transpose | Play in the singer's key | S | Companion progression (done) |
| Position-aware fills ("nearest playable fill") | Comfortable ideas near your hand | M | Companion idea controls |
| Favorites across fills, shapes and progressions | Replay what you liked | M | Companion "Saved ideas" exists; extend it |
| First-run onboarding (instrument, tuning, mic explainer) | Fewer wrong first impressions | M | Home, first visit |
| Chord-change drill (C → G timing) | Measures the change skill, feeds Progress | M | Practice |
| Left-handed fretboard mirror | Usable for left-handed players | S | Settings → Display |
| High-contrast theme | Readability on a music stand | S | Settings → Display |
| Ear training ("play this note") | Ear and fretboard memory | M | Practice (note drills already exist) |

**Roadmap**
- **Quick wins (1 day):** screen-reader text for the Tuner and Fretboard, left-handed mirror, high-contrast toggle.
- **Next (1 week):** position-aware fills, chord-change drill feeding the skill map, onboarding.
- **Later:** call-and-response practice, feedback on looper takes, per-route metadata and Open Graph images.

## 4. Implementation checklist (this change)

1. `packages/core/src/companion/transpose.ts` (+ test): `transposeProgressionText`.
2. `apps/web/src/components/companion/QuickIdeas.tsx`: the beginner "What should I play?" card.
3. `apps/web/src/app/companion/page.tsx`: QuickIdeas first; Ideas is the default tab.
4. `apps/web/src/components/companion/ProgressionPanel.tsx`: transpose buttons.
5. `apps/web/src/components/companion/IdeaView.tsx`: ↓ ↑ strum line.
6. `apps/web/src/components/looper/LooperPanel.tsx`: M / S shortcuts.
7. `apps/web/src/components/layout/nav.ts` and `AppShell.tsx`: goal groups, Settings item, 44px sheet targets, scrollable rail.
8. `apps/web/src/app/settings/page.tsx`: instrument, tuning, language, labels, orientation, chime, sound, data deletion.
9. `apps/web/src/lib/i18n/*`: English and Burmese for all of the above.

## 5. QA list

- 375 px phone: Home, Companion, Settings have no horizontal scroll (checked).
- Companion: "What should I play?" gives 3 picks; Hear plays; Tab and Fretboard switch (checked in the browser).
- Keyboard: Tab reaches every button with a visible focus ring. In the Looper, Space / R / M / S / Esc are ignored while typing in a field.
- Settings → Delete asks for confirmation and removes only that store.
- Open: screen-reader pass with NVDA and VoiceOver; a real-device recording test.

## 6. Premium feature matrix (audit, round 3)

| Area | Status | Notes |
|---|---|---|
| A. Tuner | Partial | Chromatic, string-by-string, input device, alternate tunings incl. DADGAD (added). No left-handed mode. No A4 calibration UI to check. |
| B. Metronome | Partial | BPM, tap, time signatures, subdivisions, accent, visual beat. **Speed trainer (tempo ramp) added.** It ramps by time, not by measured success. |
| C. Fretboard | Partial | Notes/intervals/degrees, scales, chords, triads, note inspector, sound. Missing: capo, left-handed, CAGED. |
| D. Chord library | Partial | 16 chord types in core; Fretboard chord mode; Cowboy shapes. Missing: multiple voicings per chord and a dedicated library page. |
| E. Chord trainer | Missing | Live chord detection exists (Listen); a scored chord-change drill does not. |
| F. Scales | Existing | 13 scales incl. modes, harmonic/melodic minor. |
| G. CAGED | Missing | |
| H. Triads | Existing | Inversions, playback, link to lead. |
| I. Arpeggios | Partial | `getArpeggio` in core, used by Practice drills. |
| J. Ear training | **Added** | Intervals and chord types, 3 levels, weak spots stored locally. Note, scale, key and rhythm recognition still missing. |
| K–L. Rhythm / strumming | Partial | Style rhythm patterns with ↓↑ arrows, Hear. No scored rhythm trainer. |
| M–N. TAB / TAB player | Partial | Generated, validated TAB text; no technique notation, seek or speed player. |
| O–R. Song / Analyzer / chord & key detection | Existing | Local decode, BPM, chroma, Viterbi smoothing, key with alternative, sections, confidence, correction. |
| S–X. Companion, fills, lead, melody, bass | Existing | "What should I play?" Safe/Melodic/Interesting, fills 1 beat–2 bars, lead/counter, 9 bass types, transpose. Missing: riff generator, position-aware fills. |
| Y. Jam mode | Existing | Looper "What can I play now?" follows the playing loop. |
| Z–AA. Looper and noise control | Existing | Multi-track, one clock, gate, compressor, meter, clipping, monitor, M/S/R/Space/Esc. |
| AB–AE. Practice, improvisation, call & response, sight reading | Partial | Note/scale/position drills with scoring; the others are missing. |
| AH–AJ. Favorites, routines, recommendations | Partial | Saved Companion ideas; recommendations from real data. No custom routines. |
| AK. Skill tree | Partial | Skill map from real data; says "not enough data" honestly. |
| AL–AO. Transpose, capo, left-handed, custom tuning | Partial | Transpose and custom tuning exist; no capo or left-handed mode. |
| AP–AQ. Theory lessons, learning path | Missing | |
