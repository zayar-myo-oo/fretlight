import { type Fretboard, type Idea, type Progression } from "@fretlight/core";
import { type PlayEvent, beatsToSeconds, chordPreset, chordVoicing, ideaEvents } from "./companion-player";
import { fretSynth } from "./fret-synth";

export interface LoopOptions {
  readonly progression: Progression;
  readonly board?: Fretboard;
  readonly bpm: number;
  /** Ideas (fills) to play on top of the chords, once per pass. */
  readonly ideas?: readonly Idea[];
  /** Called with the index of the chord that is sounding. */
  readonly onChord: (index: number) => void;
}

/**
 * Plays a progression round and round at a steady tempo, with optional fills,
 * so the player can improvise over it. Each pass is scheduled on the audio clock
 * a little ahead of time; the screen follows the same clock.
 */
export class ProgressionLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  async start(options: LoopOptions): Promise<void> {
    this.stop();
    this.running = true;
    const { progression, bpm } = options;
    const passSeconds = beatsToSeconds(progression.totalBeats, bpm);
    const pass = (): PlayEvent[] => {
      const events: PlayEvent[] = [];
      for (const chord of progression.chords) {
        const at = beatsToSeconds(chord.startBeat, bpm);
        chordVoicing(chord, options.board).forEach((midi, i) =>
          events.push({ at: at + i * 0.018, midi, preset: chordPreset(), gain: 0.7 }),
        );
      }
      for (const idea of options.ideas ?? []) events.push(...ideaEvents(idea, bpm, 0));
      return events;
    };

    // Render every note once before the clock starts, so the first pass is not late.
    const t0 = (await fretSynth.warm(pass())) + 0.1;
    if (!this.running) return;
    let scheduled = 0;
    const schedule = (index: number) => {
      for (const e of pass()) {
        void fretSynth.pluck(e.midi, e.preset, {
          at: t0 + index * passSeconds + e.at,
          ...(e.gain !== undefined ? { gain: e.gain } : {}),
          ...(e.mute ? { mute: true } : {}),
        });
      }
    };
    schedule(scheduled++);

    this.timer = setInterval(() => {
      // Keep one pass queued ahead of the clock.
      if (fretSynth.currentTime() > t0 + (scheduled - 1) * passSeconds - 0.4) schedule(scheduled++);
    }, 120);

    let last = -1;
    const tick = () => {
      if (!this.running) return;
      const elapsed = fretSynth.currentTime() - t0;
      if (elapsed >= 0) {
        const beat = (elapsed / 60) * bpm;
        const within = beat % progression.totalBeats;
        const chord = progression.chords.find((c) => within >= c.startBeat && within < c.startBeat + c.beats) ?? progression.chords[0]!;
        if (chord.index !== last) {
          last = chord.index;
          options.onChord(chord.index);
        }
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.frame);
    fretSynth.stopAll();
  }
}
