import { describe, expect, it } from "vitest";
import {
  applyHomography,
  computeHomography,
  createNeckProjection,
  fretFraction,
  fretSlotFraction,
  projectFretLine,
  projectPosition,
  type Point,
} from "./homography";
import { MotionDetector, StrokeCounter } from "./motion";

const UNIT: [Point, Point, Point, Point] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const close = (a: Point, b: Point, tolerance = 1e-6) => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
  void tolerance;
};

describe("computeHomography", () => {
  it("recovers a pure scale and translation", () => {
    const destination: [Point, Point, Point, Point] = [
      { x: 100, y: 50 },
      { x: 500, y: 50 },
      { x: 500, y: 250 },
      { x: 100, y: 250 },
    ];
    const matrix = computeHomography(UNIT, destination)!;
    expect(matrix).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      close(applyHomography(matrix, UNIT[i]!), destination[i]!);
    }
    close(applyHomography(matrix, { x: 0.5, y: 0.5 }), { x: 300, y: 150 });
  });

  it("handles a genuinely perspective view, with foreshortening", () => {
    // Far edge narrower than the near edge — a neck angled away from the camera.
    const destination: [Point, Point, Point, Point] = [
      { x: 80, y: 300 },
      { x: 620, y: 210 },
      { x: 620, y: 260 },
      { x: 80, y: 420 },
    ];
    const matrix = computeHomography(UNIT, destination)!;
    for (let i = 0; i < 4; i++) {
      close(applyHomography(matrix, UNIT[i]!), destination[i]!);
    }
    // The near end spans more pixels than the far end — that is what perspective is.
    const nearHeight = destination[3]!.y - destination[0]!.y;
    const farHeight = destination[2]!.y - destination[1]!.y;
    expect(nearHeight).toBeGreaterThan(farHeight);

    const midNear = applyHomography(matrix, { x: 0, y: 0.5 });
    const midFar = applyHomography(matrix, { x: 1, y: 0.5 });
    expect(midNear.y).toBeGreaterThan(midFar.y);
  });

  it("returns null for a degenerate (collinear) configuration", () => {
    const collinear: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(computeHomography(UNIT, collinear)).toBeNull();
  });

  it("never produces NaN for points mapped through it", () => {
    const destination: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 640, y: 20 },
      { x: 640, y: 300 },
      { x: 0, y: 480 },
    ];
    const matrix = computeHomography(UNIT, destination)!;
    for (let x = 0; x <= 1; x += 0.1) {
      for (let y = 0; y <= 1; y += 0.25) {
        const p = applyHomography(matrix, { x, y });
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});

describe("fret spacing", () => {
  it("places the nut at 0 and the reference fret at 1", () => {
    expect(fretFraction(0, 12)).toBe(0);
    expect(fretFraction(12, 12)).toBeCloseTo(1, 9);
  });

  it("uses real fret geometry, not even spacing", () => {
    // The 12th fret is the octave: exactly half the scale length from the nut.
    // Against a 24-fret reference it therefore sits at 2/3, not at 1/2.
    expect(fretFraction(12, 24)).toBeCloseTo(0.6667, 3);
    // Frets get closer together as they go up.
    const first = fretFraction(1, 12) - fretFraction(0, 12);
    const last = fretFraction(12, 12) - fretFraction(11, 12);
    expect(first).toBeGreaterThan(last);
  });

  it("puts a slot between its two wires", () => {
    const slot = fretSlotFraction(5, 12);
    expect(slot).toBeGreaterThan(fretFraction(4, 12));
    expect(slot).toBeLessThan(fretFraction(5, 12));
  });
});

describe("neck projection", () => {
  const corners: [Point, Point, Point, Point] = [
    { x: 100, y: 400 },
    { x: 700, y: 300 },
    { x: 700, y: 360 },
    { x: 100, y: 520 },
  ];

  it("keeps fret lines in order along the neck", () => {
    const projection = createNeckProjection(corners, 12, 4)!;
    expect(projection).not.toBeNull();
    let previousX = -Infinity;
    for (let fret = 0; fret <= 12; fret++) {
      const [top] = projectFretLine(projection, fret);
      expect(top.x).toBeGreaterThan(previousX);
      previousX = top.x;
    }
  });

  it("places markers inside the calibrated quad", () => {
    const projection = createNeckProjection(corners, 12, 4)!;
    for (let s = 0; s < 4; s++) {
      for (let f = 1; f <= 12; f++) {
        const point = projectPosition(projection, s, f);
        expect(point.x).toBeGreaterThanOrEqual(100);
        expect(point.x).toBeLessThanOrEqual(700);
        expect(point.y).toBeGreaterThan(250);
        expect(point.y).toBeLessThan(560);
      }
    }
  });

  it("orders strings from the low side to the high side", () => {
    const projection = createNeckProjection(corners, 12, 4)!;
    const low = projectPosition(projection, 0, 5);
    const high = projectPosition(projection, 3, 5);
    expect(low.y).not.toBeCloseTo(high.y, 1);
  });

  it("refuses a degenerate calibration", () => {
    const flat: [Point, Point, Point, Point] = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ];
    expect(createNeckProjection(flat, 12, 6)).toBeNull();
  });
});

