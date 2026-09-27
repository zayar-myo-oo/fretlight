import type { Point } from "./homography";
import type { NeckDetection } from "./neck-detector";

export type TrackingState =
  /** Nothing found yet. */
  | "searching"
  /** Something found, gathering enough consecutive frames to trust it. */
  | "acquiring"
  /** Locked on and following. */
  | "tracking"
  /** Lost it momentarily — still drawing the last good pose. */
  | "degraded"
  /** Given up for now; the UI should show the stable fallback fretboard. */
  | "fallback";

export interface TrackingStatus {
  readonly state: TrackingState;
  /** Smoothed corners, or null when there is no usable pose. */
  readonly corners: [Point, Point, Point, Point] | null;
  /** Smoothed confidence, 0..1. */
  readonly confidence: number;
  /** True when the caller should render the fallback fretboard instead. */
  readonly usingFallback: boolean;
  readonly framesSinceDetection: number;
  readonly estimatedStringCount: number;
}

export interface NeckTrackerOptions {
  /** Confidence at which a detection is good enough to start trusting. */
  readonly acquireConfidence?: number;
  /** Confidence below which an existing lock starts to be doubted. */
  readonly dropConfidence?: number;
  /** Consecutive good detections needed before entering `tracking`. */
  readonly acquireFrames?: number;
  /** Consecutive bad frames tolerated before `tracking` becomes `degraded`. */
  readonly degradeFrames?: number;
  /** Further bad frames before `degraded` becomes `fallback`. */
  readonly fallbackFrames?: number;
  /** Minimum smoothing factor — how still a stationary overlay is. */
  readonly minAlpha?: number;
  /** Maximum smoothing factor — how quickly it follows real movement. */
  readonly maxAlpha?: number;
  /** A corner jumping further than this fraction of the frame is a mis-detection. */
  readonly maxJumpRatio?: number;
}

/**
 * Turns a noisy stream of per-frame neck detections into a stable overlay pose.
 *
 * Three jobs, none of which the detector should be doing:
 *
 *  - **Smoothing.** Rendering raw detection coordinates produces an overlay that
 *    visibly shivers even on a motionless instrument, because each frame's edge
 *    pixels land slightly differently. The filter below is speed-adaptive: it
 *    smooths hard when the neck is still and loosens as it moves, so the overlay
 *    is steady at rest without lagging behind a real shift.
 *
 *  - **Hysteresis.** Separate thresholds for acquiring a lock and for losing one,
 *    plus frame counts on every transition. A single threshold with no counting
 *    gives the detected/lost/detected/lost flicker that makes an AR overlay
 *    unusable.
 *
 *  - **Outlier rejection.** A detection whose corners jumped implausibly far in
 *    one frame is far more likely to be a door frame than the neck teleporting,
 *    so it is discarded rather than smoothed into the pose.
 */
export class NeckTracker {
  private state: TrackingState = "searching";
  private smoothed: [Point, Point, Point, Point] | null = null;
  private velocity: number[] = [0, 0, 0, 0];
  private confidence = 0;
  private goodFrames = 0;
  private badFrames = 0;
  private framesSinceDetection = Number.MAX_SAFE_INTEGER;
  private stringCount = 0;
  private lastTime = 0;

  private readonly acquireConfidence: number;
  private readonly dropConfidence: number;
  private readonly acquireFrames: number;
  private readonly degradeFrames: number;
  private readonly fallbackFrames: number;
  private readonly minAlpha: number;
  private readonly maxAlpha: number;
  private readonly maxJumpRatio: number;

  constructor(
    private readonly frameWidth: number,
    private readonly frameHeight: number,
    options: NeckTrackerOptions = {},
  ) {
    this.acquireConfidence = options.acquireConfidence ?? 0.55;
    this.dropConfidence = options.dropConfidence ?? 0.32;
    this.acquireFrames = options.acquireFrames ?? 4;
    this.degradeFrames = options.degradeFrames ?? 5;
    this.fallbackFrames = options.fallbackFrames ?? 20;
    this.minAlpha = options.minAlpha ?? 0.12;
    this.maxAlpha = options.maxAlpha ?? 0.55;
    this.maxJumpRatio = options.maxJumpRatio ?? 0.35;
  }

  update(detection: NeckDetection | null, timeMs = 0): TrackingStatus {
    this.lastTime = timeMs;
    const good = detection !== null && detection.confidence >= this.currentAcceptThreshold();

    if (good && detection && this.isPlausible(detection.corners)) {
      this.framesSinceDetection = 0;
      this.goodFrames++;
      this.badFrames = 0;
      this.stringCount = detection.estimatedStringCount;
      this.absorb(detection);
    } else {
      this.framesSinceDetection++;
      this.badFrames++;
      this.goodFrames = 0;
      // Let confidence decay rather than dropping to zero, so one missed frame
      // does not look like a total loss.
      this.confidence *= 0.9;
    }

    this.advanceState();
    return this.status();
  }

