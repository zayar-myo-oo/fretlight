import { type SoundPreset, fretSynth } from "./fret-synth";
export interface PlayEvent {
  readonly at: number;
  readonly midi: number;
  readonly preset?: SoundPreset;
  readonly gain?: number;
  readonly mute?: boolean;
}
let generation = 0;
let doneTimer: ReturnType<typeof setTimeout> | undefined;
export function stopPlayback(): void {
  generation++;
  clearTimeout(doneTimer);
  fretSynth.stopAll();
}
export async function playEvents(events: readonly PlayEvent[], seconds: number, onDone?: () => void): Promise<void> {
  stopPlayback();
  const id = generation;
  const start = (await fretSynth.warm(events)) + 0.08;
  if (id !== generation) return;
  await Promise.all(events.map(e => fretSynth.pluck(e.midi, e.preset, { at: start + Math.max(0, e.at), gain: e.gain, mute: e.mute })));
  if (id !== generation) return;
  doneTimer = setTimeout(() => onDone?.(), Math.max(0, start + seconds - fretSynth.currentTime()) * 1000);
}
