import { extractEdges, sobel } from "./edges";
import {
  type DetectedLine,
  angularDistance,
  groupByOrientation,
  houghLines,
  lineIntersection,
  pointLineDistance,
} from "./hough";
import type { Point } from "./homography";

export interface NeckDetection {
  /** Corners in image pixels: nut-low, far-low, far-high, nut-high. */
  readonly corners: [Point, Point, Point, Point];
  /** 0..1 — how much the evidence looks like a fretboard rather than any long object. */
  readonly confidence: number;
  /** Strings counted inside the band, which is what distinguishes bass from guitar. */
  readonly estimatedStringCount: number;
  /** Fret wires found crossing the band — strong evidence it is a fretboard. */
  readonly fretLineCount: number;
  /** Neck orientation in radians. */
  readonly angle: number;
  /** Band width in pixels. */
  readonly width: number;
}

export interface NeckDetectorOptions {
  /** Narrowest plausible neck, as a fraction of the frame's smaller dimension. */
  readonly minWidthRatio?: number;
  readonly maxWidthRatio?: number;
  /** Minimum neck length as a fraction of the frame's larger dimension. */
  readonly minLengthRatio?: number;
  readonly edgeThreshold?: number;
  /**
   * Optional per-pixel warmth, 128 + (R - B), clamped to a byte.
   *
   * Greyscale alone cannot tell a dark fretboard from dark blinds, a dark shirt
   * or a switched-off television — all of which produced confident false
   * detections on real photographs. Wood is warm: measured on those same photos,
   * a fretboard sits around R-B = 10..19 while blinds, clothing and furniture
   * sit at 1..5. One subtraction per pixel buys a discriminator that the
   * geometry cannot provide.
   */
  readonly warmth?: Uint8ClampedArray;
  /**
   * Optional map of where the picture has recently been moving.
   *
   * The decisive cue when the static ones fail. Blinds, shelves and furniture
   * produce convincing dark banded shapes and hold perfectly still; a guitar
   * being played does not. Supply this once a few seconds of video have gone by
   * and the room stops competing with the instrument.
   */
  readonly motion?: Uint8ClampedArray;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Finds a guitar or bass neck in a greyscale frame.
 *
 * The shape being looked for is specific enough to be found geometrically, with
 * no trained model and nothing to download: a fretboard is a long band bounded
 * by two near-parallel straight edges, filled with more lines parallel to those
 * edges (the strings) and crossed by a series of lines roughly perpendicular to
 * them (the fret wires).
 *
 * That combination is what separates a neck from a table edge, a door frame or a
 * mic stand — each of which supplies long parallel lines but none of which
 * supplies the perpendicular ladder of frets. Confidence is built from how much
 * of that structure is actually present, so the caller can tell a solid lock
 * from a guess and fall back rather than draw an overlay in the wrong place.
 *
 * Runs on a downscaled frame (160x120 is plenty). Pure function: no canvas, no
 * DOM, unit-testable against synthetic images.
 */
export function detectNeck(
  grey: Uint8ClampedArray,
  width: number,
  height: number,
  options: NeckDetectorOptions = {},
): NeckDetection | null {
  const minWidthRatio = options.minWidthRatio ?? 0.05;
  // A neck seen through a webcam is a narrow band. Allowing it to be over half
  // the frame let a band spanning the player's torso and the television behind
  // them qualify, and it scored well because that region really is darker than
  // the wall above it.
  const maxWidthRatio = options.maxWidthRatio ?? 0.32;
  const minLengthRatio = options.minLengthRatio ?? 0.35;

  const gradients = sobel(grey, width, height);
  const points = extractEdges(gradients, width, height, options.edgeThreshold ?? 0.32);
  // A fretboard fills a good part of the frame with structure — strings and fret
  // wires put thousands of edge pixels on screen. A scene with only a few
  // hundred has a couple of lines in it, not an instrument, and every *relative*
  // measure below would be trivially satisfied by them.
  if (points.length < 700) return null;

  // A low vote threshold on purpose. Fret wires only span the width of the neck,
  // so they collect a small fraction of the votes a full-length string line does;
  // at the default threshold they are culled and the strongest evidence that this
  // is a *fretboard* rather than any striped object disappears with them.
  const lines = houghLines(points, width, height, {
    maxLines: 44,
    relativeThreshold: 0.12,
  });
  if (lines.length < 2) return null;

  /*
   * Which orientation is the neck?
   *
   * Picking the family with the most votes seemed obvious and is wrong in a real
   * room: an air-conditioner, a shelf and a door frame are all horizontal and
   * together outvote a guitar held at an angle. So instead every plausible
   * orientation is tried, a band is fitted within each, and the one that looks
   * most like a fretboard wins. Costs a few band searches and removes a whole
   * class of failure.
   */
  const groups = groupByOrientation(lines, Math.PI / 14)
    .filter((group) => group.length >= 4)
    .map((group) => ({ group, weight: group.reduce((sum, line) => sum + line.votes, 0) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
  if (groups.length === 0) return null;

  const smallerDimension = Math.min(width, height);
  let chosen: {
    axisGroup: DetectedLine[];
    axisTheta: number;
    band: NeckBand;
    normalised: DetectedLine[];
    crossing: DetectedLine[];
  } | null = null;

  for (const { group } of groups) {
    const theta = averageTheta(group);
    const normalisedGroup = group.map((line) => normaliseTo(line, theta));
    normalisedGroup.sort((a, b) => a.rho - b.rho);

    const perpendicularLines = lines.filter(
      (line) => Math.abs(angularDistance(line.theta, theta) - Math.PI / 2) < Math.PI / 9,
    );

    const candidate = findNeckBand(normalisedGroup, perpendicularLines, {
      minWidth: smallerDimension * minWidthRatio,
      maxWidth: smallerDimension * maxWidthRatio,
      width,
      height,
      profile: buildIntensityProfile(grey, width, height, theta),
      warmthProfile: options.warmth
        ? buildIntensityProfile(options.warmth, width, height, theta)
        : null,
      motionProfile: options.motion
        ? buildIntensityProfile(options.motion, width, height, theta)
        : null,
    });
    if (!candidate) continue;

    if (!chosen || candidate.score > chosen.band.score) {
      chosen = {
        axisGroup: group,
        axisTheta: theta,
        band: candidate,
        normalised: normalisedGroup,
        crossing: perpendicularLines,
      };
    }
  }

  if (!chosen) return null;

  const axisGroup = chosen.axisGroup;
  const axisTheta = chosen.axisTheta;

  const normalised = chosen.normalised;
  const lowSide = chosen.band.low;
  const highSide = chosen.band.high;
  const bandWidth = chosen.band.width;

  // Strings: lines of the same family strictly between the two boundaries.
  const interior = normalised.filter(
    (line) => line.rho > lowSide.rho + bandWidth * 0.08 && line.rho < highSide.rho - bandWidth * 0.08,
  );

  // Fret wires: lines roughly perpendicular to the axis whose crossing point
  // lies inside the band.
  const perpendicular = chosen.crossing;
  // A genuine fret wire crosses the whole band, so it must intersect both
  // boundary lines at points that are actually on screen. A stray perpendicular
  // edge elsewhere in the room will not.
  const margin = Math.max(width, height) * 0.15;
  const onScreen = (point: Point | null) =>
    point !== null &&
    point.x >= -margin &&
    point.x <= width + margin &&
    point.y >= -margin &&
    point.y <= height + margin;

  const fretLines = perpendicular.filter(
    (line) => onScreen(lineIntersection(line, lowSide)) && onScreen(lineIntersection(line, highSide)),
  );

  // Extent along the neck: project the supporting edge points onto the axis and
  // take the span that actually carries evidence, rather than running the
  // overlay off to the edge of the frame.
  const axisX = Math.cos(axisTheta + Math.PI / 2);
  const axisY = Math.sin(axisTheta + Math.PI / 2);
  const projections: number[] = [];

  // A tolerance around the band, not strictly inside it.
  //
  // The neck's strongest edge pixels lie *on* its boundaries, so a strict
  // between-the-lines test threw away exactly the evidence that defines the
  // neck's extent. On a narrow band that left too few points to measure with and
  // the detection was discarded — which is why a perfectly horizontal neck, the
  // most natural way to hold a guitar to a webcam, failed while a tilted one
  // worked.
  const tolerance = Math.max(2, bandWidth * 0.2);
  for (const point of points) {
    const distanceLow = pointLineDistance(lowSide, point.x, point.y);
    const distanceHigh = pointLineDistance(highSide, point.x, point.y);
    const inside = distanceLow * distanceHigh <= 0;
    const nearEdge = Math.abs(distanceLow) <= tolerance || Math.abs(distanceHigh) <= tolerance;
    if (!inside && !nearEdge) continue;
    projections.push(point.x * axisX + point.y * axisY);
  }

  const inBand = projections.length;
  if (inBand < 30) return null;

  // Percentiles rather than min/max. Anything crossing the band — a cable, a
  // door frame, the player's arm — contributes a handful of points far along the
  // axis, and taking the extremes would stretch the neck out to meet them. The
  // overlay then runs off the end of the instrument, which is exactly the kind
  // of confidently-wrong result the fallback exists to avoid.
  projections.sort((a, b) => a - b);
  const at = (fraction: number) =>
    projections[Math.min(projections.length - 1, Math.max(0, Math.round(fraction * (projections.length - 1))))]!;
  const minProjection = at(0.02);
  const maxProjection = at(0.98);

  if (!Number.isFinite(minProjection) || !Number.isFinite(maxProjection)) return null;
  const length = maxProjection - minProjection;
  if (length < Math.max(width, height) * minLengthRatio) return null;

  const corners = buildCorners(lowSide, highSide, axisX, axisY, minProjection, maxProjection);
  if (!corners) return null;

  // --- Confidence ---
  // Each term is evidence a real fretboard is present; none is sufficient alone.
  //
  // These are deliberately *absolute* rather than proportional. An earlier
  // version scored everything relative to whatever was in the frame, which meant
  // a nearly empty scene containing two crossing lines scored 0.74 — as
  // confidently as a real neck — because those two lines were 100% of the
  // evidence available. Measuring against fixed expectations instead means a
  // sparse scene simply has too little of everything.
  const stringScore = clamp01(interior.length / 6);
  const fretScore = clamp01(fretLines.length / 4);

  // Parallelism only counts once there are enough lines for it to mean anything:
  // any two lines are trivially "parallel" to within some tolerance.
  const tightness = clamp01(1 - spreadOfTheta(axisGroup) / (Math.PI / 14));
  const parallelScore = tightness * clamp01((axisGroup.length - 2) / 6);

  const lengthScore = clamp01(length / Math.max(width, height));
  const densityScore = clamp01(inBand / 700);

  // Fret wires are the decisive evidence. Long parallel lines are everywhere in
  // a room — a table edge, a door frame, a blind — and several of them can line
  // up well enough to score respectably on every other term. What none of them
  // has is a ladder of short lines running across the band. Seeing none at all
  // caps confidence below any threshold the tracker will acquire on.
  const fretEvidence = fretLines.length === 0 ? 0.35 : 1;

  const confidence = clamp01(
    (stringScore * 0.26 +
      fretScore * 0.30 +
      parallelScore * 0.16 +
      lengthScore * 0.16 +
      densityScore * 0.12) *
      fretEvidence,
  );

  return {
    corners,
    confidence,
    // Each physical string is a bright line on a dark board, so it presents two
    // gradient edges and Hough reports it roughly twice. Halving is a crude
    // correction and the count stays approximate — see classifyInstrument.
    estimatedStringCount: Math.max(0, Math.round(interior.length / 2)),
    fretLineCount: fretLines.length,
    angle: axisTheta,
    width: bandWidth,
  };
}

/**
 * Suggest which instrument is in view, from the number of strings detected.
 *
 * Treat this as a hint, not a decision. Counting strings from edges alone is
 * genuinely unreliable: adjacent strings merge at a distance or a shallow angle,
 * a hand covers several at once, and specular highlights split one string into
 * two lines. So this is deliberately conservative — it returns null unless the
 * detection is strong and the count lands cleanly in a band — and callers should
 * offer it as a prompt rather than silently switching the user's instrument.
 */
export function classifyInstrument(
  detection: NeckDetection,
): { instrumentId: string; confidence: number } | null {
  if (detection.confidence < 0.6) return null;
  if (detection.fretLineCount < 2) return null;

  const strings = detection.estimatedStringCount;
  if (strings === 4) return { instrumentId: "bass-4", confidence: 0.45 };
  if (strings === 5) return { instrumentId: "bass-5", confidence: 0.4 };
  if (strings === 6) return { instrumentId: "guitar-6", confidence: 0.45 };
  return null;
}

/**
 * Find the fretboard among the parallel lines in a frame.
 *
 * Two earlier attempts failed on real photographs, and both failures were
 * instructive:
 *
 *  - Taking the *outermost* parallel lines spanned the whole room. A photo of
 *    someone holding a guitar also contains a shelf, a television and an
 *    air-conditioner, all horizontal.
 *  - Taking the *densest cluster* of parallel lines picked the furniture, which
 *    in a normal room produces more detected lines than six guitar strings do.
 *
 * What is actually unique to a fretboard is not its lines but what crosses them:
 * a ladder of fret wires running perpendicular, spread along its whole length.
 * No shelf has that. So each candidate band is scored mainly on how many
 * perpendicular lines cross it and how evenly those crossings are distributed,
 * with parallel-line density only as support.
 */
interface NeckBand {
  readonly low: DetectedLine;
  readonly high: DetectedLine;
  readonly width: number;
  /** How fretboard-like this band is; compared across orientations. */
  readonly score: number;
}

function findNeckBand(
  sorted: readonly DetectedLine[],
  crossing: readonly DetectedLine[],
  options: {
    minWidth: number;
    maxWidth: number;
    width: number;
    height: number;
    profile: IntensityProfile;
    warmthProfile: IntensityProfile | null;
    motionProfile: IntensityProfile | null;
  },
): NeckBand | null {
  const { minWidth, maxWidth, width, height, profile, warmthProfile, motionProfile } = options;
  const margin = Math.max(width, height) * 0.1;
  const onScreen = (point: Point | null) =>
    point !== null &&
    point.x >= -margin &&
    point.x <= width + margin &&
    point.y >= -margin &&
    point.y <= height + margin;

  let best: { low: DetectedLine; high: DetectedLine; width: number; score: number } | null = null;

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const low = sorted[i]!;
      const high = sorted[j]!;
      const bandWidth = high.rho - low.rho;
      if (bandWidth < minWidth) continue;
      if (bandWidth > maxWidth) break;

      // Frets: perpendicular lines that cross the band with both ends on screen.
      const crossings: number[] = [];
      for (const line of crossing) {
        const a = lineIntersection(line, low);
        const b = lineIntersection(line, high);
        if (!onScreen(a) || !onScreen(b)) continue;
        crossings.push(Math.hypot(a!.x, a!.y));
      }
      // One or two crossings is a coincidence; a fretboard shows a series.
      if (crossings.length < 2) continue;

      // Spread: frets run the length of the neck rather than clustering at one
      // end, which is what an incidental pair of crossing edges looks like.
      crossings.sort((a, b) => a - b);
      const span = crossings[crossings.length - 1]! - crossings[0]!;
      const spread = Math.min(1, span / (Math.max(width, height) * 0.3));

      // The decisive test, and the only one nothing else in a room passes.
      //
      // Fret positions are not arbitrary: the distance from the nut to fret n is
      // L(1 - 2^(-n/12)), so the gaps shrink geometrically along the neck. Window
      // blinds, shelves and radiator fins all produce bands crossed by parallel
      // lines, but their spacing is even. Requiring the gaps to *narrow* is what
      // separates an instrument from the furniture around it.

      const interior = j - i - 1;
      const density = (interior + 2) / (1 + bandWidth / maxWidth);

      // A fretboard is dark wood, and it sits against a wall, a shirt or a room
      // that is usually lighter. Measured on real photographs the neck runs
      // about 40 grey levels below the strips immediately above and below it,
      // while a band across furniture shows no such step. This is the term that
      // finally separated the instrument from the television behind it.
      const inside = profile.mean(low.rho, high.rho);
      const outside = profile.surroundingMean(low.rho, high.rho, bandWidth);
      const darkness =
        inside === null || outside === null ? 0 : Math.max(0, Math.min(1, (outside - inside) / 35));

      // A band *lighter* than its surroundings is not a fretboard on any
      // instrument, so that much is a hard gate. Beyond that darkness is scored
      // rather than required: a hard threshold here rejected legitimately wide
      // necks whose many bright strings lift the band's mean.
      if (darkness <= 0) continue;

      // Wood is warmer than the room around it. Scored rather than gated,
      // because a maple fretboard under cool light is a legitimate instrument
      // and should still be found, just with less certainty.
      let warmth = 0;
      if (warmthProfile) {
        const insideWarmth = warmthProfile.mean(low.rho, high.rho);
        const outsideWarmth = warmthProfile.surroundingMean(low.rho, high.rho, bandWidth);
        if (insideWarmth !== null) {
          // Absolute warmth, plus credit for being warmer than the surroundings.
          const absolute = Math.max(0, Math.min(1, (insideWarmth - 128 - 4) / 14));
          const relative =
            outsideWarmth === null
              ? 0
              : Math.max(0, Math.min(1, (insideWarmth - outsideWarmth) / 10));
          warmth = absolute * 0.6 + relative * 0.4;
        }
      }

      // Movement: the instrument is handled and played, the room is not.
      let liveliness = 0;
      if (motionProfile) {
        const inside = motionProfile.mean(low.rho, high.rho);
        if (inside !== null) liveliness = Math.max(0, Math.min(1, inside / 60));
      }

      const score =
        crossings.length * 1.5 +
        spread * 3 +
        density +
        darkness * 6 +
        warmth * 9 +
        liveliness * 12;

      if (!best || score > best.score) {
        best = { low, high, width: bandWidth, score };
      }
    }
  }

  return best;
}

interface IntensityProfile {
  /** Mean grey level for pixels whose rho falls in [from, to], or null if empty. */
  mean(from: number, to: number): number | null;
  /** Mean of the strips just outside the band, same width as the band itself. */
  surroundingMean(from: number, to: number, bandWidth: number): number | null;
}

/**
 * Average brightness as a function of distance across the neck's normal.
 *
 * Built once per frame in O(pixels), then answers any band query in O(bins), so
 * scoring a thousand candidate bands costs almost nothing.
 */
function buildIntensityProfile(
  grey: Uint8ClampedArray,
  width: number,
  height: number,
  theta: number,
): IntensityProfile {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // rho ranges over [-diagonal, +diagonal]; one bin per pixel is plenty.
  const diagonal = Math.hypot(width, height);
  const offset = Math.ceil(diagonal);
  const bins = offset * 2 + 1;
  const sums = new Float64Array(bins);
  const counts = new Float64Array(bins);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bin = Math.round(x * cos + y * sin) + offset;
      if (bin < 0 || bin >= bins) continue;
      sums[bin]! += grey[y * width + x]!;
      counts[bin]! += 1;
    }
  }

