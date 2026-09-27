import { describe, expect, it } from "vitest";
import {
  TapTempo,
  clampBpm,
  secondsPerBeat,
  secondsPerTick,
  tickAt,
  ticksInWindow,
} from "./metronome";
import { TimingTracker, evaluateTiming } from "./rhythm";

const fourFour = { beats: 4, value: 4 } as const;
const base = { bpm: 120, timeSignature: fourFour, accentFirstBeat: true } as const;

describe("metronome grid", () => {
  it("converts tempo to seconds", () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.5, 9);
    expect(secondsPerTick({ ...base, subdivision: "eighth" })).toBeCloseTo(0.25, 9);
    expect(secondsPerTick({ ...base, subdivision: "triplet" })).toBeCloseTo(1 / 6, 9);
    expect(secondsPerTick({ ...base, subdivision: "sixteenth" })).toBeCloseTo(0.125, 9);
  });

  it("accents the downbeat and counts bars", () => {
    const settings = { ...base, subdivision: "quarter" } as const;
    expect(tickAt(settings, 0).accent).toBe("downbeat");
    expect(tickAt(settings, 1).accent).toBe("beat");
    expect(tickAt(settings, 4).accent).toBe("downbeat");
    expect(tickAt(settings, 4).bar).toBe(1);
    expect(tickAt(settings, 5).beat).toBe(2);
  });

  it("marks off-beat subdivisions distinctly", () => {
    const settings = { ...base, subdivision: "eighth" } as const;
    expect(tickAt(settings, 0).accent).toBe("downbeat");
    expect(tickAt(settings, 1).accent).toBe("subdivision");
    expect(tickAt(settings, 2).accent).toBe("beat");
  });

  it("schedules exactly the ticks inside a lookahead window", () => {
    const settings = { ...base, subdivision: "quarter" } as const;
    const ticks = ticksInWindow(settings, 10, 10, 11);
    expect(ticks.map((t) => t.time)).toEqual([10, 10.5]);
    // a second call for the next window must not repeat the previous ticks
    const next = ticksInWindow(settings, 10, 11, 12);
    expect(next.map((t) => t.time)).toEqual([11, 11.5]);
  });

  it("clamps tempo to a sane range", () => {
    expect(clampBpm(5)).toBe(20);
    expect(clampBpm(10000)).toBe(400);
    expect(clampBpm(120.4)).toBe(120);
  });
});

describe("tap tempo", () => {
  it("needs two taps and then converges", () => {
    const tap = new TapTempo();
    expect(tap.tap(0)).toBeNull();
    expect(tap.tap(0.5)).toBe(120);
    expect(tap.tap(1.0)).toBe(120);
  });

  it("ignores one fumbled tap", () => {
    const tap = new TapTempo();
    tap.tap(0);
    tap.tap(0.5);
    tap.tap(1.0);
    tap.tap(1.9); // late tap
    tap.tap(2.0);
    expect(tap.tap(2.5)).toBeGreaterThanOrEqual(115);
    expect(tap.tap(3.0)).toBeLessThanOrEqual(125);
  });

  it("restarts after a long pause", () => {
    const tap = new TapTempo();
    tap.tap(0);
    tap.tap(0.5);
    expect(tap.tap(30)).toBeNull();
  });
});

describe("timing evaluation", () => {
  it("grades on-time, early, late and missed", () => {
    // at 120 bpm one beat is 0.5 s
    expect(evaluateTiming(1, 1.02, 120).verdict).toBe("on_time");
    expect(evaluateTiming(1, 0.85, 120).verdict).toBe("early");
    expect(evaluateTiming(1, 1.15, 120).verdict).toBe("late");
    expect(evaluateTiming(1, 1.6, 120).verdict).toBe("missed");
  });

  it("reports the offset in beats, matching the spec's example", () => {
    // expected beat 2, played at beat 2.2 -> late by 0.2 beat
    const result = evaluateTiming(1.0, 1.1, 120);
    expect(result.deltaBeats).toBeCloseTo(0.2, 6);
    expect(result.verdict).toBe("late");
  });

  it("scores accuracy highest when dead on the beat", () => {
    expect(evaluateTiming(1, 1, 120).accuracy).toBe(1);
    expect(evaluateTiming(1, 1.1, 120).accuracy).toBeLessThan(1);
    expect(evaluateTiming(1, 1.25, 120).accuracy).toBe(0);
  });
});

describe("TimingTracker", () => {
  it("detects a player who consistently rushes", () => {
    const tracker = new TimingTracker();
    for (let i = 0; i < 10; i++) tracker.push(evaluateTiming(1, 0.94, 120));
    expect(tracker.tendency).toBe("rushing");
    expect(tracker.bias).toBeLessThan(0);
  });

  it("calls steady playing steady", () => {
    const tracker = new TimingTracker();
    for (let i = 0; i < 10; i++) {
      tracker.push(evaluateTiming(1, i % 2 === 0 ? 1.005 : 0.995, 120));
    }
    expect(tracker.tendency).toBe("steady");
    expect(tracker.spread).toBeLessThan(0.05);
  });
});
