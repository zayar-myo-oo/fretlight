import { describe, expect, it } from "vitest";
import { NeckTracker } from "./tracking";
import type { NeckDetection } from "./neck-detector";
import type { Point } from "./homography";

const W = 640;
const H = 480;

function detection(confidence: number, offset = 0): NeckDetection {
  const corners: [Point, Point, Point, Point] = [
    { x: 100 + offset, y: 300 },
    { x: 500 + offset, y: 260 },
    { x: 500 + offset, y: 320 },
    { x: 100 + offset, y: 380 },
  ];
  return {
    corners,
    confidence,
    estimatedStringCount: 4,
    fretLineCount: 6,
    angle: 0.1,
    width: 60,
  };
}

const feed = (tracker: NeckTracker, value: NeckDetection | null, times: number) => {
  let status = tracker.update(value, 0);
  for (let i = 1; i < times; i++) status = tracker.update(value, i * 30);
  return status;
};

describe("acquisition", () => {
  it("does not lock on a single good frame", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 4 });
    const status = tracker.update(detection(0.9), 0);
    expect(status.state).toBe("acquiring");
    expect(status.usingFallback).toBe(false);
  });

  it("locks on after enough consecutive good frames", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 4 });
    const status = feed(tracker, detection(0.9), 4);
    expect(status.state).toBe("tracking");
    expect(status.corners).not.toBeNull();
  });

  it("ignores detections below the acquire threshold", () => {
    const tracker = new NeckTracker(W, H, { acquireConfidence: 0.55 });
    const status = feed(tracker, detection(0.3), 10);
    expect(status.state).toBe("searching");
    expect(status.usingFallback).toBe(true);
  });
});

describe("hysteresis — the anti-flicker requirement", () => {
  it("keeps tracking through a brief dropout instead of falling back", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 3, degradeFrames: 5, fallbackFrames: 20 });
    feed(tracker, detection(0.9), 4);
    expect(tracker.currentState).toBe("tracking");

    // Two bad frames — a hand passing over the neck.
    tracker.update(null, 200);
    const status = tracker.update(null, 230);
    expect(status.state).toBe("tracking");
    expect(status.corners).not.toBeNull();
    expect(status.usingFallback).toBe(false);
  });

  it("degrades before it falls back, and keeps drawing the last pose", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 3, degradeFrames: 4, fallbackFrames: 15 });
    feed(tracker, detection(0.9), 4);
    for (let i = 0; i < 5; i++) tracker.update(null, 300 + i * 30);
    const status = tracker.update(null, 500);
    expect(status.state).toBe("degraded");
    // Critically, the overlay is still on screen and still correct.
    expect(status.corners).not.toBeNull();
    expect(status.usingFallback).toBe(false);
  });

  it("falls back only after sustained failure", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 3, degradeFrames: 4, fallbackFrames: 12 });
    feed(tracker, detection(0.9), 4);
    for (let i = 0; i < 13; i++) tracker.update(null, 300 + i * 30);
    const status = tracker.update(null, 800);
    expect(status.state).toBe("fallback");
    expect(status.usingFallback).toBe(true);
    expect(status.corners).toBeNull();
  });

  it("recovers from a brief degrade immediately", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 3, degradeFrames: 3 });
    feed(tracker, detection(0.9), 4);
    for (let i = 0; i < 4; i++) tracker.update(null, 300 + i * 30);
    expect(tracker.currentState).toBe("degraded");

    tracker.update(detection(0.8), 500);
    const status = tracker.update(detection(0.8), 530);
    expect(status.state).toBe("tracking");
  });

  it("demands full evidence to come back from fallback", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 4, degradeFrames: 3, fallbackFrames: 8 });
    feed(tracker, detection(0.9), 5);
    for (let i = 0; i < 12; i++) tracker.update(null, 300 + i * 30);
    expect(tracker.currentState).toBe("fallback");

    // Two good frames are not enough to swap the whole UI back.
    tracker.update(detection(0.9), 900);
    expect(tracker.update(detection(0.9), 930).state).toBe("fallback");
    tracker.update(detection(0.9), 960);
    expect(tracker.update(detection(0.9), 990).state).toBe("tracking");
  });

  it("never oscillates on a signal sitting near the threshold", () => {
    const tracker = new NeckTracker(W, H, { acquireConfidence: 0.55, dropConfidence: 0.32 });
    feed(tracker, detection(0.9), 6);

    const states: string[] = [];
    // Confidence hovering between the two thresholds: with one threshold this
    // is exactly where detected/lost/detected flicker comes from.
    for (let i = 0; i < 20; i++) {
      states.push(tracker.update(detection(i % 2 === 0 ? 0.5 : 0.42), 600 + i * 30).state);
    }
    expect(new Set(states)).toEqual(new Set(["tracking"]));
  });
});

describe("smoothing", () => {
  it("does not jump straight to a new detection position", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 2 });
    feed(tracker, detection(0.9), 3);
    const before = tracker.update(detection(0.9), 200).corners![0]!.x;

    const after = tracker.update(detection(0.9, 30), 230).corners![0]!.x;
    // Moved toward the new position, but nowhere near all the way.
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(before + 30);
  });

  it("converges on a sustained move rather than lagging forever", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 2 });
    feed(tracker, detection(0.9), 3);
    let status = tracker.update(detection(0.9), 200);
    for (let i = 0; i < 40; i++) status = tracker.update(detection(0.9, 30), 230 + i * 30);
    expect(status.corners![0]!.x).toBeCloseTo(130, 0);
  });

  it("rejects a corner that teleports — that is a mis-detection, not movement", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 2, maxJumpRatio: 0.2 });
    feed(tracker, detection(0.9), 3);
    const before = tracker.update(detection(0.9), 200).corners![0]!.x;
    const status = tracker.update(detection(0.9, 500), 230);
    expect(status.corners![0]!.x).toBeCloseTo(before, 1);
  });
});

describe("adaptive detection rate", () => {
  it("runs detection less often once confidently locked", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 2 });
    feed(tracker, detection(0.95), 12);
    const locked = tracker.detectionIntervalMs();

    const fresh = new NeckTracker(W, H);
    expect(locked).toBeGreaterThan(fresh.detectionIntervalMs());
  });

  it("speeds up when the lock degrades", () => {
    const tracker = new NeckTracker(W, H, { acquireFrames: 2, degradeFrames: 3 });
    feed(tracker, detection(0.95), 10);
    const lockedInterval = tracker.detectionIntervalMs();
    for (let i = 0; i < 4; i++) tracker.update(null, 400 + i * 30);
    expect(tracker.detectionIntervalMs()).toBeLessThan(lockedInterval);
  });
});

describe("seeding and reset", () => {
  it("accepts a manual calibration as a starting pose", () => {
    const tracker = new NeckTracker(W, H);
    const corners: [Point, Point, Point, Point] = [
      { x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }, { x: 10, y: 40 },
    ];
    tracker.seed(corners);
    feed(tracker, detection(0.9), 5);
    expect(tracker.currentState).toBe("tracking");
  });

  it("clears completely on reset", () => {
    const tracker = new NeckTracker(W, H);
    feed(tracker, detection(0.9), 6);
    tracker.reset();
    expect(tracker.currentState).toBe("searching");
    expect(tracker.update(null, 0).corners).toBeNull();
  });
});
