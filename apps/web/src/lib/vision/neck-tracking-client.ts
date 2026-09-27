"use client";

import { NeckTracker, type NeckTrackerOptions, type TrackingStatus } from "@fretlight/core";
import type { DetectResponse } from "./neck.worker";

export interface NeckTrackingClientOptions extends NeckTrackerOptions {
  /** Resolution the detector runs at. Higher costs more and helps surprisingly little. */
  readonly detectWidth?: number;
  readonly detectHeight?: number;
}

/**
 * Drives neck detection and tracking for one camera view.
 *
 * Splits the two concerns the spec calls out:
 *
 *  - **Detection** runs in a worker, at an adaptive rate. A confident, settled
 *    lock is re-checked a few times a second; a lost one is hunted for harder.
 *    Running full detection on every displayed frame would burn battery to
 *    recompute a pose that has not changed.
 *
 *  - **Tracking** runs here, every frame, and is what the overlay actually
 *    follows: smoothing, hysteresis and outlier rejection, so the pose stays
 *    steady between detections and through brief losses.
 *
 * Only one detection is ever in flight; frames that arrive while the worker is
 * busy are dropped rather than queued, because a stale detection is worse than
 * no detection.
 */
export class NeckTrackingClient {
  private worker: Worker | null = null;
  private tracker: NeckTracker;
  private busy = false;
  private failed = false;
  private failure: string | null = null;
  private requestId = 0;
  private lastDetectAt = 0;
  private status: TrackingStatus;
  private lastCostMs = 0;

  readonly detectWidth: number;
  readonly detectHeight: number;

  constructor(
    private readonly frameWidth: number,
    private readonly frameHeight: number,
    private readonly options: NeckTrackingClientOptions = {},
  ) {
    this.detectWidth = options.detectWidth ?? 160;
    this.detectHeight = options.detectHeight ?? 120;
    this.tracker = new NeckTracker(this.detectWidth, this.detectHeight, options);
    this.status = this.tracker.update(null, 0);
  }

  start(): void {
    if (this.worker || this.failed) return;
    try {
      this.worker = new Worker(new URL("./neck.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      // Automatic tracking is an enhancement, not a prerequisite. If the worker
      // cannot be created the camera view, the motion analysis and the manual
      // overlay must all keep working — so record the failure and carry on.
      this.markFailed(error);
      return;
    }

    this.worker.onmessage = (event: MessageEvent<DetectResponse>) => {
      const { detection, timeMs, elapsedMs } = event.data;
      this.busy = false;
      this.lastCostMs = elapsedMs;
      this.status = this.tracker.update(detection, timeMs);
    };

    // A worker that fails to *load* reports asynchronously rather than throwing.
    this.worker.onerror = (event) => {
      this.markFailed(event instanceof ErrorEvent ? event.message : "worker error");
    };
    this.worker.onmessageerror = () => this.markFailed("worker message error");
  }

  private markFailed(error: unknown): void {
    this.failed = true;
    this.busy = false;
    this.failure =
      error instanceof Error ? error.message : typeof error === "string" ? error : "unavailable";
    try {
      this.worker?.terminate();
    } catch {
      // Already gone; nothing to clean up.
    }
    this.worker = null;
    // Report a definite "no tracking" so the UI shows the fallback fretboard
    // rather than sitting on a stale pose forever.
    this.tracker.reset();
    this.status = this.tracker.update(null, 0);
  }

  /** False when automatic tracking is unavailable and manual is the only option. */
  get isAvailable(): boolean {
    return !this.failed;
  }

  get failureReason(): string | null {
    return this.failure;
  }

  stop(): void {
    try {
      this.worker?.terminate();
    } catch {
      // Ignore — we are tearing down either way.
    }
    this.worker = null;
    this.busy = false;
    this.failed = false;
    this.failure = null;
    this.tracker.reset();
    this.status = this.tracker.update(null, 0);
  }

  /**
   * Offer a frame. Returns true when it was actually sent for detection —
   * most calls are declined, which is the point.
   */
  offer(
    grey: Uint8ClampedArray,
    timeMs: number,
    warmth?: Uint8ClampedArray,
    motion?: Uint8ClampedArray,
  ): boolean {
    if (this.failed || !this.worker || this.busy) return false;
    if (timeMs - this.lastDetectAt < this.tracker.detectionIntervalMs()) return false;

    this.lastDetectAt = timeMs;
    this.busy = true;
    // Copy before transferring: the caller's sampler reuses its buffer, and
    // transferring it out from under them would neuter it mid-loop.
    const copy = grey.slice();
    const warmCopy = warmth ? warmth.slice() : null;
    const motionCopy = motion ? motion.slice() : null;
    this.worker.postMessage(
      {
        type: "detect",
        grey: copy,
        ...(warmCopy ? { warmth: warmCopy } : {}),
        ...(motionCopy ? { motion: motionCopy } : {}),
        width: this.detectWidth,
        height: this.detectHeight,
        timeMs,
        requestId: ++this.requestId,
      },
      [copy.buffer, ...(warmCopy ? [warmCopy.buffer] : []), ...(motionCopy ? [motionCopy.buffer] : [])],
    );
    return true;
  }

  /**
   * The current pose, with corners scaled from detection resolution into the
   * display box the overlay is drawn in.
   */
  current(displayWidth: number, displayHeight: number): TrackingStatus {
    const status = this.status;
    if (!status.corners) return status;

    const scaleX = displayWidth / this.detectWidth;
    const scaleY = displayHeight / this.detectHeight;
    return {
      ...status,
      corners: status.corners.map((corner) => ({
        x: corner.x * scaleX,
        y: corner.y * scaleY,
      })) as TrackingStatus["corners"],
    };
  }

  /** Seed from a manual calibration, in display-box fractions. */
  seedFromFractions(corners: readonly { x: number; y: number }[]): void {
    if (corners.length !== 4) return;
    this.tracker.seed(
      corners.map((corner) => ({
        x: corner.x * this.detectWidth,
        y: corner.y * this.detectHeight,
      })) as Parameters<NeckTracker["seed"]>[0],
    );
  }

  get diagnostics(): {
    state: string;
    confidence: number;
    costMs: number;
    intervalMs: number;
    available: boolean;
    failure: string | null;
  } {
    return {
      available: !this.failed,
      failure: this.failure,
      state: this.status.state,
      confidence: this.status.confidence,
      costMs: this.lastCostMs,
      intervalMs: this.tracker.detectionIntervalMs(),
    };
  }

  get frameSize(): { width: number; height: number } {
    return { width: this.frameWidth, height: this.frameHeight };
  }

  get trackerOptions(): NeckTrackingClientOptions {
    return this.options;
  }
}