describe("MotionDetector", () => {
  const width = 32;
  const height = 24;
  const blank = () => new Uint8ClampedArray(width * height).fill(40);

  it("reports nothing on the first frame, having nothing to compare with", () => {
    const detector = new MotionDetector({ width, height });
    const result = detector.process(blank());
    expect(result.energy).toBe(0);
    expect(result.active).toBe(false);
  });

  it("stays quiet on identical frames", () => {
    const detector = new MotionDetector({ width, height });
    detector.process(blank());
    const result = detector.process(blank());
    expect(result.energy).toBe(0);
    expect(result.centroid).toBeNull();
  });

  it("finds a moving region and locates it", () => {
    const detector = new MotionDetector({ width, height });
    detector.process(blank());

    const moved = blank();
    // Bright block in the lower-right quadrant.
    for (let y = 16; y < 22; y++) {
      for (let x = 22; x < 30; x++) moved[y * width + x] = 220;
    }
    const result = detector.process(moved);

    expect(result.energy).toBeGreaterThan(0);
    expect(result.active).toBe(true);
    expect(result.centroid!.x).toBeGreaterThan(0.6);
    expect(result.centroid!.y).toBeGreaterThan(0.6);
  });

  it("ignores changes below the threshold — sensor noise is not playing", () => {
    const detector = new MotionDetector({ width, height, threshold: 30 });
    detector.process(blank());
    const noisy = blank();
    for (let i = 0; i < noisy.length; i++) noisy[i] = 40 + (i % 5);
    expect(detector.process(noisy).energy).toBe(0);
  });
});

describe("StrokeCounter", () => {
  it("counts one stroke per energy peak", () => {
    const counter = new StrokeCounter();
    let counted = 0;
    // Four peaks, half a second apart.
    for (let i = 0; i < 4; i++) {
      if (counter.push(0.05, i * 0.5)) counted++;
      counter.push(0.001, i * 0.5 + 0.25);
    }
    expect(counted).toBe(4);
  });

  it("does not double-count one stroke that wobbles across the threshold", () => {
    const counter = new StrokeCounter(0.2);
    let counted = 0;
    if (counter.push(0.05, 0)) counted++;
    counter.push(0.001, 0.01);
    if (counter.push(0.05, 0.05)) counted++; // still inside the refractory window
    expect(counted).toBe(1);
  });

  it("derives a stroke rate comparable with a tempo", () => {
    const counter = new StrokeCounter();
    // Two strokes a second === 120 per minute.
    for (let i = 0; i < 5; i++) {
      counter.push(0.05, i * 0.5);
      counter.push(0.001, i * 0.5 + 0.2);
    }
    expect(counter.rate()).toBeCloseTo(120, 0);
  });

  it("withholds a rate until it has enough evidence", () => {
    const counter = new StrokeCounter();
    counter.push(0.05, 0);
    expect(counter.rate()).toBeNull();
  });
});
