import { describe, expect, it } from "vitest";
import { classifyInstrument, detectNeck } from "./neck-detector";
import { NeckTracker } from "./tracking";
import { renderEmptyScene, renderSyntheticNeck } from "./test-images";
import { angularDistance, groupByOrientation, houghLines, lineIntersection } from "./hough";
import { extractEdges, sobel } from "./edges";

const W = 160;
const H = 120;

describe("Sobel and Hough", () => {
  it("finds edges on a rendered neck", () => {
    const image = renderSyntheticNeck({ width: W, height: H });
    const gradients = sobel(image, W, H);
    const points = extractEdges(gradients, W, H);
    expect(points.length).toBeGreaterThan(100);
  });

  it("recovers the dominant orientation of the neck", () => {
    const angle = 0.2;
    const image = renderSyntheticNeck({ width: W, height: H, angle });
    const points = extractEdges(sobel(image, W, H), W, H);
    const lines = houghLines(points, W, H);
    expect(lines.length).toBeGreaterThan(1);

    // Lines along the neck have theta perpendicular to the neck's own angle.
    const expectedTheta = angle + Math.PI / 2;
    const groups = groupByOrientation(lines);
    const dominant = groups.sort((a, b) => b.length - a.length)[0]!;
    expect(angularDistance(dominant[0]!.theta, expectedTheta)).toBeLessThan(0.25);
  });

  it("suppresses duplicate detections of one physical line", () => {
    const image = renderSyntheticNeck({ width: W, height: H, strings: 4, frets: 5 });
    const points = extractEdges(sobel(image, W, H), W, H);
    const lines = houghLines(points, W, H, { maxLines: 40 });
    // Far fewer than the accumulator peaks: one line per physical edge.
    expect(lines.length).toBeLessThan(40);
  });

  it("returns null for parallel lines rather than a bogus intersection", () => {
    expect(lineIntersection({ rho: 10, theta: 0.5, votes: 1 }, { rho: 40, theta: 0.5, votes: 1 })).toBeNull();
  });
});