  const rangeMean = (from: number, to: number): number | null => {
    const start = Math.max(0, Math.round(from) + offset);
    const end = Math.min(bins - 1, Math.round(to) + offset);
    if (end < start) return null;
    let sum = 0;
    let count = 0;
    for (let bin = start; bin <= end; bin++) {
      sum += sums[bin]!;
      count += counts[bin]!;
    }
    return count === 0 ? null : sum / count;
  };

  return {
    mean: rangeMean,
    surroundingMean(from, to, bandWidth) {
      const above = rangeMean(from - bandWidth, from - 1);
      const below = rangeMean(to + 1, to + bandWidth);
      if (above === null && below === null) return null;
      if (above === null) return below;
      if (below === null) return above;
      return (above + below) / 2;
    },
  };
}

function normaliseTo(line: DetectedLine, reference: number): DetectedLine {
  // A line detected near theta=0 and one near theta=PI are the same family with
  // opposite-signed rho; align them so rho ordering means "which side".
  if (Math.abs(line.theta - reference) > Math.PI / 2) {
    return { theta: line.theta - Math.PI, rho: -line.rho, votes: line.votes };
  }
  return line;
}

function averageTheta(lines: readonly DetectedLine[]): number {
  // Average on the unit circle at double angle, so orientations near 0 and PI
  // do not average to PI/2.
  let sumSin = 0;
  let sumCos = 0;
  for (const line of lines) {
    sumSin += Math.sin(2 * line.theta) * line.votes;
    sumCos += Math.cos(2 * line.theta) * line.votes;
  }
  const theta = Math.atan2(sumSin, sumCos) / 2;
  return theta < 0 ? theta + Math.PI : theta;
}

function spreadOfTheta(lines: readonly DetectedLine[]): number {
  const mean = averageTheta(lines);
  let worst = 0;
  for (const line of lines) worst = Math.max(worst, angularDistance(line.theta, mean));
  return worst;
}

function buildCorners(
  lowSide: DetectedLine,
  highSide: DetectedLine,
  axisX: number,
  axisY: number,
  minProjection: number,
  maxProjection: number,
): [Point, Point, Point, Point] | null {
  // A line perpendicular to the neck axis at a given projection along it.
  const capAt = (projection: number): DetectedLine => ({
    theta: Math.atan2(axisY, axisX),
    rho: projection,
    votes: 1,
  });

  const nutCap = capAt(minProjection);
  const farCap = capAt(maxProjection);

  const nutLow = lineIntersection(lowSide, nutCap);
  const farLow = lineIntersection(lowSide, farCap);
  const farHigh = lineIntersection(highSide, farCap);
  const nutHigh = lineIntersection(highSide, nutCap);

  if (!nutLow || !farLow || !farHigh || !nutHigh) return null;
  for (const point of [nutLow, farLow, farHigh, nutHigh]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  }
  return [nutLow, farLow, farHigh, nutHigh];
}
