import { describe, expect, it } from "vitest";
import { noteToMidi } from "../theory/pitch";
import { TUNINGS, tuningMidi, tuningsFor } from "./tunings";

describe("tunings", () => {
  it("every tuning is well formed and rises from low to high string", () => {
    for (const tuning of TUNINGS) {
      expect(tuning.strings, tuning.id).toHaveLength(tuning.stringCount);
      const midi = tuningMidi(tuning);
      expect(midi.every((m) => Number.isFinite(m)), tuning.id).toBe(true);
      for (let i = 1; i < midi.length; i++) expect(midi[i]!, tuning.id).toBeGreaterThan(midi[i - 1]!);
    }
  });

  it("has unique ids", () => {
    expect(new Set(TUNINGS.map((t) => t.id)).size).toBe(TUNINGS.length);
  });

  it("offers the common guitar alternates", () => {
    const names = tuningsFor("guitar", 6).map((t) => t.name);
    for (const wanted of ["Standard", "Drop D", "Drop C", "D Standard", "Open G", "Open D"]) expect(names).toContain(wanted);
    expect(names.some((n) => n.startsWith("Eb Standard"))).toBe(true);
  });

  it("spells open tunings correctly", () => {
    const openG = TUNINGS.find((t) => t.id === "guitar-6-open-g")!;
    expect(tuningMidi(openG)).toEqual(["D2", "G2", "D3", "G3", "B3", "D4"].map((n) => noteToMidi(n)));
  });

  it("supports 4, 5 and 6 string bass", () => {
    expect(tuningsFor("bass", 4).length).toBeGreaterThan(0);
    expect(tuningsFor("bass", 5).length).toBeGreaterThan(0);
    expect(tuningsFor("bass", 6).length).toBeGreaterThan(0);
  });
});
