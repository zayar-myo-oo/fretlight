import { describe, expect, it } from "vitest";
import { describeNote, describeTarget, generateDrill } from "./drills";
import { PracticeEngine } from "./practice-engine";
import { createFretboard, noteAt } from "../instrument/fretboard";
import { getTuning } from "../instrument/tunings";
import { noteToMidi } from "../theory/pitch";

const guitar = createFretboard(getTuning("guitar-6-standard")!, 22);
const bass = createFretboard(getTuning("bass-4-standard")!, 20);

describe("note drill", () => {
  it("generates the requested number of targets", () => {
    const drill = generateDrill({ kind: "note", board: guitar, length: 10, seed: 1 });
    expect(drill.sequence.steps.length).toBe(10);
    expect(drill.requirePosition).toBe(false);
  });

  it("is reproducible from a seed", () => {
    const a = generateDrill({ kind: "note", board: guitar, length: 8, seed: 42 });
    const b = generateDrill({ kind: "note", board: guitar, length: 8, seed: 42 });
    expect(a.sequence.steps.map((s) => s.label)).toEqual(b.sequence.steps.map((s) => s.label));
  });

  it("differs between seeds", () => {
    const a = generateDrill({ kind: "note", board: guitar, length: 12, seed: 1 });
    const b = generateDrill({ kind: "note", board: guitar, length: 12, seed: 2 });
    expect(a.sequence.steps.map((s) => s.label)).not.toEqual(b.sequence.steps.map((s) => s.label));
  });

  it("never asks for the same note twice in a row", () => {
    const drill = generateDrill({ kind: "note", board: guitar, length: 40, seed: 7 });
    const labels = drill.sequence.steps.map((s) => s.label);
    for (let i = 1; i < labels.length; i++) expect(labels[i]).not.toBe(labels[i - 1]);
  });

  it("can be restricted to a pool of notes", () => {
    const drill = generateDrill({ kind: "note", board: guitar, length: 20, seed: 3, pool: [0, 5, 7] });
    const allowed = new Set(["C", "F", "G"]);
    for (const step of drill.sequence.steps) expect(allowed.has(step.label)).toBe(true);
  });

  it("produces notes the instrument can actually play", () => {
    const drill = generateDrill({ kind: "note", board: bass, length: 24, seed: 9 });
    for (const step of drill.sequence.steps) {
      expect(step.midi).toBeGreaterThanOrEqual(bass.openMidi[0]!);
    }
  });
});

describe("fret drill", () => {
  it("targets an exact string and fret", () => {
    const drill = generateDrill({
      kind: "fret", board: guitar, length: 10, seed: 5, uniquePositionsOnly: false,
    });
    expect(drill.requirePosition).toBe(true);
    for (const step of drill.sequence.steps) {
      expect(step.position).toBeDefined();
      const actual = noteAt(guitar, step.position!.string, step.position!.fret);
      // The label must match the note that position really produces.
      expect(actual!.midi).toBe(step.midi);
      expect(actual!.name).toBe(step.label);
    }
  });

  it("respects a fret range and string restriction", () => {
    const drill = generateDrill({
      kind: "fret", board: guitar, length: 24, seed: 11,
      fretRange: [5, 9], strings: [0, 1], uniquePositionsOnly: false,
    });
    for (const step of drill.sequence.steps) {
      expect(step.position!.fret).toBeGreaterThanOrEqual(5);
      expect(step.position!.fret).toBeLessThanOrEqual(9);
      expect([0, 1]).toContain(step.position!.string);
    }
  });

  it("never repeats a position back-to-back", () => {
    const drill = generateDrill({
      kind: "fret", board: guitar, length: 30, seed: 13, uniquePositionsOnly: false,
    });
    const keys = drill.sequence.steps.map((s) => `${s.position!.string}:${s.position!.fret}`);
    for (let i = 1; i < keys.length; i++) expect(keys[i]).not.toBe(keys[i - 1]);
  });

  it("targets only audio-verifiable positions by default", () => {
    // Audio alone cannot distinguish an A2 on the low E at fret 5 from the open
    // A string. A fret drill that asked for one of those could not honestly mark
    // the answer, so by default only pitches unique to one position are used.
    const drill = generateDrill({ kind: "fret", board: guitar, length: 20, seed: 99 });
    for (const step of drill.sequence.steps) {
      let occurrences = 0;
      for (let string = 0; string < guitar.stringCount; string++) {
        const fret = step.midi - guitar.openMidi[string]!;
        if (fret >= 0 && fret <= guitar.fretCount) occurrences++;
      }
      expect(occurrences, `${step.label} at ${step.position!.string}:${step.position!.fret}`).toBe(1);
    }
  });

  it("widens rather than returning an empty drill when a range has none", () => {
    // Fret 7 on the A string is not unique; asking for only that must still
    // produce a usable drill, flagged as unverifiable.
    const drill = generateDrill({
      kind: "fret", board: guitar, length: 4, seed: 5, strings: [1], fretRange: [7, 7],
    });
    expect(drill.sequence.steps.length).toBe(4);
    expect(drill.instruction).toContain("cannot be confirmed by audio alone");
  });

  it("works on a bass without changes", () => {
    const drill = generateDrill({
      kind: "fret", board: bass, length: 10, seed: 17, uniquePositionsOnly: false,
    });
    for (const step of drill.sequence.steps) {
      expect(step.position!.string).toBeLessThan(bass.stringCount);
    }
  });
});

