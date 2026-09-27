import type { EdgePoint } from "./edges";

/** A line in normal form: x cos(theta) + y sin(theta) = rho. */
export interface DetectedLine {
  readonly rho: number;
  /** Radians, 0..PI. */
  readonly theta: number;
  /** Accumulator votes — how much edge evidence supports this line. */
  readonly votes: number;
}

export interface HoughOptions {
  readonly thetaBins?: number;
  readonly rhoResolution?: number;
  /** Minimum votes, as a fraction of the best line's votes. */
  readonly relativeThreshold?: number;
  readonly maxLines?: number;
  /** Suppress lines closer than this (in rho) and this (in theta) to a stronger one. */
  readonly rhoSuppression?: number;
  readonly thetaSuppression?: number;
}

/**
 * Standard Hough transform for lines.
 *
 * A guitar neck is an unusually good target for this: the fretboard edges, the
 * strings and the fret wires are all long straight lines, and they fall into two
 * near-perpendicular orientation families. That structure is what makes a neck
 * distinguishable from an arbitrary bright rectangle in the frame.
 */
export function houghLines(
  points: readonly EdgePoint[],
  width: number,
  height: number,
  options: HoughOptions = {},
): DetectedLine[] {
  const thetaBins = options.thetaBins ?? 180;
  const rhoResolution = options.rhoResolution ?? 2;
  const relativeThreshold = options.relativeThreshold ?? 0.35;
  const maxLines = options.maxLines ?? 24;
  const rhoSuppression = options.rhoSuppression ?? 8;
  const thetaSuppression = options.thetaSuppression ?? Math.PI / 18;

  if (points.length === 0) return [];

  const diagonal = Math.hypot(width, height);
  const rhoBins = Math.ceil((2 * diagonal) / rhoResolution) + 1;
  const accumulator = new Float32Array(thetaBins * rhoBins);

  const cosTable = new Float32Array(thetaBins);
  const sinTable = new Float32Array(thetaBins);
  for (let t = 0; t < thetaBins; t++) {
    const theta = (t * Math.PI) / thetaBins;
    cosTable[t] = Math.cos(theta);
    sinTable[t] = Math.sin(theta);
  }

  for (const point of points) {
    // Weight by gradient strength: a crisp fretboard edge should count for more
    // than a faint texture boundary.
    const weight = point.magnitude;
    for (let t = 0; t < thetaBins; t++) {
      const rho = point.x * cosTable[t]! + point.y * sinTable[t]!;
      const rhoIndex = Math.round((rho + diagonal) / rhoResolution);
      if (rhoIndex < 0 || rhoIndex >= rhoBins) continue;
      accumulator[t * rhoBins + rhoIndex]! += weight;
    }
  }

  // Collect peaks, strongest first, with non-maximum suppression so one physical
  // line does not return as a cluster of near-identical detections.
  const candidates: DetectedLine[] = [];
  for (let t = 0; t < thetaBins; t++) {
    for (let r = 0; r < rhoBins; r++) {
      const votes = accumulator[t * rhoBins + r]!;
      if (votes <= 0) continue;
      candidates.push({
        theta: (t * Math.PI) / thetaBins,
        rho: r * rhoResolution - diagonal,
        votes,
      });
    }
  }
  candidates.sort((a, b) => b.votes - a.votes);

  const best = candidates[0];
  if (!best) return [];
  const minVotes = best.votes * relativeThreshold;

  const accepted: DetectedLine[] = [];
  for (const candidate of candidates) {
    if (candidate.votes < minVotes) break;
    if (accepted.length >= maxLines) break;

    const duplicate = accepted.some((line) => {
      const dTheta = angularDistance(line.theta, candidate.theta);
      if (dTheta > thetaSuppression) return false;
      // Compare rho in a consistent orientation: theta near 0 and near PI
      // describe the same family with opposite-signed rho.
      const flipped = Math.abs(line.theta - candidate.theta) > Math.PI / 2;
      const rho = flipped ? -candidate.rho : candidate.rho;
      return Math.abs(line.rho - rho) < rhoSuppression;
    });
    if (!duplicate) accepted.push(candidate);
  }

  return accepted;
}

/** Smallest angle between two orientations, treating theta and theta+PI as equal. */
export function angularDistance(a: number, b: number): number {
  let difference = Math.abs(a - b) % Math.PI;
  if (difference > Math.PI / 2) difference = Math.PI - difference;
  return difference;
}

/** Intersection of two lines in normal form, or null when they are parallel. */
export function lineIntersection(a: DetectedLine, b: DetectedLine): { x: number; y: number } | null {
  const cosA = Math.cos(a.theta);
  const sinA = Math.sin(a.theta);
  const cosB = Math.cos(b.theta);
  const sinB = Math.sin(b.theta);

  const determinant = cosA * sinB - sinA * cosB;
  if (Math.abs(determinant) < 1e-9) return null;

  return {
    x: (a.rho * sinB - b.rho * sinA) / determinant,
    y: (b.rho * cosA - a.rho * cosB) / determinant,
  };
}

/** Signed distance from a point to a line. */
export function pointLineDistance(line: DetectedLine, x: number, y: number): number {
  return x * Math.cos(line.theta) + y * Math.sin(line.theta) - line.rho;
}

/**
 * Group lines into orientation families.
 * A fretboard yields one dense family along the neck (edges plus strings) and a
 * sparser perpendicular family (the fret wires).
 */
export function groupByOrientation(
  lines: readonly DetectedLine[],
  tolerance = Math.PI / 12,
): DetectedLine[][] {
  const groups: DetectedLine[][] = [];
  for (const line of lines) {
    const group = groups.find(
      (existing) => angularDistance(existing[0]!.theta, line.theta) <= tolerance,
    );
    if (group) group.push(line);
    else groups.push([line]);
  }
  return groups;
}
