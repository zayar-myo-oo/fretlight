/**
 * Tracks the room's ambient level so the gate can sit just above it.
 *
 * A fixed RMS threshold cannot serve both a quiet bedroom and a room with a fan
 * running. Set it high enough for the noisy room and quiet playing disappears —
 * measured on this pipeline, a note at RMS 0.008 went from 96% detected to 0%
 * purely because of the threshold. Set it low enough for the quiet room and the
 * noisy one analyses its own air conditioning all day.
 *
 * So it is measured instead. The floor follows the *quiet* moments between
 * notes: it drops quickly when the room goes quiet and rises slowly, so a
 * sustained note can never drag the floor up behind it and mute itself.
 */
export interface NoiseFloorOptions {
  /** Never gate below this, however quiet the room. */
  readonly absoluteFloor?: number;
  /** How far above the measured ambient level the gate sits. */
  readonly margin?: number;
  /** Ceiling, so a noisy room cannot raise the gate past all real playing. */
  readonly maxFloor?: number;
  /** Per-frame upward leak on the minimum estimate. */
  readonly leak?: number;
}

export class NoiseFloorTracker {
  private ambient: number | null = null;
  private readonly absoluteFloor: number;
  private readonly margin: number;
  private readonly maxFloor: number;
  /** Per-frame upward leak, so the estimate can recover from a quiet moment. */
  private readonly leak: number;

  constructor(options: NoiseFloorOptions = {}) {
    this.absoluteFloor = options.absoluteFloor ?? 0.0015;
    this.margin = options.margin ?? 2.2;
    this.maxFloor = options.maxFloor ?? 0.02;
    this.leak = options.leak ?? 0.0008;
  }

  /** Feed every frame's RMS, whether or not a note was found. */
  observe(rms: number): void {
    if (!Number.isFinite(rms) || rms <= 0) return;
    if (this.ambient === null) {
      this.ambient = rms;
      return;
    }

    // Track the *minimum*, with a slow upward leak.
    //
    // An averaging follower fails here in a way that is easy to miss: a note
    // decaying over a couple of seconds looks exactly like the room going
    // quiet, so the floor chases the note down and then gates the very note it
    // was following. Taking the minimum cannot do that — a note is always
    // louder than the silence around it — while the leak lets the estimate
    // recover if the room genuinely gets noisier.
    this.ambient = Math.min(rms, this.ambient * (1 + this.leak));
  }

  /** The level a frame must exceed to be worth analysing. */
  get threshold(): number {
    if (this.ambient === null) return this.absoluteFloor;
    return Math.min(this.maxFloor, Math.max(this.absoluteFloor, this.ambient * this.margin));
  }

  /** Measured room level, for a "your room is noisy" hint in the UI. */
  get ambientLevel(): number {
    return this.ambient ?? 0;
  }

  reset(): void {
    this.ambient = null;
  }
}
