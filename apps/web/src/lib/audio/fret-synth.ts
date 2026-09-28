import { midiToFrequency } from "@fretlight/core";

/**
 * Sounds a note out loud when the player taps a fret on screen.
 *
 * Deliberately not `ReferenceToneEngine`: that class holds one sustained tone
 * and stops it the moment another starts, which is right for "match this
 * pitch" but wrong here — tapping out a scale should let each note ring and
 * decay on its own, the way a real string does, with earlier taps still
 * fading while a new one starts. So every `pluck()` gets its own oscillators
 * and its own envelope, and nothing is kept around to "stop" later; each one
 * cleans itself up once its decay finishes.
 */
export class FretSynth {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.22;

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  /** Pluck `midi` and let it ring and decay on its own. */
  async pluck(midi: number): Promise<void> {
    const context = await this.ensureContext();
    const master = this.master!;
    const frequency = midiToFrequency(midi);
    const now = context.currentTime;

    // A fundamental plus two falling harmonics reads as a plucked string
    // rather than a lab-tone sine; the decay times fan out slightly so the
    // upper harmonics die first, which is what makes a decay sound plucked
    // instead of switched off.
    const partials: readonly [multiple: number, gain: number, decay: number][] = [
      [1, 1, 1.6],
      [2, 0.35, 1.1],
      [3, 0.15, 0.7],
    ];

    for (const [multiple, gain, decay] of partials) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency * multiple, now);

      const peak = this.volume * gain;
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), now + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + decay);

      oscillator.connect(envelope).connect(master);
      oscillator.start(now);
      oscillator.stop(now + decay + 0.05);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
    }
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }
}

/** One instance for the whole app — tapping a fret on any page sounds the same. */
export const fretSynth = new FretSynth();
