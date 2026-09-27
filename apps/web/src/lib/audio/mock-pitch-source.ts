import { midiToFrequency } from "@fretlight/core";
import { SILENT_ESTIMATE, type PitchFrame, type PitchSource } from "./pitch-source";

/**
 * A virtual instrument standing in for the microphone until Phase 2.
 *
 * It is not a stub that emits perfect values: it models the things that make
 * real detection hard, so the UI, the stabiliser and the practice engine are
 * exercised honestly from day one.
 *
 *  - a pick attack where clarity is low for the first few frames;
 *  - intonation error, so the tuner needle has something to say;
 *  - drift and a touch of vibrato during the sustain;
 *  - an exponential decay into the noise floor.
 */
export class MockPitchSource implements PitchSource {
  readonly kind = "mock" as const;
  readonly label = "Virtual instrument";

  private listeners = new Set<(frame: PitchFrame) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private startedAt = 0;

  private currentMidi: number | null = null;
  private noteStartedAt = 0;
  private detune = 0;
  private sustaining = false;
  private decaySeconds = 2.4;

  /** ~60 frames/s, close to what a 1024-sample hop at 48 kHz gives us. */
  constructor(private readonly frameIntervalMs = 16) {}

  get isRunning(): boolean {
    return this.running;
  }

  now(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.startedAt = performance.now();
    this.running = true;
    this.timer = setInterval(() => this.emit(), this.frameIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.currentMidi = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onFrame(listener: (frame: PitchFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pluck a note and let it ring. */
  pluck(midi: number, options: { detuneCents?: number; decaySeconds?: number } = {}): void {
    this.currentMidi = midi;
    this.noteStartedAt = this.now();
    this.sustaining = false;
    this.decaySeconds = options.decaySeconds ?? 2.4;
    // A believable amount of intonation error unless the caller asks for a
    // specific offset — this is what gives the tuner something to correct.
    this.detune = options.detuneCents ?? (Math.random() * 2 - 1) * 14;
  }

  /** Hold a note indefinitely — used by the tuner's "hold" affordance. */
  hold(midi: number, detuneCents?: number): void {
    this.pluck(midi, detuneCents === undefined ? {} : { detuneCents });
    this.sustaining = true;
  }

  release(): void {
    this.currentMidi = null;
    this.sustaining = false;
  }

  /** Nudge the held note's tuning, so the user can "tune" the virtual string. */
  adjustDetune(deltaCents: number): void {
    this.detune = Math.max(-60, Math.min(60, this.detune + deltaCents));
  }

  get detuneCents(): number {
    return this.detune;
  }

  private emit(): void {
    const frame = this.buildFrame();
    for (const listener of this.listeners) listener(frame);
  }

  private buildFrame(): PitchFrame {
    const time = this.now();
    if (this.currentMidi === null) {
      return { estimate: SILENT_ESTIMATE, time };
    }

    const age = time - this.noteStartedAt;
    const envelope = this.sustaining ? 0.55 : Math.exp(-age / this.decaySeconds);
    const rms = envelope * 0.35;

    if (rms < 0.008) {
      this.currentMidi = null;
      return { estimate: SILENT_ESTIMATE, time };
    }

    // The first ~50 ms of a plucked note is transient: the detector should not
    // be confident yet, and the stabiliser should be the thing that waits.
    const attack = Math.min(1, age / 0.05);
    const clarity = Math.max(0, Math.min(1, 0.45 + attack * 0.5 - Math.random() * 0.05));

    // Pitch bends slightly sharp on attack and settles — real strings do this.
    const attackBend = 6 * Math.exp(-age / 0.09);
    const vibrato = this.sustaining ? Math.sin(age * 2 * Math.PI * 4.5) * 1.5 : 0;
    const jitter = (Math.random() * 2 - 1) * 1.2;
    const cents = this.detune + attackBend + vibrato + jitter;

    const frequency = midiToFrequency(this.currentMidi) * Math.pow(2, cents / 1200);
    return {
      estimate: {
        frequency,
        clarity,
        rms,
        silent: false,
        // Plausible values for a plucked string, so the virtual instrument goes
        // through the instrument gate rather than around it. If the gate ever
        // starts rejecting real playing, it will reject this too — which is
        // exactly the early warning we want.
        quality: {
          clarity,
          flatness: 0.10 + Math.random() * 0.04,
          harmonicRatio: 0.55,
          zeroCrossingRate: 0.05,
          rms,
          onset: age < 0.05,
        },
      },
      time,
    };
  }
}
