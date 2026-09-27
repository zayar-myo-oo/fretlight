import { describe, expect, it } from "vitest";
import { PositionEstimator } from "./position-estimator";
import { createFretboard, noteAt } from "./fretboard";
import { getTuning } from "./tunings";
import { formatNote } from "../theory/pitch";

/**
 * The exact bug from the spec, §43.
 *
 * Playing the 5th fret of a bass E string produces A1 — and so does the open A
 * string. Reporting the open A is not a rounding error, it is the wrong answer
 * to the question the player asked ("where did I just play?"), and it is what
 * made the fretboard screen untrustworthy.
 *
 * These tests pin down what is achievable from audio and what is not, so the
 * distinction stays visible instead of being rediscovered later.
 */

const bass4 = createFretboard(getTuning("bass-4-standard")!, 20);
const guitar = createFretboard(getTuning("guitar-6-standard")!, 22);

/** Play a run of positions in order, as a player physically would. */
function playRun(
  board: ReturnType<typeof createFretboard>,
  run: readonly [number, number][],
  context: Parameters<PositionEstimator["estimate"]>[1] = {},
) {
  const estimator = new PositionEstimator(board);
  return run.map(([string, fret], index) => {
    const note = noteAt(board, string, fret)!;
    const { best, candidates } = estimator.estimate(note.midi, context, 1000 + index * 400);
    return {
      wanted: `${string}:${fret}`,
      got: `${best!.string}:${best!.fret}`,
      note: formatNote(note.midi),
      candidateCount: candidates.length,
      correct: best!.string === string && best!.fret === fret,
    };
  });
}

describe("the note is never enough — every position carries string, fret and octave", () => {
  it("distinguishes the two places A1 lives on a 4-string bass", () => {
    const estimator = new PositionEstimator(bass4);
    const a1 = noteAt(bass4, 0, 5)!; // E string, 5th fret
    expect(formatNote(a1.midi)).toBe("A1");

    const { candidates } = estimator.estimate(a1.midi, {}, 1000);
    const places = candidates.map((c) => `${c.string}:${c.fret}`).sort();
    // Exactly two: E string fret 5, and the open A string. Nothing else.
    expect(places).toEqual(["0:5", "1:0"]);
  });

  it("does not confuse A1 with A2 — octave is part of the identity", () => {
    const estimator = new PositionEstimator(bass4);
    const a1 = noteAt(bass4, 0, 5)!;
    const a2 = noteAt(bass4, 3, 2)!; // G string, 2nd fret

    expect(formatNote(a1.midi)).toBe("A1");
    expect(formatNote(a2.midi)).toBe("A2");
    expect(a1.midi).not.toBe(a2.midi);

    const low = estimator.candidatesFor(a1.midi).map((c) => `${c.string}:${c.fret}`);
    const high = estimator.candidatesFor(a2.midi).map((c) => `${c.string}:${c.fret}`);
    // No overlap: these are different events with different homes on the neck.
    expect(low.some((p) => high.includes(p))).toBe(false);
  });

  it("reports full identity, not just a letter", () => {
    const estimator = new PositionEstimator(bass4);
    const note = noteAt(bass4, 0, 5)!;
    const { best } = estimator.estimate(note.midi, {}, 1000);
    expect(best).toMatchObject({
      name: "A",
      octave: 1,
      midi: note.midi,
    });
    expect(typeof best!.string).toBe("number");
    expect(typeof best!.fret).toBe("number");
    expect(best!.score).toBeGreaterThan(0);
  });
});

describe("§43 — 5th fret on every string", () => {
  it("bass: names the right note at the 5th fret of each string", () => {
    const expected = ["A1", "D2", "G2", "C3"];
    for (let string = 0; string < bass4.stringCount; string++) {
      expect(formatNote(noteAt(bass4, string, 5)!.midi)).toBe(expected[string]);
    }
  });

  it("guitar: names the right note at the 5th fret of each string", () => {
    const expected = ["A2", "D3", "G3", "C4", "E4", "A4"];
    for (let string = 0; string < guitar.stringCount; string++) {
      expect(formatNote(noteAt(guitar, string, 5)!.midi)).toBe(expected[string]);
    }
  });

  it("places a run up the bass E string on the E string, not on open strings", () => {
    // A player working up one string — the case the old behaviour got wrong by
    // reporting the equivalent open string every time.
    const run: [number, number][] = [[0, 3], [0, 5], [0, 7], [0, 8], [0, 10]];
    const results = playRun(bass4, run);
    for (const result of results) {
      expect(result.got, `${result.note}: wanted ${result.wanted}`).toBe(result.wanted);
    }
  });

  it("places a run across the 5th fret of each bass string", () => {
    const run: [number, number][] = [[0, 5], [1, 5], [2, 5], [3, 5]];
    const results = playRun(bass4, run, { handFret: { fret: 5, confidence: 0.9 } });
    for (const result of results) {
      expect(result.got, `${result.note}: wanted ${result.wanted}`).toBe(result.wanted);
    }
  });

  it("places a guitar run across the 5th fret of each string", () => {
    const run: [number, number][] = [[0, 5], [1, 5], [2, 5], [3, 5], [4, 5], [5, 5]];
    const results = playRun(guitar, run, { handFret: { fret: 5, confidence: 0.9 } });
    for (const result of results) {
      expect(result.got, `${result.note}: wanted ${result.wanted}`).toBe(result.wanted);
    }
  });
});

describe("what audio alone can and cannot settle", () => {
  it("settles a fretted note once the player is already on that string", () => {
    // Second note onward: continuity does the work, no camera or hand hint.
    const run: [number, number][] = [[0, 3], [0, 5]];
    const results = playRun(bass4, run);
    expect(results[1]!.got).toBe("0:5");
  });

  it("cannot settle the very first note between two equivalent places", () => {
    // A1 is the open A string and the E string's 5th fret, and they are the
    // same waveform. With no previous note, no hand position and no camera,
    // there is no information to choose with — so the estimator must report low
    // confidence rather than pretend.
    const estimator = new PositionEstimator(bass4);
    const a1 = noteAt(bass4, 0, 5)!;
    const { best, candidates } = estimator.estimate(a1.midi, {}, 1000);

    expect(candidates.length).toBe(2);
    const runnerUp = candidates.find(
      (c) => c.string !== best!.string || c.fret !== best!.fret,
    )!;
    // The two are genuinely close — that closeness is the signal the UI needs
    // to show the alternative rather than assert one of them.
    expect(Math.abs(best!.score - runnerUp.score)).toBeLessThan(0.35);
  });

  it("settles it immediately when told where the hand is", () => {
    const estimator = new PositionEstimator(bass4);
    const a1 = noteAt(bass4, 0, 5)!;
    const { best } = estimator.estimate(a1.midi, { handFret: { fret: 5, confidence: 0.95 } }, 1000);
    expect(`${best!.string}:${best!.fret}`).toBe("0:5");
  });
});
