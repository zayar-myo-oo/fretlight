import { describe, expect, it } from "vitest";
import { harmonicFunctionOf } from "./harmonic-function";
import { getScale } from "./scales";

describe("harmonicFunctionOf", () => {
  it("labels every degree of a major scale correctly", () => {
    const scale = getScale("C", "major")!;
    const expected = ["Tonic", "Supertonic", "Mediant", "Subdominant", "Dominant", "Submediant", "Leading Tone"];
    scale.notes.forEach((note, i) => {
      expect(harmonicFunctionOf(note, scale.notes.length)).toBe(expected[i]);
    });
  });

  it("calls the 7th degree a subtonic in natural minor, not a leading tone", () => {
    const scale = getScale("A", "natural_minor")!;
    const seventh = scale.notes[6]!;
    expect(harmonicFunctionOf(seventh, scale.notes.length)).toBe("Subtonic");
  });

  it("calls the 7th degree a leading tone in harmonic minor", () => {
    const scale = getScale("A", "harmonic_minor")!;
    const seventh = scale.notes[6]!;
    expect(harmonicFunctionOf(seventh, scale.notes.length)).toBe("Leading Tone");
  });

  it("returns null for a scale that is not 7 notes — the label would not hold up", () => {
    const pentatonic = getScale("A", "minor_pentatonic")!;
    for (const note of pentatonic.notes) {
      expect(harmonicFunctionOf(note, pentatonic.notes.length)).toBeNull();
    }
  });
});