describe("detectNeck", () => {
  it("finds a clearly presented fretboard with good confidence", () => {
    const image = renderSyntheticNeck({ width: W, height: H, strings: 4, frets: 7 });
    const detection = detectNeck(image, W, H);
    expect(detection).not.toBeNull();
    expect(detection!.confidence).toBeGreaterThan(0.5);
    expect(detection!.fretLineCount).toBeGreaterThan(0);
  });

  it("recovers the neck angle", () => {
    // Known degeneracy: an exactly 0.000 rad neck is not found, while 0.02 rad
    // (about one degree) is. Real necks are never exactly axis-aligned — both
    // reference photographs sit around two degrees — but it is a sharp edge in
    // the maths rather than a gentle falloff, so it is recorded here rather than
    // hidden by only testing comfortable angles.
    for (const angle of [0.03, 0.15, -0.2]) {
      const image = renderSyntheticNeck({ width: W, height: H, angle, seed: 9 });
      const detection = detectNeck(image, W, H);
      expect(detection, `angle ${angle}`).not.toBeNull();
      const expectedTheta = ((angle + Math.PI / 2) % Math.PI + Math.PI) % Math.PI;
      expect(angularDistance(detection!.angle, expectedTheta)).toBeLessThan(0.3);
    }
  });

  it("returns four finite corners inside the frame's neighbourhood", () => {
    const image = renderSyntheticNeck({ width: W, height: H });
    const { corners } = detectNeck(image, W, H)!;
    expect(corners.length).toBe(4);
    for (const corner of corners) {
      expect(Number.isFinite(corner.x)).toBe(true);
      expect(Number.isFinite(corner.y)).toBe(true);
      expect(corner.x).toBeGreaterThan(-W);
      expect(corner.x).toBeLessThan(W * 2);
    }
  });

  it("reports no neck in an empty cluttered scene", () => {
    const image = renderEmptyScene(W, H);
    const detection = detectNeck(image, W, H);
    // Either nothing, or something it is not confident about — never a
    // confident lock onto furniture.
    expect(detection === null || detection.confidence < 0.5).toBe(true);
  });

  it("never returns a band too wide to be a neck", () => {
    // The old behaviour was to reject the frame outright. Finding a plausible
    // sub-band inside an implausibly wide one is better, so what matters now is
    // that whatever comes back is a believable width.
    const image = renderSyntheticNeck({ width: W, height: H, bandWidth: H * 0.95 });
    const detection = detectNeck(image, W, H);
    if (detection) expect(detection.width).toBeLessThan(H * 0.35);
  });

  it("does not crash on a blank frame", () => {
    expect(detectNeck(new Uint8ClampedArray(W * H), W, H)).toBeNull();
  });

  it("is not fooled by a nearly empty scene with two crossing lines", () => {
    // Regression. This exact scene — a flat wall, one near-horizontal edge and
    // one near-vertical one — previously scored 0.74, as confidently as a real
    // neck, because every confidence term was measured relative to whatever
    // little evidence was in the frame. On screen that drew a large, wrong
    // overlay across a room with no instrument in it.
    const image = new Uint8ClampedArray(W * H).fill(138);
    for (let x = 0; x < W; x++) {
      const y = Math.round(17 - x * 0.0075 * (H / 4));
      if (y >= 0 && y < H) image[y * W + x] = 92;
    }
    for (let y = 0; y < H; y++) {
      const x = Math.round(130 + y * 0.0083 * (W / 4));
      if (x >= 0 && x < W) image[y * W + x] = 92;
    }

    const detection = detectNeck(image, W, H);
    expect(detection === null || detection.confidence < 0.4).toBe(true);
  });

  it("still finds necks that are angled, dim or wide", () => {
    const cases = [
      { label: "steep angle", options: { angle: 0.45 } },
      { label: "low contrast", options: { noise: 14, seed: 8 } },
      { label: "six strings", options: { strings: 6, frets: 9, bandWidth: 40 } },
    ];
    for (const { label, options } of cases) {
      const detection = detectNeck(
        renderSyntheticNeck({ width: W, height: H, strings: 4, frets: 7, ...options }),
        W,
        H,
      );
      expect(detection, label).not.toBeNull();
      expect(detection!.confidence, label).toBeGreaterThan(0.55);
    }
  });

  it("finds a smaller, further-away neck", () => {
    const detection = detectNeck(
      renderSyntheticNeck({ width: W, height: H, strings: 4, frets: 6, bandWidth: 20, length: 95 }),
      W,
      H,
    );
    expect(detection).not.toBeNull();
    expect(detection!.width).toBeLessThan(H * 0.35);
  });

  it("reports a plausible string count, though only approximately", () => {
    // Counting strings from edges alone is genuinely unreliable at this
    // resolution — adjacent strings merge and highlights split them. The
    // detector is expected to land in the right neighbourhood, not to be exact,
    // which is why classifyInstrument treats the count as a hint.
    for (const strings of [4, 6]) {
      const detection = detectNeck(
        renderSyntheticNeck({ width: W, height: H, strings, frets: 7, bandWidth: 30 }),
        W,
        H,
      );
      expect(detection, `${strings} strings`).not.toBeNull();
      expect(detection!.estimatedStringCount).toBeGreaterThanOrEqual(2);
      expect(detection!.estimatedStringCount).toBeLessThanOrEqual(9);
    }
  });

  it("separates a real neck from clutter by a wide margin", () => {
    const neck = detectNeck(renderSyntheticNeck({ width: W, height: H, strings: 4, frets: 7 }), W, H);
    const clutter = detectNeck(renderEmptyScene(W, H, 11), W, H);
    expect(neck!.confidence).toBeGreaterThan(0.6);
    // Clutter can produce long parallel lines, but not a ladder of fret wires.
    expect(clutter === null || clutter.confidence < 0.3).toBe(true);
  });
});

describe("classifyInstrument", () => {
  it("declines to guess when confidence is low", () => {
    expect(
      classifyInstrument({
        corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
        confidence: 0.2,
        estimatedStringCount: 4,
        fretLineCount: 5,
        angle: 0,
        width: 20,
      }),
    ).toBeNull();
  });

  it("maps string counts to instruments", () => {
    const base = {
      corners: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] as [
        { x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number },
      ],
      confidence: 0.8,
      fretLineCount: 6,
      angle: 0,
      width: 20,
    };
    expect(classifyInstrument({ ...base, estimatedStringCount: 4 })!.instrumentId).toBe("bass-4");
    expect(classifyInstrument({ ...base, estimatedStringCount: 5 })!.instrumentId).toBe("bass-5");
    expect(classifyInstrument({ ...base, estimatedStringCount: 6 })!.instrumentId).toBe("guitar-6");
    expect(classifyInstrument({ ...base, estimatedStringCount: 11 })).toBeNull();
  });
});
