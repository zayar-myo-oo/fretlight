import { midiToFrequency } from "@fretlight/core";

/**
 * Plays reference pitches to tune by ear against the target note.
 *
 * Follows the same lifecycle as MetronomeEngine: one lazily-created
 * AudioContext kept alive for the component's lifetime rather than recreated
 * per call.
 */
export class ReferenceToneEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: { oscillator: OscillatorNode; gain: GainNode } | null = null;
  private volume = 0.5;

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  /** Sounds a sustained reference pitch for `midi`. Call `stop()` to release it. */
  async playNote(midi: number, a4?: number): Promise<void> {
    const context = await this.ensureContext();
    this.stop();

    const frequency = midiToFrequency(midi, a4);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(this.volume, context.currentTime + 0.03);

    oscillator.connect(gain).connect(this.master!);
    oscillator.start();
    this.active = { oscillator, gain };
  }

  /** Fades and releases any currently-sounding reference note. */
  stop(): void {
    const active = this.active;
    const context = this.context;
    if (!active || !context) return;
    const now = context.currentTime;
    active.gain.gain.cancelScheduledValues(now);
    active.gain.gain.setValueAtTime(Math.max(active.gain.gain.value, 0.0001), now);
    active.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    active.oscillator.stop(now + 0.1);
    this.active = null;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }
}
