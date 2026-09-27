import { describe, expect, it } from "vitest";
import { PositionEstimator } from "./position-estimator";
import { createFretboard, noteAt } from "./fretboard";
import { getTuning } from "./tunings";
import { noteToMidi } from "../theory/pitch";

const bass = createFretboard(getTuning("bass-4-standard")!, 20);
const guitar = createFretboard(getTuning("guitar-6-standard")!, 22);

describe("candidate generation", () => {
  it("finds every place an A2 can be played on a bass", () => {
    const estimator = new PositionEstimator(bass);
    const candidates = estimator.candidatesFor(noteToMidi("A2")!);
    // A2 = 45. Open strings E1(28) A1(33) D2(38) G2(43): frets 17, 12, 7, 2.
    expect(candidates.map((c) => `${c.string}:${c.fret}`)).toEqual([
      "0:17", "1:12", "2:7", "3:2",
    ]);
  });

  it("returns nothing for a pitch the instrument cannot produce", () => {
    const estimator = new PositionEstimator(bass);
    expect(estimator.candidatesFor(noteToMidi("C0")!)).toEqual([]);
  });
});

describe("choosing one position instead of highlighting them all", () => {
  it("returns a single best position, not every match", () => {
    const estimator = new PositionEstimator(guitar);
    const { best, candidates } = estimator.estimate(noteToMidi("A2")!);
    expect(best).not.toBeNull();
    expect(candidates.length).toBeGreaterThan(1);
    // The point of the whole class: one answer out of many possibilities.
    expect(best!.string).toBe(candidates[0]!.string);
    expect(best!.fret).toBe(candidates[0]!.fret);
  });

  it("prefers a playable low position with no other evidence", () => {
    const estimator = new PositionEstimator(guitar);
    const { best } = estimator.estimate(noteToMidi("A2")!);
    // A2 on a standard guitar: low E fret 5, or A string open. Both are low.
    expect(best!.fret).toBeLessThanOrEqual(5);
  });
});

describe("temporal continuity — the hand does not teleport", () => {
  it("keeps playing near where it just was", () => {
    const estimator = new PositionEstimator(guitar);
    // Establish a position high on the neck: D3 at string 0 fret 10.
    estimator.estimate(noteToMidi("D3")!, { expected: { string: 0, fret: 10 } }, 1000);
    expect(estimator.held!.fret).toBe(10);

    // Now an A2, which is playable at fret 5 on the low E or open on the A.
    // Neither is adjacent, but the closest reachable one should win over the
    // nominally "easiest" one.
    const { best } = estimator.estimate(noteToMidi("B2")!, {}, 1200);
    expect(Math.abs(best!.fret - 10)).toBeLessThanOrEqual(7);
  });

  it("does not oscillate between equivalent positions on a repeated note", () => {
    const estimator = new PositionEstimator(guitar);
    const midi = noteToMidi("A2")!;
    const chosen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const { best } = estimator.estimate(midi, {}, 1000 + i * 60);
      chosen.push(`${best!.string}:${best!.fret}`);
    }
    // Every frame must agree — this is the flicker the spec calls out.
    expect(new Set(chosen).size).toBe(1);
  });

  it("forgets a stale position after a long silence", () => {
    const estimator = new PositionEstimator(guitar, { memoryMs: 500 });
    estimator.estimate(noteToMidi("D3")!, { expected: { string: 0, fret: 10 } }, 1000);
    expect(estimator.held).not.toBeNull();
    estimator.estimate(noteToMidi("A2")!, {}, 5000);
    // With the old position forgotten, playability decides again.
    expect(estimator.held!.fret).toBeLessThanOrEqual(5);
  });
});

describe("hysteresis", () => {
  it("holds position unless a rival is clearly better", () => {
    const estimator = new PositionEstimator(guitar, { stickiness: 0.4 });
    const midi = noteToMidi("A2")!;
    estimator.estimate(midi, { expected: { string: 0, fret: 5 } }, 1000);
    const held = `${estimator.held!.string}:${estimator.held!.fret}`;

    // A weak hint the other way must not be enough to move it.
    const { best } = estimator.estimate(midi, { stringHint: { string: 1, confidence: 0.3 } }, 1100);
    expect(`${best!.string}:${best!.fret}`).toBe(held);
  });

  it("does move when the evidence is strong", () => {
    const estimator = new PositionEstimator(guitar, { stickiness: 0.05 });
    const midi = noteToMidi("A2")!;
    estimator.estimate(midi, { expected: { string: 0, fret: 5 } }, 1000);
    const { best } = estimator.estimate(midi, { expected: { string: 1, fret: 0 } }, 1100);
    expect(best!.string).toBe(1);
    expect(best!.fret).toBe(0);
  });
});

