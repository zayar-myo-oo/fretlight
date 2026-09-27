/**
 * Energy-based onset detection.
 *
 * A note should be recognised because the player *started* one, not because the
 * microphone level wobbled. Comparing short-term energy against a slower moving
 * average finds the sharp rise that a pluck or a pick stroke produces, while
 * ignoring the gradual level changes that a conversation or a passing bus makes.
 */
export interface OnsetOptions {
  /** How fast the reference level follows the signal. Lower = slower. */
  readonly adaptationRate?: number;
  /** Energy must exceed the running average by this factor to count as an onset. */
  readonly riseFactor?: number;
  /** Minimum gap between onsets, in frames — one pluck is one onset. */
  readonly refractoryFrames?: number;
  /** Absolute floor; below this the signal is too quiet for an onset to mean anything. */
  readonly floor?: number;
}

export interface OnsetResult {
  readonly onset: boolean;
  /** Current short-term energy. */
  readonly energy: number;
  /** The adaptive reference it was compared against. */
  readonly baseline: number;
  /** How far above baseline, as a ratio. */
  readonly rise: number;
}

export class OnsetDetector {
  private baseline = 0;
  private sinceOnset = Number.MAX_SAFE_INTEGER;
  private readonly adaptationRate: number;
  private readonly riseFactor: number;
  private readonly refractoryFrames: number;
  private readonly floor: number;

  constructor(options: OnsetOptions = {}) {
    this.adaptationRate = options.adaptationRate ?? 0.15;
    this.riseFactor = options.riseFactor ?? 1.6;
    this.refractoryFrames = options.refractoryFrames ?? 4;
    this.floor = options.floor ?? 0.01;
  }

  push(rms: number): OnsetResult {
    this.sinceOnset++;
    const energy = rms;

    if (this.baseline === 0) {
      this.baseline = energy;
      return { onset: false, energy, baseline: this.baseline, rise: 1 };
    }

    const rise = this.baseline > 0 ? energy / this.baseline : 0;
    const onset =
      energy > this.floor &&
      rise >= this.riseFactor &&
      this.sinceOnset >= this.refractoryFrames;

    if (onset) this.sinceOnset = 0;

    // Track rises quickly and decays slowly, so the baseline sits near the noise
    // floor rather than being dragged up by the note that just sounded — which
    // would make the *next* pluck harder to detect.
    const rate = energy > this.baseline ? this.adaptationRate : this.adaptationRate * 0.35;
    this.baseline += (energy - this.baseline) * rate;

    return { onset, energy, baseline: this.baseline, rise };
  }

  /** Frames since the last onset — how far into a note we are. */
  get framesSinceOnset(): number {
    return this.sinceOnset;
  }

  reset(): void {
    this.baseline = 0;
    this.sinceOnset = Number.MAX_SAFE_INTEGER;
  }
}
