import { describe, expect, it } from "vitest";
import { getArpeggio } from "./arpeggio";
import { CHORD_IDS, chordsWithin, getChord, getChordNotes } from "./chords";
import { SCALES, SCALE_IDS, getScale, getScaleNotes } from "./scales";
import { formatNote } from "./pitch";

describe("scales", () => {
  it("builds A minor pentatonic exactly as the spec states", () => {
    expect(getScaleNotes("A", "minor_pentatonic")).toEqual(["A", "C", "D", "E", "G"]);
    expect(getScale("A", "minor_pentatonic")!.notes.map((n) => n.degree)).toEqual([
      "1", "b3", "4", "5", "b7",
    ]);
  });

  it("builds E minor pentatonic — the success-criteria example", () => {
    expect(getScaleNotes("E", "minor_pentatonic")).toEqual(["E", "G", "A", "B", "D"]);
  });

  it("builds C major with no accidentals", () => {
    expect(getScaleNotes("C", "major")).toEqual(["C", "D", "E", "F", "G", "A", "B"]);
  });

  it("keeps every definition internally consistent", () => {
    for (const id of SCALE_IDS) {
      const definition = SCALES[id];
      expect(definition.intervals.length).toBe(definition.degrees.length);
      expect(definition.intervals[0]).toBe(0);
      // strictly ascending, within one octave
      for (let i = 1; i < definition.intervals.length; i++) {
        expect(definition.intervals[i]!).toBeGreaterThan(definition.intervals[i - 1]!);
        expect(definition.intervals[i]!).toBeLessThan(12);
      }
    }
  });

  it("treats the modes as rotations of the major scale", () => {
    const major = new Set(getScale("C", "major")!.pitchClasses);
    const dorian = new Set(getScale("D", "dorian")!.pitchClasses);
    expect([...dorian].sort()).toEqual([...major].sort());
  });

  it("rejects an unparseable root", () => {
    expect(getScale("H", "major")).toBeNull();
  });
});

describe("chords", () => {
  it("builds the chord types the spec requires", () => {
    expect(getChordNotes("A", "minor")).toEqual(["A", "C", "E"]);
    expect(getChordNotes("A", "major")).toEqual(["A", "C#", "E"]);
    expect(getChordNotes("E", "power")).toEqual(["E", "B"]);
    expect(getChordNotes("G", "dom7")).toEqual(["G", "B", "D", "F"]);
    expect(getChordNotes("C", "maj7")).toEqual(["C", "E", "G", "B"]);
    expect(getChordNotes("A", "min7")).toEqual(["A", "C", "E", "G"]);
    expect(getChordNotes("D", "sus2")).toEqual(["D", "E", "A"]);
    expect(getChordNotes("D", "sus4")).toEqual(["D", "G", "A"]);
  });

  it("renders symbols the way players write them", () => {
    expect(getChord("A", "minor")!.symbol).toBe("Am");
    expect(getChord("A", "min7")!.symbol).toBe("Am7");
    expect(getChord("E", "power")!.symbol).toBe("E5");
    expect(getChord("C", "major")!.symbol).toBe("C");
  });

  it("keeps every definition internally consistent", () => {
    for (const id of CHORD_IDS) {
      const chord = getChord("C", id)!;
      expect(chord.definition.intervals.length).toBe(chord.definition.degrees.length);
      expect(chord.tones[0]!.interval).toBe(0);
    }
  });

  it("finds the diatonic triads inside C major", () => {
    const scale = getScale("C", "major")!;
    const found = chordsWithin(scale.pitchClasses, ["major", "minor", "dim"]);
    const symbols = found.map((c) => c.symbol).sort();
    expect(symbols).toContain("C");
    expect(symbols).toContain("Dm");
    expect(symbols).toContain("Em");
    expect(symbols).toContain("F");
    expect(symbols).toContain("G");
    expect(symbols).toContain("Am");
    expect(symbols).toContain("Bdim");
    expect(found.filter((c) => c.definition.id !== "dim").length).toBe(6);
  });
});

describe("arpeggios", () => {
  it("spells A minor 7 as A C E G plus the octave root", () => {
    const steps = getArpeggio("A", "min7", { startOctave: 2 });
    expect(steps.map((s) => s.name)).toEqual(["A", "C", "E", "G", "A"]);
    expect(steps.map((s) => s.degree)).toEqual(["1", "b3", "5", "b7", "1"]);
    expect(steps.map((s) => formatNote(s.midi))).toEqual(["A2", "C3", "E3", "G3", "A3"]);
  });

  it("ascends monotonically in pitch", () => {
    const steps = getArpeggio("E", "maj7", { startOctave: 1, octaves: 2 });
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.midi).toBeGreaterThan(steps[i - 1]!.midi);
    }
  });

  it("mirrors correctly when played up and down", () => {
    const upDown = getArpeggio("A", "minor", { direction: "up_down" });
    expect(upDown[0]!.midi).toBe(upDown[upDown.length - 1]!.midi);
  });
});
