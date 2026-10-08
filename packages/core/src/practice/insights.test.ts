import { describe, expect, it } from "vitest";
import { compareWithPreviousDay, recommendations, skillMap, tempoReadiness, weakNotes, type SessionLike } from "./insights";

const at = (daysAgo: number, hour = 12) => {
  const d = new Date(2026, 9, 8, hour);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

const run = (over: Partial<SessionLike>): SessionLike => ({
  date: at(0),
  exercise: "Note drill",
  instrumentId: "guitar-6",
  bpm: 80,
  durationSeconds: 120,
  pitchAccuracy: 0.9,
  timingAccuracy: 0.9,
  overall: 0.9,
  ...over,
});

const NOW = new Date(2026, 9, 8, 18);

describe("compareWithPreviousDay", () => {
  it("compares today with yesterday", () => {
    const result = compareWithPreviousDay([run({ overall: 0.84 }), run({ date: at(1), overall: 0.78 })], NOW)!;
    expect(result.previousLabel).toBe("Yesterday");
    expect(result.delta).toBeCloseTo(0.06, 5);
  });
  it("needs both days", () => {
    expect(compareWithPreviousDay([run({})], NOW)).toBeNull();
  });
});

describe("tempoReadiness", () => {
  it("suggests +10 BPM after three strong runs at the top tempo", () => {
    const runs = [run({ date: at(0) }), run({ date: at(1) }), run({ date: at(2) })];
    expect(tempoReadiness(runs)).toEqual([{ exercise: "Note drill", bpm: 80, next: 90 }]);
  });
  it("waits while any of them is weak", () => {
    expect(tempoReadiness([run({}), run({ overall: 0.6 }), run({})])).toEqual([]);
  });
});

describe("skillMap", () => {
  it("never invents a score without data", () => {
    const skills = skillMap([], {}, {});
    expect(skills.every((s) => s.score === null)).toBe(true);
  });
  it("scores from real sessions and tallies", () => {
    const skills = skillMap([run({ timingAccuracy: 0.6 }), run({ timingAccuracy: 0.8 })], { "0": { attempts: 10, correct: 7 } }, {});
    expect(skills.find((s) => s.id === "timing")!.score).toBeCloseTo(0.7);
    expect(skills.find((s) => s.id === "notes")!.score).toBeCloseTo(0.7);
    expect(skills.find((s) => s.id === "positions")!.score).toBeNull();
  });
});

describe("recommendations", () => {
  it("targets weak notes with a ready-made link", () => {
    const notes = { "6": { attempts: 10, correct: 4 }, "11": { attempts: 8, correct: 5 }, "0": { attempts: 10, correct: 10 } };
    expect(weakNotes(notes).map((n) => n.pitchClass)).toEqual([6, 11]);
    const [first] = recommendations([run({})], notes);
    expect(first!.title).toBe("Practise F# + B");
    expect(first!.href).toContain("notes=6,11");
  });
  it("suggests slowing down when timing is weak", () => {
    const runs = [run({ timingAccuracy: 0.5 }), run({ timingAccuracy: 0.6 }), run({ timingAccuracy: 0.55 })];
    expect(recommendations(runs, {}).some((r) => r.title.startsWith("Slow down"))).toBe(true);
  });
  it("gives a starting point when there is no history", () => {
    expect(recommendations([], {})[0]!.href).toContain("/practice");
  });
});
