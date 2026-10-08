import { fretSynth } from "./fret-synth";

/**
 * Plays notes, chords and scales for the Music Theory tab on top of the shared
 * `fretSynth`. Sound only starts from a user gesture (the synth creates its
 * AudioContext lazily on first pluck).
 */
let timers: ReturnType<typeof setTimeout>[] = [];

/** Lowest octave used for voicings: pitch class 0 -> C3 (MIDI 48). */
const BASE_MIDI = 48;

/** Stack pitch classes upward from the first one, so a chord voices root-first. */
export function voice(pitchClasses: readonly number[], base = BASE_MIDI): number[] {
  const out: number[] = [];
  for (const pc of pitchClasses) {
    let midi = base + pc;
    const prev = out[out.length - 1];
    if (prev !== undefined) while (midi <= prev) midi += 12;
    out.push(midi);
  }
  return out;
}

export function stopTheory(onDone?: () => void): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  onDone?.();
}

export function playNote(pitchClass: number): void {
  stopTheory();
  void fretSynth.pluck(BASE_MIDI + 12 + pitchClass);
}

/** All notes together, with a barely-there strum so it sounds like a chord, not a click. */
export function playChord(pitchClasses: readonly number[]): void {
  stopTheory();
  voice(pitchClasses).forEach((midi, i) => {
    timers.push(setTimeout(() => void fretSynth.pluck(midi), i * 18));
  });
}

/** Notes one after another, ending on the octave. `onDone` fires after the last note. */
export function playScale(pitchClasses: readonly number[], onDone?: () => void): void {
  stopTheory();
  const midis = voice(pitchClasses);
  midis.push(midis[0]! + 12);
  const step = 380;
  midis.forEach((midi, i) => {
    timers.push(setTimeout(() => void fretSynth.pluck(midi), i * step));
  });
  timers.push(setTimeout(() => onDone?.(), midis.length * step));
}