describe("interval drill", () => {
  it("asks for intervals from a root", () => {
    const drill = generateDrill({
      kind: "interval", board: guitar, length: 8, seed: 2, root: 9, intervals: [7],
    });
    // Every target is the 5th of A, which is E.
    for (const step of drill.sequence.steps) {
      expect(step.label).toBe("E");
      expect(step.degree).toBe("5");
    }
  });

  it("labels degrees correctly", () => {
    const drill = generateDrill({
      kind: "interval", board: guitar, length: 6, seed: 4, root: 0, intervals: [3, 4, 7],
    });
    const degrees = new Set(drill.sequence.steps.map((s) => s.degree));
    for (const degree of degrees) expect(["b3", "3", "5"]).toContain(degree);
  });
});

describe("position-aware grading — the point of fret practice", () => {
  const drill = generateDrill({
    kind: "fret", board: guitar, length: 4, seed: 21, fretRange: [3, 7],
    uniquePositionsOnly: false,
  });
  const first = drill.sequence.steps[0]!;

  it("accepts the right note in the right place", () => {
    const engine = new PracticeEngine(drill.sequence, { requirePosition: true });
    engine.start(0);
    const event = engine.submitNote({ midi: first.midi, time: 1, position: first.position })!;
    expect(event.verdict).toBe("correct");
  });

  it("distinguishes right note, wrong place", () => {
    const engine = new PracticeEngine(drill.sequence, { requirePosition: true });
    engine.start(0);

    // Same pitch, different position on the neck.
    const elsewhere = { string: first.position!.string + 1, fret: first.position!.fret + 5 };
    const event = engine.submitNote({ midi: first.midi, time: 1, position: elsewhere })!;
    expect(event.verdict).toBe("wrong_position");
    // Holds position so the player can find the right spot themselves.
    expect(engine.currentStep!.id).toBe(first.id);
  });

  it("still calls a wrong pitch wrong", () => {
    const engine = new PracticeEngine(drill.sequence, { requirePosition: true });
    engine.start(0);

    // Pick a pitch class that matches neither this step nor the next, or the
    // engine would legitimately read it as skipping ahead.
    const second = drill.sequence.steps[1]!;
    let wrongMidi = first.midi + 1;
    while (
      wrongMidi % 12 === first.midi % 12 ||
      wrongMidi % 12 === second.midi % 12
    ) {
      wrongMidi++;
    }

    const event = engine.submitNote({ midi: wrongMidi, time: 1, position: first.position })!;
    expect(event.verdict).toBe("wrong");
  });

  it("ignores position when the drill does not require it", () => {
    const notes = generateDrill({ kind: "note", board: guitar, length: 3, seed: 31 });
    const engine = new PracticeEngine(notes.sequence, { requirePosition: false });
    engine.start(0);
    const step = notes.sequence.steps[0]!;
    const event = engine.submitNote({
      midi: step.midi + 12, time: 1, position: { string: 5, fret: 19 },
    })!;
    expect(event.verdict).toBe("correct");
  });
});

describe("reaction time", () => {
  it("measures from when the step was presented", () => {
    const drill = generateDrill({ kind: "note", board: guitar, length: 3, seed: 51 });
    const engine = new PracticeEngine(drill.sequence);
    engine.start(10);

    const first = engine.submitNote({ midi: drill.sequence.steps[0]!.midi, time: 11.5 })!;
    expect(first.reactionSeconds).toBeCloseTo(1.5, 3);

    // The clock restarts when the next target appears.
    const second = engine.submitNote({ midi: drill.sequence.steps[1]!.midi, time: 12.3 })!;
    expect(second.reactionSeconds).toBeCloseTo(0.8, 3);
  });

  it("records reaction time in the history", () => {
    const drill = generateDrill({ kind: "note", board: guitar, length: 2, seed: 61 });
    const engine = new PracticeEngine(drill.sequence);
    engine.start(0);
    engine.submitNote({ midi: drill.sequence.steps[0]!.midi, time: 2 });
    expect(engine.history[0]!.reactionSeconds).toBeCloseTo(2, 3);
  });
});

describe("target descriptions", () => {
  it("names the string and fret for a position target", () => {
    const drill = generateDrill({
      kind: "fret", board: bass, length: 1, seed: 71, strings: [1], fretRange: [7, 7],
      uniquePositionsOnly: false,
    });
    const step = drill.sequence.steps[0]!;
    expect(describeTarget(step, bass)).toContain("fret 7");
    expect(describeTarget(step, bass)).toContain("A1 string");
  });

  it("falls back to the note name without a position", () => {
    const drill = generateDrill({ kind: "note", board: guitar, length: 1, seed: 81 });
    const step = drill.sequence.steps[0]!;
    expect(describeTarget(step, guitar)).toBe(step.label);
    expect(describeNote(step)).toMatch(/^[A-G]#?\d$/);
  });
});

describe("scoring with position errors", () => {
  it("counts a wrong position against accuracy", () => {
    const drill = generateDrill({
      kind: "fret", board: guitar, length: 4, seed: 91, uniquePositionsOnly: false,
    });
    const engine = new PracticeEngine(drill.sequence, { requirePosition: true });
    engine.start(0);
    const step = drill.sequence.steps[0]!;
    engine.submitNote({
      midi: step.midi, time: 1,
      position: { string: (step.position!.string + 1) % 6, fret: step.position!.fret },
    });
    expect(engine.summary.wrong).toBe(1);
    expect(engine.summary.correct).toBe(0);
  });
});

describe("open strings", () => {
  it("can drill open strings specifically", () => {
    const drill = generateDrill({
      kind: "fret", board: guitar, length: 12, seed: 101, fretRange: [0, 0],
      uniquePositionsOnly: false,
    });
    for (const step of drill.sequence.steps) {
      expect(step.position!.fret).toBe(0);
      const open = noteAt(guitar, step.position!.string, 0)!;
      expect(step.midi).toBe(open.midi);
    }
    expect(drill.sequence.steps.map((s) => s.midi)).toContain(noteToMidi("E2"));
  });
});
