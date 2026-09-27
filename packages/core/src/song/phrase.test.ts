import { describe, expect, it } from "vitest";
import {
  PRACTICE_SPEEDS,
  buildSlowPracticePlan,
  decomposeIntoPhrases,
  estimateDifficulty,
  phraseToSequence,
} from "./phrase";
import type { SongNote } from "./types";
import { createFretboard } from "../instrument/fretboard";
import { getTuning } from "../instrument/tunings";
import { noteToMidi } from "../theory/pitch";

const bass = createFretboard(getTuning("bass-4-standard")!, 20);

const note = (midi: number, startBeat: number, durationBeats = 0.5): SongNote => ({
  midi, startBeat, durationBeats,
});

describe("decomposeIntoPhrases", () => {
  it("returns nothing for an empty part", () => {
    expect(decomposeIntoPhrases([])).toEqual([]);
  });

  it("breaks at rests, where the music already breathes", () => {
    const part = [
      note(40, 0), note(42, 0.5), note(43, 1),
      // two-beat rest
      note(45, 4), note(47, 4.5), note(48, 5),
    ];
    const phrases = decomposeIntoPhrases(part, { restBeats: 1 });
    expect(phrases.length).toBe(2);
    expect(phrases[0]!.notes.length).toBe(3);
    expect(phrases[1]!.notes.length).toBe(3);
  });

  it("caps phrase length so nothing is too long to learn at once", () => {
    const part = Array.from({ length: 20 }, (_, i) => note(40 + (i % 5), i * 0.25, 0.25));
    const phrases = decomposeIntoPhrases(part, { maxNotes: 6, restBeats: 4 });
    for (const phrase of phrases) expect(phrase.notes.length).toBeLessThanOrEqual(8);
    expect(phrases.length).toBeGreaterThan(1);
  });

  it("does not leave an orphaned one-note tail", () => {
    const part = [
      note(40, 0), note(42, 0.5), note(43, 1), note(45, 1.5),
      note(47, 2), note(48, 2.5), note(50, 3),
      note(52, 3.5),
    ];
    const phrases = decomposeIntoPhrases(part, { maxNotes: 7, minNotes: 3, restBeats: 4 });
    for (const phrase of phrases) expect(phrase.notes.length).toBeGreaterThanOrEqual(3);
  });

  it("covers every note exactly once", () => {
    const part = Array.from({ length: 31 }, (_, i) => note(40 + (i % 7), i * 0.5, 0.5));
    const phrases = decomposeIntoPhrases(part);
    const total = phrases.reduce((sum, p) => sum + p.notes.length, 0);
    expect(total).toBe(part.length);

    const seen = phrases.flatMap((p) => p.notes.map((n) => n.startBeat));
    expect(new Set(seen).size).toBe(part.length);
  });

  it("keeps phrases in order and non-overlapping", () => {
    const part = Array.from({ length: 24 }, (_, i) => note(40 + (i % 6), i * 0.5, 0.5));
    const phrases = decomposeIntoPhrases(part);
    for (let i = 1; i < phrases.length; i++) {
      expect(phrases[i]!.startBeat).toBeGreaterThanOrEqual(phrases[i - 1]!.startBeat);
    }
  });

  it("reports a sensible span for each phrase", () => {
    const part = [note(40, 0, 1), note(42, 1, 1), note(43, 2, 1)];
    const [phrase] = decomposeIntoPhrases(part, { restBeats: 4 });
    expect(phrase!.startBeat).toBe(0);
    expect(phrase!.lengthBeats).toBe(3);
  });

  it("sorts an out-of-order part before splitting", () => {
    const part = [note(43, 1), note(40, 0), note(42, 0.5)];
    const [phrase] = decomposeIntoPhrases(part, { restBeats: 4 });
    expect(phrase!.notes.map((n) => n.startBeat)).toEqual([0, 0.5, 1]);
  });
});

