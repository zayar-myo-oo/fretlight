"use client";

import type { Point } from "@fretlight/core";

export type CalibrationCorners = [Point, Point, Point, Point];

export interface StoredCalibration {
  /** Corners as fractions of the video box, so they survive a resize or rotation. */
  readonly corners: CalibrationCorners;
  /** Which fret the far edge was aligned to. */
  readonly lastFret: number;
  /** Low-pitched string on the top edge of the quad. */
  readonly lowStringOnTop: boolean;
}

const STORAGE_PREFIX = "fretlight.calibration.";

/**
 * Default corner placement: a shallow trapezoid across the middle of the frame,
 * near enough to a typical seated view that dragging it into place is a nudge
 * rather than a puzzle.
 */
export function defaultCalibration(lastFret = 12): StoredCalibration {
  return {
    corners: [
      { x: 0.12, y: 0.46 },
      { x: 0.86, y: 0.38 },
      { x: 0.86, y: 0.56 },
      { x: 0.12, y: 0.68 },
    ],
    lastFret,
    lowStringOnTop: true,
  };
}

export function loadCalibration(instrumentId: string): StoredCalibration | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + instrumentId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCalibration;
    // Guard against a hand-edited or half-written value rather than letting a
    // malformed corner list turn into NaN coordinates on the canvas.
    if (!Array.isArray(parsed.corners) || parsed.corners.length !== 4) return null;
    if (parsed.corners.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCalibration(instrumentId: string, calibration: StoredCalibration): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + instrumentId, JSON.stringify(calibration));
  } catch {
    // Private browsing and blocked storage are not errors worth interrupting for.
  }
}
