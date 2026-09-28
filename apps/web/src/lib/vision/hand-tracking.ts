import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * Real hand-landmark tracking, layered on top of the frame-differencing
 * motion detector rather than replacing it (see `vision/motion.ts`'s own doc
 * comment, which names this as the intended next step).
 *
 * Self-hosted, not fetched from Google's model CDN at runtime: the app
 * already claims to be offline-capable, and a feature that silently needs a
 * third-party network call the first time a player opens the camera page
 * would quietly break that. The WASM runtime (`/mediapipe/wasm`) and the
 * model (`/mediapipe/models/hand_landmarker.task`, ~7.8 MB) are both served
 * from this app's own `public/`, and the service worker's normal
 * network-first-then-cache rule for same-origin assets picks them up the
 * first time they're actually fetched — no special-casing needed.
 *
 * A point, not a full skeleton, is what the rest of the pipeline wants: the
 * position estimator already has a slot for "roughly where the hand is"
 * (`PositionContext.handFret`), so what this exports is one press point per
 * detected hand, not the raw 21-landmark graph. Callers that want to draw the
 * skeleton can still do that from `handLandmarks`.
 */

export interface HandTrackResult {
  /** Wrist landmark, normalised 0..1 in the video's own (unmirrored) frame. */
  readonly wrist: { readonly x: number; readonly y: number };
  /**
   * Average of the index, middle and ring fingertips — a coarse stand-in for
   * "where the fretting fingers are" when we don't know which one is actually
   * on the string. Thumb and pinky are left out: they move more independently
   * and would only add noise to this average.
   */
  readonly pressPoint: { readonly x: number; readonly y: number };
  /** MediaPipe's own presence confidence for this hand, 0..1. */
  readonly confidence: number;
  /** All 21 landmarks, for anyone that wants to draw the skeleton. */
  readonly landmarks: readonly NormalizedLandmark[];
}

const FINGERTIPS = [8, 12, 16] as const; // index, middle, ring
const WRIST = 0;

export class HandTracker {
  private constructor(private readonly landmarker: HandLandmarker) {}

  static async create(numHands = 2): Promise<HandTracker> {
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "/mediapipe/models/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return new HandTracker(landmarker);
  }

  /**
   * Detect hands in the current video frame. `timestampMs` must strictly
   * increase between calls — the caller's own frame clock (e.g. the
   * `requestAnimationFrame` timestamp already driving the render loop) is
   * the right thing to pass, not `Date.now()` sampled twice a frame apart.
   */
  detect(video: HTMLVideoElement, timestampMs: number): HandTrackResult[] {
    if (video.readyState < 2) return [];
    const result = this.landmarker.detectForVideo(video, Math.round(timestampMs));
    const out: HandTrackResult[] = [];

    for (let i = 0; i < result.landmarks.length; i++) {
      const landmarks = result.landmarks[i]!;
      const wrist = landmarks[WRIST];
      if (!wrist) continue;

      let sumX = 0;
      let sumY = 0;
      let sumVisibility = 0;
      for (const index of FINGERTIPS) {
        const point = landmarks[index];
        if (!point) continue;
        sumX += point.x;
        sumY += point.y;
        sumVisibility += point.visibility ?? 1;
      }

      out.push({
        wrist: { x: wrist.x, y: wrist.y },
        pressPoint: { x: sumX / FINGERTIPS.length, y: sumY / FINGERTIPS.length },
        confidence: sumVisibility / FINGERTIPS.length,
        landmarks,
      });
    }
    return out;
  }

  close(): void {
    this.landmarker.close();
  }
}

/**
 * Loads the tracker in the background and hands it back through a promise
 * that never rejects — a slow network, a browser without WebGPU/WebGL2, or a
 * device that just can't run the model is the same outcome for the caller as
 * "no hand tracking available this session": fall back to motion detection,
 * silently, and do not block the rest of the camera page on it.
 */
export function createHandTracker(numHands = 2): Promise<HandTracker | null> {
  return HandTracker.create(numHands).catch((error) => {
    console.warn("Hand tracking unavailable, falling back to motion detection:", error);
    return null;
  });
}
