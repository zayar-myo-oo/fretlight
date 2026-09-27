/**
 * Sobel gradient and edge extraction.
 *
 * Operates on a caller-supplied greyscale buffer so the browser-specific work of
 * getting pixels out of a video element stays in the app layer and this stays a
 * pure, testable function.
 */

export interface EdgePoint {
  readonly x: number;
  readonly y: number;
  readonly magnitude: number;
  /** Gradient direction in radians, -PI..PI. */
  readonly angle: number;
}

export interface SobelResult {
  readonly magnitude: Float32Array;
  readonly angle: Float32Array;
  readonly maxMagnitude: number;
}

/** 3x3 Sobel over a `width` x `height` greyscale image. */
export function sobel(grey: Uint8ClampedArray, width: number, height: number): SobelResult {
  const magnitude = new Float32Array(width * height);
  const angle = new Float32Array(width * height);
  let maxMagnitude = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;

      const tl = grey[i - width - 1]!;
      const tc = grey[i - width]!;
      const tr = grey[i - width + 1]!;
      const ml = grey[i - 1]!;
      const mr = grey[i + 1]!;
      const bl = grey[i + width - 1]!;
      const bc = grey[i + width]!;
      const br = grey[i + width + 1]!;

      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);

      const value = Math.hypot(gx, gy);
      magnitude[i] = value;
      angle[i] = Math.atan2(gy, gx);
      if (value > maxMagnitude) maxMagnitude = value;
    }
  }

  return { magnitude, angle, maxMagnitude };
}

/**
 * Pick out the strongest edge pixels.
 *
 * `relativeThreshold` is a fraction of the frame's own strongest gradient rather
 * than an absolute level, so detection adapts to a dim room or a bright stage
 * without a manual sensitivity control.
 */
export function extractEdges(
  result: SobelResult,
  width: number,
  height: number,
  relativeThreshold = 0.35,
  maxPoints = 4000,
): EdgePoint[] {
  const threshold = result.maxMagnitude * relativeThreshold;
  if (threshold <= 0) return [];

  const points: EdgePoint[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const magnitude = result.magnitude[i]!;
      if (magnitude >= threshold) {
        points.push({ x, y, magnitude, angle: result.angle[i]! });
      }
    }
  }

  // Cap the count so a high-contrast, cluttered scene cannot blow up the Hough
  // pass. Sampling evenly keeps the spatial distribution intact.
  if (points.length <= maxPoints) return points;
  const stride = points.length / maxPoints;
  const sampled: EdgePoint[] = [];
  for (let i = 0; i < maxPoints; i++) sampled.push(points[Math.floor(i * stride)]!);
  return sampled;
}
