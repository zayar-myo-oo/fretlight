import { describe, expect, it } from "vitest";
import {
  ChordStabilizer, detectChord, detectKey, findDiatonicChord, getDiatonicChords,
  getDiatonicSevenths, getKey, getMajorScale, getMinorScale, matchChord,
} from "./key-detection";

describe("scales", () => {
  it("spells keys correctly", () => {
    expect(getMajorScale("C").notes).toEqual(["C", "D", "E", "F", "G", "A", "B"]);
    expect(getMajorScale("D").notes).toEqual(["D", "E", "F#", "G", "A", "B", "C#"]);
    expect(getMajorScale("Db").notes).toEqual(["Db", "Eb", "F", "Gb", "Ab", "Bb", "C"]);
    expect(getMinorScale("A").notes).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(getKey(6, "major").notes[0]).toBe("F#");
  });
});

describe("diatonic chords", () => {
  it("C major triads and sevenths", () => {
    const key = getMajorScale("C");
    expect(getDiatonicChords(key).map((c) => `${c.roman} ${c.symbol}`)).toEqual([
      "I C", "ii Dm", "iii Em", "IV F", "V G", "vi Am", "vii° Bdim",
    ]);
    expect(getDiatonicSevenths(key).map((c) => `${c.roman} ${c.symbol}`)).toEqual([
      "Imaj7 Cmaj7", "ii7 Dm7", "iii7 Em7", "IVmaj7 Fmaj7", "V7 G7", "vi7 Am7", "viiø7 Bm7b5",
    ]);
  });
  it("G7 details", () => {
    const g7 = getDiatonicSevenths(getMajorScale("C"))[4]!;
    expect(g7.notes).toEqual(["G", "B", "D", "F"]);
    expect(g7.formula).toBe("1 3 5 b7");
  });
  it("minor key romans", () => {
    expect(getDiatonicChords(getMinorScale("A")).map((c) => c.roman)).toEqual([
      "i", "ii°", "III", "iv", "v", "VI", "VII",
    ]);
  });
  it("finds a chord's roman numeral in a key", () => {
    expect(findDiatonicChord(getMajorScale("C"), [7, 11, 2, 5])?.roman).toBe("V7");
  });
});

describe("detectKey", () => {
  it("never claims a key from one note", () => {
    const r = detectKey([0]);
    expect(r.determined).toBe(false);
    expect(r.best).toBeNull();
    expect(r.candidates.map((c) => c.key.name)).toContain("F Major");
  });
  it("C E G -> C Major", () => {
    const r = detectKey([0, 4, 7]);
    expect(r.best?.key.name).toBe("C Major");
    expect(r.best!.confidence).toBeGreaterThan(0.8);
  });
  it("A C E -> A Minor", () => {
    expect(detectKey([9, 0, 4]).best?.key.name).toBe("A Minor");
  });
  it("supports every root", () => {
    for (let root = 0; root < 12; root++) {
      const triad = [0, 4, 7].map((i) => (root + i) % 12);
      expect(detectKey(triad).best?.key.root).toBe(root);
    }
  });
  it("lowers confidence for few notes", () => {
    expect(detectKey([0, 7]).best!.confidence).toBeLessThan(0.6);
  });
});

describe("detectChord", () => {
  it("finds triads and sevenths", () => {
    expect(detectChord([0, 4, 7])[0]?.symbol).toBe("C");
    expect(detectChord([9, 0, 4])[0]?.symbol).toBe("Am");
    expect(detectChord([7, 11, 2, 5])[0]?.symbol).toBe("G7");
    expect(detectChord([0, 4, 7, 11])[0]?.symbol).toBe("Cmaj7");
  });
  it("returns nothing for silence", () => {
    expect(matchChord(new Array(12).fill(0))).toEqual([]);
  });
});

describe("ChordStabilizer", () => {
  it("only switches after consecutive stable frames", () => {
    const s = new ChordStabilizer(3, 0.7);
    const c = detectChord([0, 4, 7])[0]!;
    const g = detectChord([7, 11, 2])[0]!;
    expect(s.push(c)).toBeNull();
    expect(s.push(c)).toBeNull();
    expect(s.push(c)?.symbol).toBe("C");
    expect(s.push(g)?.symbol).toBe("C");
    expect(s.push(g)?.symbol).toBe("C");
    expect(s.push(g)?.symbol).toBe("G");
  });
});
