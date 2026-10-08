import { describe, expect, it } from "vitest";
import { CHORD_LEVELS, INTERVAL_LEVELS, earQuestion, weakestEarItems } from "./ear-training";

const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

describe("earQuestion", () => {
  it("builds an interval whose notes are the answer apart, with the answer among the choices", () => {
    const random = seeded(7);
    for (let i = 0; i < 50; i++) {
      const q = earQuestion("interval", "intermediate", random);
      expect(q.midi[1]! - q.midi[0]!).toBe(Number(q.answer));
      expect(INTERVAL_LEVELS.intermediate).toContain(Number(q.answer));
      expect(q.choices.map((c) => c.id)).toContain(q.answer);
    }
  });

  it("plays beginner intervals melodically and builds chords from their formula", () => {
    const random = seeded(3);
    for (let i = 0; i < 30; i++) expect(earQuestion("interval", "beginner", random).harmonic).toBe(false);
    const q = earQuestion("chord", "advanced", random);
    expect(CHORD_LEVELS.advanced).toContain(q.answer);
    expect(q.harmonic).toBe(true);
    expect(q.midi.length).toBeGreaterThanOrEqual(3);
  });
});

describe("weakestEarItems", () => {
  it("lists only items with enough attempts and below 80%, weakest first", () => {
    const weak = weakestEarItems({
      "interval:3": { attempts: 10, correct: 5 },
      "interval:4": { attempts: 10, correct: 9 },
      "interval:6": { attempts: 6, correct: 1 },
      "interval:1": { attempts: 2, correct: 0 },
    });
    expect(weak.map((w) => w.key)).toEqual(["interval:6", "interval:3"]);
  });
});
