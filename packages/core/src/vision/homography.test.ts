import { describe, expect, it } from "vitest";
import {
  applyHomography,
  computeHomography,
  createNeckProjection,
  invertMatrix3,
  projectPosition,
  unprojectPosition,
  type Point,
} from "./homography";

// A neck seen at a mild angle: 400px long, narrower at the far end, in a
// 320x240-ish camera frame — representative of what detectNeck actually hands
// the rest of the pipeline.
const CORNERS: [Point, Point, Point, Point] = [
  { x: 40, y: 150 }, // nut, low string
  { x: 300, y: 130 }, // far fret, low string
  { x: 300, y: 90 }, // far fret, high string
  { x: 40, y: 60 }, // nut, high string
];

describe("invertMatrix3", () => {
  it("undoes a homography for an arbitrary point", () => {
    const unitSquare: [Point, Point, Point, Point] = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    ];
    const matrix = computeHomography(unitSquare, CORNERS)!;
    const inverse = invertMatrix3(matrix)!;
    const point = { x: 0.3, y: 0.7 };
    const forward = applyHomography(matrix, point);
    const back = applyHomography(inverse, forward);
    expect(back.x).toBeCloseTo(point.x, 5);
    expect(back.y).toBeCloseTo(point.y, 5);
  });

  it("returns null for a singular matrix", () => {
    expect(invertMatrix3([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe("unprojectPosition", () => {
  const lastFret = 22;
  const stringCount = 6;
  const projection = createNeckProjection(CORNERS, lastFret, stringCount)!;

  it("round-trips every open string back to fret 0", () => {
    for (let string = 0; string < stringCount; string++) {
      const image = projectPosition(projection, string, 0);
      const result = unprojectPosition(projection, image);
      expect(result).not.toBeNull();
      expect(result!.fret).toBe(0);
      expect(result!.string).toBe(string);
    }
  });

  it("round-trips a fretted position up the neck", () => {
    const image = projectPosition(projection, 3, 12);
    const result = unprojectPosition(projection, image);
    expect(result).not.toBeNull();
    expect(result!.string).toBe(3);
    // Perspective + the fret-spacing inversion is not pixel-exact; within a
    // fret of the true position is what a coarse motion-centroid hint needs.
    expect(Math.abs(result!.fret - 12)).toBeLessThanOrEqual(1);
  });

  it("returns null for a point nowhere near the neck", () => {
    expect(unprojectPosition(projection, { x: 4000, y: 4000 })).toBeNull();
  });
});
