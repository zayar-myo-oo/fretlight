import { describe, expect, it } from "vitest";
import { formatNote, noteToFrequency } from "../theory/pitch";
import { getScale } from "../theory/scales";
import { getChord } from "../theory/chords";
import {
  createFretboard,
  getChordPositions,
  getFretPositions,
  getPentatonicPositions,
  getScalePositions,
  getScaleShapes,
  noteAt,
} from "./fretboard";
import { TUNINGS, defaultTuning, getTuning, tuningMidi } from "./tunings";

const guitar = createFretboard(getTuning("guitar-6-standard")!, 22);
const bass4 = createFretboard(getTuning("bass-4-standard")!, 20);
const bass5 = createFretboard(getTuning("bass-5-standard")!, 22);

describe("tunings", () => {
  it("has parseable strings in ascending pitch order", () => {
    for (const tuning of TUNINGS) {
      const midi = tuningMidi(tuning);
      expect(midi.length).toBe(tuning.stringCount);
      for (let i = 1; i < midi.length; i++) {
        expect(midi[i]!).toBeGreaterThan(midi[i - 1]!);
      }
    }
  });

  it("matches the open-string frequencies named in the spec", () => {
    const strings = getTuning("bass-4-standard")!.strings;
    expect(strings).toEqual(["E1", "A1", "D2", "G2"]);
    expect(noteToFrequency("E1")!).toBeCloseTo(41.2, 2);
    expect(getTuning("bass-5-standard")!.strings[0]).toBe("B0");
  });

  it("falls back to the standard tuning per instrument", () => {
    expect(defaultTuning("bass", 4).id).toBe("bass-4-standard");
    expect(defaultTuning("guitar", 7).id).toBe("guitar-7-standard");
  });
});

describe("noteAt", () => {
  it("knows the open strings", () => {
    expect(formatNote(noteAt(guitar, 0, 0)!.midi)).toBe("E2");
    expect(formatNote(noteAt(guitar, 5, 0)!.midi)).toBe("E4");
    expect(formatNote(noteAt(bass4, 0, 0)!.midi)).toBe("E1");
  });

  it("puts the 5th fret of the low E on A", () => {
    expect(formatNote(noteAt(guitar, 0, 5)!.midi)).toBe("A2");
    expect(formatNote(noteAt(bass4, 0, 5)!.midi)).toBe("A1");
  });

  it("puts the 12th fret an octave above the open string", () => {
    for (let s = 0; s < guitar.stringCount; s++) {
      expect(noteAt(guitar, s, 12)!.midi).toBe(noteAt(guitar, s, 0)!.midi + 12);
    }
  });

  it("returns null outside the neck", () => {
    expect(noteAt(guitar, 0, -1)).toBeNull();
    expect(noteAt(guitar, 0, 99)).toBeNull();
    expect(noteAt(guitar, 9, 0)).toBeNull();
  });
});

describe("getFretPositions", () => {
  it("finds every E on a standard guitar, including the spec's examples", () => {
    const positions = getFretPositions(guitar, 4); // E
    const lowE = positions.filter((p) => p.string === 0).map((p) => p.fret);
    expect(lowE).toContain(0);
    expect(lowE).toContain(12);
    expect(positions.filter((p) => p.string === 1).map((p) => p.fret)).toContain(7);
    expect(positions.filter((p) => p.string === 2).map((p) => p.fret)).toContain(2);
    expect(positions.filter((p) => p.string === 3).map((p) => p.fret)).toContain(9);
  });

  it("can restrict to one octave", () => {
    const anyOctave = getFretPositions(bass4, 4);
    const exact = getFretPositions(bass4, 28, { exactOctave: true }); // E1
    expect(exact.length).toBeLessThan(anyOctave.length);
    expect(exact.every((p) => p.midi === 28)).toBe(true);
  });
});

describe("scale and chord overlays", () => {
  it("only marks notes that belong to the scale", () => {
    const scale = getScale("A", "minor_pentatonic")!;
    const positions = getScalePositions(guitar, scale);
    expect(positions.length).toBeGreaterThan(0);
    for (const position of positions) {
      expect(scale.pitchClasses.has(position.pitchClass)).toBe(true);
    }
    expect(positions.filter((p) => p.isRoot).every((p) => p.name === "A")).toBe(true);
  });

  it("labels chord tones with their degree", () => {
    const chord = getChord("A", "minor")!;
    const positions = getChordPositions(guitar, chord);
    const degrees = new Set(positions.map((p) => p.degree));
    expect([...degrees].sort()).toEqual(["1", "5", "b3"]);
  });
});

describe("generated scale shapes", () => {
  it("reproduces pentatonic box 1 for A minor on a standard guitar", () => {
    const scale = getScale("A", "minor_pentatonic")!;
    const [box1] = getPentatonicPositions(guitar, scale, 1);
    expect(box1).toBeDefined();
    const byString = box1!.positions.reduce<Record<number, number[]>>((acc, p) => {
      (acc[p.string] ??= []).push(p.fret);
      return acc;
    }, {});
    // The shape every guitarist learns first: 5-8, 5-7, 5-7, 5-7, 5-8, 5-8.
    expect(byString[0]).toEqual([5, 8]);
    expect(byString[1]).toEqual([5, 7]);
    expect(byString[2]).toEqual([5, 7]);
    expect(byString[3]).toEqual([5, 7]);
    expect(byString[4]).toEqual([5, 8]);
    expect(byString[5]).toEqual([5, 8]);
  });

  it("reproduces pentatonic box 2 for A minor", () => {
    const scale = getScale("A", "minor_pentatonic")!;
    const box2 = getPentatonicPositions(guitar, scale, 1)[1]!;
    const byString = box2.positions.reduce<Record<number, number[]>>((acc, p) => {
      (acc[p.string] ??= []).push(p.fret);
      return acc;
    }, {});
    expect(byString[0]).toEqual([8, 10]);
    expect(byString[1]).toEqual([7, 10]);
    expect(byString[2]).toEqual([7, 10]);
    expect(byString[3]).toEqual([7, 9]);
    expect(byString[4]).toEqual([8, 10]);
    expect(byString[5]).toEqual([8, 10]);
  });

  it("produces one shape per scale degree", () => {
    const scale = getScale("A", "minor_pentatonic")!;
    expect(getPentatonicPositions(guitar, scale, 1).length).toBe(5);
  });

  it("ascends in pitch, which is what makes a shape a practice path", () => {
    const scale = getScale("E", "minor_pentatonic")!;
    for (const shape of getPentatonicPositions(guitar, scale, 1)) {
      for (let i = 1; i < shape.positions.length; i++) {
        expect(shape.positions[i]!.midi).toBeGreaterThan(shape.positions[i - 1]!.midi);
      }
    }
  });

  it("works unchanged on 4- and 5-string bass", () => {
    const scale = getScale("E", "minor_pentatonic")!;
    for (const board of [bass4, bass5]) {
      const shapes = getPentatonicPositions(board, scale, 0);
      expect(shapes.length).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.positions.length).toBe(board.stringCount * 2);
        for (const position of shape.positions) {
          expect(scale.pitchClasses.has(position.pitchClass)).toBe(true);
          expect(position.fret).toBeGreaterThanOrEqual(0);
          expect(position.fret).toBeLessThanOrEqual(board.fretCount);
        }
      }
    }
  });

  it("uses three notes per string for seven-note scales", () => {
    const scale = getScale("G", "major")!;
    const shape = getScaleShapes(guitar, scale, { startFret: 1 })[0]!;
    expect(shape.positions.length).toBe(guitar.stringCount * 3);
  });
});
