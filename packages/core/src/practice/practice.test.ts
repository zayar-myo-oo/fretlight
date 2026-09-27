import { describe, expect, it } from "vitest";
import { PracticeEngine } from "./practice-engine";
import { sequenceFromArpeggio, sequenceFromScale } from "./sequence";
import { scorePractice } from "./scoring";
import { getScale } from "../theory/scales";
import { createFretboard } from "../instrument/fretboard";
import { getTuning } from "../instrument/tunings";
import { noteToMidi } from "../theory/pitch";

const aMinorPentatonic = getScale("A", "minor_pentatonic")!;
const bass = createFretboard(getTuning("bass-4-standard")!, 20);

describe("sequence building", () => {
  it("turns a scale into an ascending exercise that resolves on the root", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, { startOctave: 2 });
    expect(sequence.steps.map((s) => s.label)).toEqual(["A", "C", "D", "E", "G", "A"]);
    expect(sequence.steps[0]!.midi).toBe(noteToMidi("A2"));
    expect(sequence.steps[5]!.midi).toBe(noteToMidi("A3"));
  });

  it("suggests fingerings that stay in one area of the neck", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, { board: bass, startOctave: 1 });
    const frets = sequence.steps.map((s) => s.position?.fret).filter((f): f is number => f !== undefined);
    expect(frets.length).toBe(sequence.steps.length);
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(7);
  });

  it("stamps expected times onto timed exercises only", () => {
    const free = sequenceFromScale(aMinorPentatonic, { mode: "free" });
    expect(free.steps[1]!.expectedTime).toBeUndefined();

    const timed = sequenceFromScale(aMinorPentatonic, { mode: "timed", bpm: 120 });
    expect(timed.steps[0]!.expectedTime).toBe(0);
    expect(timed.steps[1]!.expectedTime).toBeCloseTo(0.5, 6);
  });

  it("builds an arpeggio exercise", () => {
    const sequence = sequenceFromArpeggio("A", "min7", { startOctave: 2 });
    expect(sequence.steps.map((s) => s.label)).toEqual(["A", "C", "E", "G", "A"]);
    expect(sequence.steps.map((s) => s.degree)).toEqual(["1", "b3", "5", "b7", "1"]);
  });
});

describe("PracticeEngine — the spec's pentatonic trainer example", () => {
  const play = (engine: PracticeEngine, name: string, time = 0) =>
    engine.submitNote({ midi: noteToMidi(name)!, time });

  it("accepts A C D E, rejects F, and still expects G", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, { startOctave: 2 });
    const engine = new PracticeEngine(sequence);
    engine.start(0);

    expect(play(engine, "A2")!.verdict).toBe("correct");
    expect(play(engine, "C3")!.verdict).toBe("correct");
    expect(play(engine, "D3")!.verdict).toBe("correct");
    expect(play(engine, "E3")!.verdict).toBe("correct");

    const wrong = play(engine, "F3")!;
    expect(wrong.verdict).toBe("wrong");
    // the engine holds position so the player can correct themselves
    expect(wrong.nextStep!.label).toBe("G");
    expect(engine.currentStep!.label).toBe("G");

    expect(play(engine, "G3")!.verdict).toBe("correct");
  });

  it("accepts the right note in the wrong octave by default", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, { startOctave: 2 });
    const engine = new PracticeEngine(sequence);
    engine.start(0);
    expect(play(engine, "A4")!.verdict).toBe("correct");
  });

  it("can demand the exact octave when the exercise calls for it", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, { startOctave: 2 });
    const engine = new PracticeEngine(sequence, { matchOctave: true });
    engine.start(0);
    expect(play(engine, "A4")!.verdict).toBe("wrong");
    expect(play(engine, "A2")!.verdict).toBe("correct");
  });

  it("records a skipped note when the player jumps ahead", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, { startOctave: 2 });
    const engine = new PracticeEngine(sequence);
    engine.start(0);
    play(engine, "A2");
    const jump = play(engine, "D3")!; // skipped C
    expect(jump.verdict).toBe("skipped");
    expect(engine.currentStep!.label).toBe("E");
    expect(engine.history.filter((r) => r.verdict === "skipped").length).toBe(1);
  });

  it("completes and reports 100% for a clean run", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, { startOctave: 2 });
    const engine = new PracticeEngine(sequence);
    engine.start(0);
    for (const step of sequence.steps) engine.submitNote({ midi: step.midi, time: 0 });
    expect(engine.isComplete).toBe(true);
    expect(engine.summary.pitchAccuracy).toBe(1);
    expect(engine.summary.correct).toBe(sequence.steps.length);
  });

  it("ignores notes once stopped", () => {
    const sequence = sequenceFromScale(aMinorPentatonic);
    const engine = new PracticeEngine(sequence);
    engine.start(0);
    engine.stop();
    expect(play(engine, "A2")).toBeNull();
  });
});

describe("PracticeEngine — timed mode", () => {
  it("grades timing against the click", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, {
      mode: "timed",
      bpm: 120,
      startOctave: 2,
    });
    const engine = new PracticeEngine(sequence);
    engine.start(0);

    const onTime = engine.submitNote({ midi: sequence.steps[0]!.midi, time: 0.01 })!;
    expect(onTime.timing!.verdict).toBe("on_time");

    const late = engine.submitNote({ midi: sequence.steps[1]!.midi, time: 0.62 })!;
    expect(late.timing!.verdict).toBe("late");
    expect(late.timing!.deltaBeats).toBeCloseTo(0.24, 2);
  });

  it("moves on when a step's window closes with nothing played", () => {
    const sequence = sequenceFromScale(aMinorPentatonic, { mode: "timed", bpm: 120 });
    const engine = new PracticeEngine(sequence);
    engine.start(0);
    expect(engine.tick(0.1)).toBeNull();
    const missed = engine.tick(0.4)!;
    expect(missed.verdict).toBe("skipped");
    expect(engine.currentIndex).toBe(1);
  });
});

describe("scoring", () => {
  it("weights pitch above timing", () => {
    const perfect = scorePractice({ correct: 10, wrong: 0, skipped: 0, total: 10, timingSamples: [1, 1] });
    expect(perfect.overall).toBe(1);

    const sloppyTiming = scorePractice({
      correct: 10, wrong: 0, skipped: 0, total: 10, timingSamples: [0.5, 0.5],
    });
    const wrongNotes = scorePractice({
      correct: 5, wrong: 5, skipped: 0, total: 10, timingSamples: [1, 1],
    });
    expect(wrongNotes.overall).toBeLessThan(sloppyTiming.overall);
  });

  it("treats an untimed exercise as timing-neutral", () => {
    const result = scorePractice({ correct: 8, wrong: 2, skipped: 0, total: 10, timingSamples: [] });
    expect(result.timingAccuracy).toBe(1);
    expect(result.pitchAccuracy).toBeCloseTo(0.8, 6);
  });

  it("does not divide by zero on an empty session", () => {
    const result = scorePractice({ correct: 0, wrong: 0, skipped: 0, total: 0, timingSamples: [] });
    expect(Number.isFinite(result.overall)).toBe(true);
  });
});
