import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectNeck } from "./neck-detector";

/**
 * Detection against actual photographs of a guitar, in a real room.
 *
 * These matter more than the synthetic scenes. Every false positive that cost
 * real debugging time came from something a clean render does not contain: a
 * shelf and an air-conditioner supplying stronger horizontals than the neck, a
 * dark television and a dark shirt forming a convincing band, window blinds
 * producing a dark strip crossed by regular lines. The detector passed its
 * synthetic tests throughout all of it.
 *
 * Fixtures are greyscale and warmth (128 + R - B) dumps of the camera viewport
 * from two screenshots of the running app.
 */
const FIXTURES = join(__dirname, "fixtures");

function load(name: string, width: number, height: number) {
  const grey = new Uint8ClampedArray(readFileSync(join(FIXTURES, `${name}-${width}x${height}.gray`)));
  const warmth = new Uint8ClampedArray(readFileSync(join(FIXTURES, `${name}-${width}x${height}.warm`)));
  return { grey, warmth, width, height };
}

describe("a real guitar, filling much of the frame", () => {
  const { grey, warmth, width, height } = load("neck-near", 480, 360);

  it("detects the neck", () => {
    const detection = detectNeck(grey, width, height, { warmth });
    expect(detection).not.toBeNull();
    expect(detection!.confidence).toBeGreaterThan(0.6);
  });

  it("puts the overlay on the neck, not on the room behind it", () => {
    const detection = detectNeck(grey, width, height, { warmth })!;
    // The fretboard runs roughly horizontally across the upper-middle of this
    // frame. Earlier versions confidently returned the player's torso and the
    // television below it, which is the failure this pins down.
    const ys = detection.corners.map((corner) => corner.y);
    const centreY = ys.reduce((sum, y) => sum + y, 0) / 4;
    expect(centreY).toBeGreaterThan(100);
    expect(centreY).toBeLessThan(250);

    // And it spans the frame, as a neck seen side-on does.
    const xs = detection.corners.map((corner) => corner.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(width * 0.7);
  });

  it("reports a neck-shaped band rather than half the picture", () => {
    const detection = detectNeck(grey, width, height, { warmth })!;
    expect(detection.width).toBeGreaterThan(height * 0.05);
    expect(detection.width).toBeLessThan(height * 0.32);
  });

  it("finds fret wires crossing it", () => {
    const detection = detectNeck(grey, width, height, { warmth })!;
    expect(detection.fretLineCount).toBeGreaterThanOrEqual(2);
  });
});

describe("a real guitar, further away and partly occluded", () => {
  const { grey, warmth, width, height } = load("neck-far", 480, 360);

  it("is a known limitation, recorded rather than hidden", () => {
    // In this frame the neck is thinner, crosses the player's face, and the
    // left edge is filled by window blinds — a dark vertical band crossed by
    // regular slats, which scores well on every cue the detector has. It picks
    // the blinds.
    //
    // The honest consequences: automatic tracking is not yet dependable enough
    // to be the only option, which is why the tracker demands several
    // consecutive confident frames, why low confidence fades the overlay out,
    // and why manual alignment still exists. Fixing this properly needs
    // temporal masking of the static background, or a trained detector.
    const detection = detectNeck(grey, width, height, { warmth });
    if (detection) {
      const xs = detection.corners.map((c) => c.x);
      const looksLikeBlinds = Math.max(...xs) < width * 0.3;
      expect(looksLikeBlinds || detection.confidence < 0.8).toBe(true);
    }
  });
});