  /**
   * Once locked, a lower bar is enough to stay locked. This asymmetry is what
   * stops the overlay dropping out every time the player's hand briefly covers
   * part of the neck.
   */
  private currentAcceptThreshold(): number {
    return this.state === "tracking" || this.state === "degraded"
      ? this.dropConfidence
      : this.acquireConfidence;
  }

  private isPlausible(corners: readonly Point[]): boolean {
    if (!this.smoothed) return true;
    // Outlier rejection exists to defend an established lock. Applying it while
    // still searching would be self-defeating: a seeded or stale pose sitting
    // far from where the neck actually is would reject every real detection and
    // the tracker could never acquire at all.
    if (this.state !== "tracking" && this.state !== "degraded") return true;

    const limit = Math.max(this.frameWidth, this.frameHeight) * this.maxJumpRatio;
    for (let i = 0; i < 4; i++) {
      const previous = this.smoothed[i]!;
      const next = corners[i]!;
      if (Math.hypot(next.x - previous.x, next.y - previous.y) > limit) return false;
    }
    return true;
  }

  private absorb(detection: NeckDetection): void {
    this.confidence = this.confidence * 0.65 + detection.confidence * 0.35;

    if (!this.smoothed) {
      this.smoothed = [...detection.corners] as [Point, Point, Point, Point];
      this.velocity = [0, 0, 0, 0];
      return;
    }

    const diagonal = Math.hypot(this.frameWidth, this.frameHeight);
    const next: Point[] = [];
    for (let i = 0; i < 4; i++) {
      const previous = this.smoothed[i]!;
      const target = detection.corners[i]!;
      const distance = Math.hypot(target.x - previous.x, target.y - previous.y);

      // Speed-adaptive smoothing: hold still when still, follow when moving.
      const speed = this.velocity[i]! * 0.6 + (distance / diagonal) * 0.4;
      this.velocity[i] = speed;
      const alpha = this.minAlpha + (this.maxAlpha - this.minAlpha) * Math.min(1, speed * 14);

      next.push({
        x: previous.x + (target.x - previous.x) * alpha,
        y: previous.y + (target.y - previous.y) * alpha,
      });
    }
    this.smoothed = next as [Point, Point, Point, Point];
  }

  private advanceState(): void {
    switch (this.state) {
      case "searching":
        if (this.goodFrames >= this.acquireFrames) this.state = "tracking";
        else if (this.goodFrames > 0) this.state = "acquiring";
        break;

      case "acquiring":
        if (this.goodFrames >= this.acquireFrames) this.state = "tracking";
        else if (this.badFrames >= this.degradeFrames) {
          this.state = "searching";
          this.goodFrames = 0;
        }
        break;

      case "tracking":
        if (this.badFrames >= this.degradeFrames) this.state = "degraded";
        break;

      case "degraded":
        // Recovering from a brief occlusion should be immediate — the pose is
        // still on screen and still correct.
        if (this.goodFrames >= 2) this.state = "tracking";
        else if (this.badFrames >= this.fallbackFrames) {
          this.state = "fallback";
          this.smoothed = null;
        }
        break;

      case "fallback":
        // Coming back from fallback swaps the whole UI, so it demands the full
        // acquisition evidence rather than a couple of lucky frames.
        if (this.goodFrames >= this.acquireFrames) this.state = "tracking";
        break;
    }
  }

  private status(): TrackingStatus {
    const usingFallback = this.state === "fallback" || this.state === "searching";
    return {
      state: this.state,
      corners: usingFallback ? null : this.smoothed,
      confidence: Math.max(0, Math.min(1, this.confidence)),
      usingFallback,
      framesSinceDetection: this.framesSinceDetection,
      estimatedStringCount: this.stringCount,
    };
  }

  /**
   * How often detection should run right now, in milliseconds.
   *
   * A confident, settled lock does not need re-detecting 30 times a second —
   * the smoothed pose is already correct and the CPU is better spent elsewhere.
   * When the lock is shaky or lost, detection speeds up to reacquire.
   */
  detectionIntervalMs(): number {
    switch (this.state) {
      case "tracking":
        return this.confidence > 0.7 ? 220 : 120;
      case "degraded":
        return 80;
      case "acquiring":
        return 90;
      default:
        return 140;
    }
  }

  /** Seed from a manual calibration so a user-aligned overlay is not discarded. */
  seed(corners: [Point, Point, Point, Point]): void {
    this.smoothed = [...corners] as [Point, Point, Point, Point];
    this.velocity = [0, 0, 0, 0];
  }

  get currentState(): TrackingState {
    return this.state;
  }

  get lastUpdateTime(): number {
    return this.lastTime;
  }

  reset(): void {
    this.state = "searching";
    this.smoothed = null;
    this.velocity = [0, 0, 0, 0];
    this.confidence = 0;
    this.goodFrames = 0;
    this.badFrames = 0;
    this.framesSinceDetection = Number.MAX_SAFE_INTEGER;
    this.stringCount = 0;
  }
}
