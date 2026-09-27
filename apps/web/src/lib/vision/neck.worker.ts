/// <reference lib="webworker" />

import { type NeckDetection, detectNeck } from "@fretlight/core";

/**
 * Neck detection worker.
 *
 * Sobel plus a Hough transform over a few thousand edge points is perfectly
 * affordable, but not on the main thread at video rate — it would land in the
 * middle of the same frame budget that draws the overlay and the fretboard, and
 * show up as dropped frames rather than as CPU. Out here it competes with
 * nothing.
 *
 * Greyscale buffers arrive transferred rather than copied, so the cost per frame
 * is the detection itself and nothing else.
 */

export interface DetectRequest {
  readonly type: "detect";
  readonly grey: Uint8ClampedArray;
  /** Colour warmth, 128 + (R - B) — what separates wood from furniture. */
  readonly warmth?: Uint8ClampedArray;
  /** Where the picture has been moving — the cue that beats static furniture. */
  readonly motion?: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly timeMs: number;
  readonly requestId: number;
}

export interface DetectResponse {
  readonly type: "detection";
  readonly detection: NeckDetection | null;
  readonly timeMs: number;
  readonly requestId: number;
  /** Wall-clock cost of the detection, for the diagnostics panel. */
  readonly elapsedMs: number;
}

self.onmessage = (event: MessageEvent<DetectRequest>) => {
  const message = event.data;
  if (message.type !== "detect") return;

  const startedAt = performance.now();
  const detection = detectNeck(message.grey, message.width, message.height, {
    ...(message.warmth ? { warmth: message.warmth } : {}),
    ...(message.motion ? { motion: message.motion } : {}),
  });

  const response: DetectResponse = {
    type: "detection",
    detection,
    timeMs: message.timeMs,
    requestId: message.requestId,
    elapsedMs: performance.now() - startedAt,
  };
  self.postMessage(response);
};