describe("hand position — the thing that makes it correct", () => {
  const play = (positions: [number, number][], handFret: number | null) => {
    const estimator = new PositionEstimator(guitar);
    let right = 0;
    positions.forEach(([string, fret], i) => {
      const note = noteAt(guitar, string, fret)!;
      const { best } = estimator.estimate(
        note.midi,
        handFret === null ? {} : { handFret: { fret: handFret, confidence: 0.9 } },
        1000 + i * 400,
      );
      if (best!.string === string && best!.fret === fret) right++;
    });
    return right;
  };

  const fifthPosition: [number, number][] = [[0, 5], [0, 7], [1, 5], [1, 7], [2, 5], [2, 7]];
  const twelfth: [number, number][] = [[0, 12], [1, 12], [2, 12], [3, 12], [4, 12], [5, 12]];
  // A minor pentatonic box 1 — the single most-played shape on the instrument.
  const box1: [number, number][] = [
    [0, 5], [0, 8], [1, 5], [1, 7], [2, 5], [2, 7],
    [3, 5], [3, 7], [4, 5], [4, 8], [5, 5], [5, 8],
  ];

  it("places mid-neck playing only partly without a hand position", () => {
    // The opening notes of a phrase are genuinely ambiguous — an A2 on the low E
    // at fret 5 and the open A string are the same waveform — so the estimator
    // cannot get them all. It should still recover as the phrase establishes
    // where the hand is, rather than reporting the nut throughout.
    expect(play(fifthPosition, null)).toBeGreaterThanOrEqual(3);
    expect(play(box1, null)).toBeGreaterThanOrEqual(6);
  });

  it("places it exactly once the hand position is known", () => {
    expect(play(fifthPosition, 6)).toBe(fifthPosition.length);
    expect(play(twelfth, 12)).toBe(twelfth.length);
    expect(play(box1, 6)).toBe(box1.length);
  });

  it("still gets open position right, with or without a hint", () => {
    const open: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
    expect(play(open, null)).toBe(open.length);
    expect(play(open, 0)).toBe(open.length);
  });

  it("keeps open strings cheap from any position", () => {
    // Players reach for open strings constantly without leaving the position
    // they are in, so a hand anchored high must not make them expensive.
    const estimator = new PositionEstimator(guitar);
    const openA = noteAt(guitar, 1, 0)!;
    const { best } = estimator.estimate(
      openA.midi,
      { handFret: { fret: 12, confidence: 0.9 } },
      1000,
    );
    // Either the open string itself or something near the hand — never a
    // nonsensical far-away position.
    expect(best!.fret === 0 || Math.abs(best!.fret - 12) <= 6).toBe(true);
  });

  it("respects a narrower hand span", () => {
    const estimator = new PositionEstimator(guitar, { handSpan: 3 });
    const note = noteAt(guitar, 0, 5)!;
    const { best } = estimator.estimate(
      note.midi,
      { handFret: { fret: 5, confidence: 0.9 }, handSpan: 3 },
      1000,
    );
    expect(best!.string).toBe(0);
    expect(best!.fret).toBe(5);
  });
});

describe("camera evidence", () => {
  it("follows the fretting hand when the camera can see it", () => {
    const estimator = new PositionEstimator(guitar);
    const midi = noteToMidi("A3")!;
    const { best } = estimator.estimate(midi, { handFret: { fret: 14, confidence: 0.85 } }, 1000);
    expect(Math.abs(best!.fret - 14)).toBeLessThanOrEqual(3);
  });

  it("ignores a low-confidence hand reading", () => {
    const estimator = new PositionEstimator(guitar);
    const midi = noteToMidi("A3")!;
    const { best } = estimator.estimate(midi, { handFret: { fret: 17, confidence: 0.05 } }, 1000);
    expect(best!.fret).toBeLessThan(17);
  });

  it("uses a string hint when string detection is confident", () => {
    const estimator = new PositionEstimator(bass);
    const midi = noteToMidi("A2")!;
    const { best } = estimator.estimate(midi, { stringHint: { string: 2, confidence: 0.9 } }, 1000);
    expect(best!.string).toBe(2);
    expect(best!.fret).toBe(7);
  });
});

describe("board changes", () => {
  it("forgets its position when the instrument changes", () => {
    const estimator = new PositionEstimator(guitar);
    estimator.estimate(noteToMidi("A2")!, {}, 1000);
    expect(estimator.held).not.toBeNull();
    estimator.setBoard(bass);
    expect(estimator.held).toBeNull();
  });
});