describe("estimateDifficulty", () => {
  it("rates a slow, narrow line as easy", () => {
    const easy = [note(40, 0, 1), note(42, 1, 1), note(43, 2, 1)];
    expect(estimateDifficulty(easy)).toBeLessThan(0.4);
  });

  it("rates a fast, wide line as harder", () => {
    const hard = Array.from({ length: 12 }, (_, i) => note(40 + i * 2, i * 0.125, 0.125));
    expect(estimateDifficulty(hard)).toBeGreaterThan(estimateDifficulty([note(40, 0, 1), note(41, 1, 1)]));
  });

  it("counts position shifts when fingerings are given", () => {
    const still: SongNote[] = [
      { ...note(40, 0), position: { string: 0, fret: 0 } },
      { ...note(42, 1), position: { string: 0, fret: 2 } },
    ];
    const shifting: SongNote[] = [
      { ...note(40, 0), position: { string: 0, fret: 0 } },
      { ...note(42, 1), position: { string: 3, fret: 14 } },
    ];
    expect(estimateDifficulty(shifting)).toBeGreaterThan(estimateDifficulty(still));
  });

  it("handles a single note", () => {
    expect(estimateDifficulty([note(40, 0)])).toBeLessThan(0.2);
  });
});

describe("phraseToSequence", () => {
  const part = [
    note(noteToMidi("E1")!, 0), note(noteToMidi("G1")!, 0.5), note(noteToMidi("A1")!, 1),
  ];
  const [phrase] = decomposeIntoPhrases(part, { restBeats: 4 });

  it("hands the practice engine something it already understands", () => {
    const sequence = phraseToSequence(phrase!, bass);
    expect(sequence.steps.length).toBe(3);
    expect(sequence.steps.map((s) => s.label)).toEqual(["E", "G", "A"]);
    expect(sequence.mode).toBe("free");
  });

  it("suggests fingerings that stay near each other", () => {
    const sequence = phraseToSequence(phrase!, bass);
    const frets = sequence.steps.map((s) => s.position?.fret).filter((f): f is number => f !== undefined);
    expect(frets.length).toBe(3);
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(7);
  });

  it("stamps expected times only in timed mode", () => {
    expect(phraseToSequence(phrase!, bass).steps[1]!.expectedTime).toBeUndefined();
    const timed = phraseToSequence(phrase!, bass, { timed: true, bpm: 120 });
    expect(timed.steps[0]!.expectedTime).toBe(0);
    expect(timed.steps[1]!.expectedTime).toBeCloseTo(0.25, 6);
  });

  it("keeps a fingering the transcription already specified", () => {
    const withFingering = decomposeIntoPhrases(
      [{ ...note(noteToMidi("A1")!, 0), position: { string: 0, fret: 5 } }],
      { restBeats: 4 },
    )[0]!;
    const sequence = phraseToSequence(withFingering, bass);
    expect(sequence.steps[0]!.position).toEqual({ string: 0, fret: 5 });
  });
});

describe("slow practice plan", () => {
  it("starts slower for harder phrases", () => {
    const hard = buildSlowPracticePlan(120, 0.8);
    const easy = buildSlowPracticePlan(120, 0.1);
    expect(hard[0]!.speed).toBeLessThan(easy[0]!.speed);
  });

  it("always ends at full tempo", () => {
    for (const difficulty of [0, 0.5, 1]) {
      const plan = buildSlowPracticePlan(100, difficulty);
      expect(plan[plan.length - 1]!.speed).toBe(1);
      expect(plan[plan.length - 1]!.bpm).toBe(100);
    }
  });

  it("increases tempo monotonically", () => {
    const plan = buildSlowPracticePlan(140, 0.9);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.bpm).toBeGreaterThan(plan[i - 1]!.bpm);
    }
  });

  it("repeats the slow steps more", () => {
    const plan = buildSlowPracticePlan(120, 0.9);
    expect(plan[0]!.repetitions).toBeGreaterThanOrEqual(plan[plan.length - 1]!.repetitions);
  });

  it("uses the documented speed ladder", () => {
    expect(PRACTICE_SPEEDS[PRACTICE_SPEEDS.length - 1]).toBe(1);
    expect(buildSlowPracticePlan(120, 1).map((s) => s.speed)).toEqual([...PRACTICE_SPEEDS]);
  });
});
