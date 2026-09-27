/**
 * Frame-differencing motion analysis.
 *
 * Deliberately not a neural network: picking and strumming are large, fast,
 * periodic movements, and a difference image finds them for a few thousand
 * operations per frame with no model to download and nothing to fail offline.
 * A hand-landmark model can be layered on later for finger-level detail, but it
 * should not be the thing standing between a player and a working app.
 *
 * Operates on a downscaled greyscale buffer supplied by the caller, so the
 * browser-specific business of getting pixels out of a video element stays in
 * the app layer and this stays testable.
 */

export interface MotionResult {
  /** 0..1 share of the frame that changed. */
  readonly energy: number;
  /** Centre of mass of the change, in 0..1 frame coordinates, or null when still. */
  readonly centroid: { x: number; y: number } | null;
  /** True once energy crosses the activity threshold. */
  readonly active: boolean;
}

export interface MotionOptions {
  readonly width: number;
  readonly height: number;
  /** Per-pixel luminance change (0..255) that counts as movement. */
  readonly threshold?: number;
  /** Fraction of changed pixels above which the frame counts as active. */
  readonly activityThreshold?: number;
}

export class MotionDetector {
  private previous: Uint8ClampedArray | null = null;
  private readonly threshold: number;
  private readonly activityThreshold: number;

  constructor(private readonly options: MotionOptions) {
    this.threshold = options.threshold ?? 18;
    this.activityThreshold = options.activityThreshold ?? 0.012;
  }

  /** Feed one greyscale frame, `width * height` bytes. */
  process(grey: Uint8ClampedArray): MotionResult {
    const { width, height } = this.options;
    const previous = this.previous;

    if (!previous || previous.length !== grey.length) {
      this.previous = grey.slice();
      return { energy: 0, centroid: null, active: false };
    }

    let changed = 0;
    let sumX = 0;
    let sumY = 0;

    for (let i = 0; i < grey.length; i++) {
      const delta = Math.abs(grey[i]! - previous[i]!);
      if (delta > this.threshold) {
        changed++;
        sumX += i % width;
        sumY += (i / width) | 0;
      }
    }

    this.previous = grey.slice();

    const energy = changed / grey.length;
    return {
      energy,
      centroid:
        changed === 0
          ? null
          : { x: sumX / changed / width, y: sumY / changed / height },
      active: energy >= this.activityThreshold,
    };
  }

  reset(): void {
    this.previous = null;
  }
}

/**
 * Turns a stream of motion energy into a stroke rate.
 *
 * Picking and strumming produce periodic peaks in motion energy; counting peaks
 * over a window gives strokes per minute, which is directly comparable with the
 * metronome's tempo. A refractory period after each peak prevents one physical
 * stroke from registering as several as the energy wobbles across the threshold.
 */
export class StrokeCounter {
  private times: number[] = [];
  private lastPeak = -Infinity;
  private rising = false;

  constructor(
    private readonly refractorySeconds = 0.12,
    private readonly windowSeconds = 4,
  ) {}

  /** Returns true when this sample was counted as a new stroke. */
  push(energy: number, time: number, threshold = 0.02): boolean {
    const above = energy >= threshold;
    let counted = false;

    if (above && !this.rising && time - this.lastPeak > this.refractorySeconds) {
      this.times.push(time);
      this.lastPeak = time;
      counted = true;
    }
    this.rising = above;

    const cutoff = time - this.windowSeconds;
    while (this.times.length > 0 && this.times[0]! < cutoff) this.times.shift();

    return counted;
  }

  /** Strokes per minute over the recent window, or null with too little data. */
  rate(): number | null {
    if (this.times.length < 3) return null;
    const first = this.times[0]!;
    const last = this.times[this.times.length - 1]!;
    const span = last - first;
    if (span <= 0) return null;
    return ((this.times.length - 1) / span) * 60;
  }

  get strokeCount(): number {
    return this.times.length;
  }

  reset(): void {
    this.times = [];
    this.lastPeak = -Infinity;
    this.rising = false;
  }
}

/**
 * Per-pixel map of where the picture has been changing.
 *
 * This is the answer to the neck detector's hardest failure. Window blinds, a
 * shelf, an unlit television and a dark shirt all produce exactly what the
 * detector looks for — a dark elongated band crossed by regular lines — and no
 * amount of geometry or colour separates them reliably from a fretboard.
 *
 * But they hold still, and an instrument being played does not. Accumulating
 * frame differences over a few seconds produces a mask that is bright on the
 * player and their guitar and dark on the room, which is a discriminator none of
 * the static cues can provide.
 *
 * Costs one subtract and one blend per pixel per sampled frame, on data the
 * motion detector is already reading.
 */
export class MotionAccumulator {
  private previous: Uint8ClampedArray | null = null;
  private readonly map: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
    /** How fast a region fades back to "static" once it stops moving. */
    private readonly decay = 0.94,
    /** Luminance change counted as movement. */
    private readonly threshold = 12,
  ) {
    this.map = new Uint8ClampedArray(width * height);
  }

  /** Feed the same greyscale frames the motion detector gets. */
  push(grey: Uint8ClampedArray): Uint8ClampedArray {
    const previous = this.previous;
    if (!previous || previous.length !== grey.length) {
      this.previous = grey.slice();
      return this.map;
    }

    for (let i = 0; i < grey.length; i++) {
      const delta = Math.abs(grey[i]! - previous[i]!);
      const faded = this.map[i]! * this.decay;
      // A moving pixel jumps the map up immediately; a still one drifts down.
      this.map[i] = delta > this.threshold ? Math.min(255, faded + 90) : faded;
    }

    this.previous = grey.slice();
    return this.map;
  }

  /** The accumulated map. Bright where things have been moving. */
  get activity(): Uint8ClampedArray {
    return this.map;
  }

  /** True once enough frames have been seen for the map to mean anything. */
  get isWarm(): boolean {
    return this.previous !== null;
  }

  reset(): void {
    this.previous = null;
    this.map.fill(0);
  }
}
