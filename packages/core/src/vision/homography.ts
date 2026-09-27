/**
 * Planar homography: the maths that lets a flat overlay sit convincingly on a
 * real fretboard seen at an angle.
 *
 * A guitar neck is (near enough) a plane, and any two views of a plane are
 * related by a 3x3 projective transform. Given where the four corners of the
 * neck appear in the camera image, this recovers that transform — after which
 * any point in "neck space" (fret position, string position) can be placed
 * exactly where it belongs in the image, including the perspective foreshortening
 * that makes the far end of the neck narrower.
 *
 * Pure maths with no camera dependency, so it is unit-testable and equally
 * usable from a React Native vision pipeline later.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Row-major 3x3 matrix. */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY_3: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Solve a dense linear system by Gaussian elimination with partial pivoting.
 * Returns null when the system is singular — which, for our purposes, means the
 * user has dragged the calibration corners into a degenerate shape.
 */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting: without it, a legitimate configuration with a small
    // leading coefficient loses most of its precision.
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const swap = a[col]!;
      a[col] = a[pivot]!;
      a[pivot] = swap;
    }

    const pivotValue = a[col]![col]!;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row]![col]! / pivotValue;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) {
        a[row]![k] = a[row]![k]! - factor * a[col]![k]!;
      }
    }
  }

  return Array.from({ length: n }, (_, i) => a[i]![n]! / a[i]![i]!);
}

/**
 * Build the homography mapping four source points onto four destination points.
 *
 * Corners must be given in the same order in both lists and must not be
 * collinear. Returns null for a degenerate configuration rather than producing
 * a matrix that renders as garbage.
 */
export function computeHomography(
  source: readonly [Point, Point, Point, Point],
  destination: readonly [Point, Point, Point, Point],
): Matrix3 | null {
  const rows: number[][] = [];
  const rhs: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = source[i]!;
    const { x: X, y: Y } = destination[i]!;
    rows.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    rhs.push(X);
    rows.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    rhs.push(Y);
  }

  const solution = solveLinearSystem(rows, rhs);
  if (!solution) return null;
  if (solution.some((value) => !Number.isFinite(value))) return null;

  return [
    solution[0]!, solution[1]!, solution[2]!,
    solution[3]!, solution[4]!, solution[5]!,
    solution[6]!, solution[7]!, 1,
  ];
}

/** Map a point through a homography. */
export function applyHomography(matrix: Matrix3, point: Point): Point {
  const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  // A near-zero w means the point projects to the horizon; clamping keeps a
  // wild calibration from producing NaN coordinates that poison the canvas.
  const safeW = Math.abs(w) < 1e-9 ? 1e-9 : w;
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / safeW,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / safeW,
  };
}

/**
 * Where fret `fret` sits along the neck, as a 0..1 fraction of the distance from
 * the nut to `lastFret`.
 *
 * Uses the real rule — the distance from the nut to fret n is
 * L(1 - 2^(-n/12)) — so the overlay's fret lines land on the instrument's actual
 * fret wires rather than drifting further out of register the higher you go.
 */
export function fretFraction(fret: number, lastFret: number): number {
  if (lastFret <= 0) return 0;
  const position = (n: number) => 1 - Math.pow(2, -n / 12);
  return position(fret) / position(lastFret);
}

/** Centre of a fret slot — where a finger goes, between two wires. */
export function fretSlotFraction(fret: number, lastFret: number): number {
  if (fret <= 0) return 0;
  return (fretFraction(fret - 1, lastFret) + fretFraction(fret, lastFret)) / 2;
}

/**
 * Projector from neck space onto the camera image.
 *
 * Neck space is (fret fraction 0..1, string fraction 0..1) with the nut at x=0
 * and the lowest-pitched string at y=0.
 */
export interface NeckProjection {
  readonly matrix: Matrix3;
  readonly lastFret: number;
  readonly stringCount: number;
}

export function createNeckProjection(
  corners: readonly [Point, Point, Point, Point],
  lastFret: number,
  stringCount: number,
): NeckProjection | null {
  // Source is the unit square: nut-low, lastFret-low, lastFret-high, nut-high.
  const unitSquare: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const matrix = computeHomography(unitSquare, corners);
  return matrix ? { matrix, lastFret, stringCount } : null;
}

/** Image position of a string/fret, ready to draw a marker at. */
export function projectPosition(
  projection: NeckProjection,
  stringIndex: number,
  fret: number,
): Point {
  const y = projection.stringCount <= 1 ? 0.5 : stringIndex / (projection.stringCount - 1);
  return applyHomography(projection.matrix, {
    x: fretSlotFraction(fret, projection.lastFret),
    y,
  });
}

/** The two endpoints of a fret wire, for drawing the grid. */
export function projectFretLine(projection: NeckProjection, fret: number): [Point, Point] {
  const x = fretFraction(fret, projection.lastFret);
  return [
    applyHomography(projection.matrix, { x, y: 0 }),
    applyHomography(projection.matrix, { x, y: 1 }),
  ];
}

/** The two endpoints of a string, for drawing the grid. */
export function projectStringLine(projection: NeckProjection, stringIndex: number): [Point, Point] {
  const y = projection.stringCount <= 1 ? 0.5 : stringIndex / (projection.stringCount - 1);
  return [
    applyHomography(projection.matrix, { x: 0, y }),
    applyHomography(projection.matrix, { x: 1, y }),
  ];
}
