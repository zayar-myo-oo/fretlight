import { describe, expect, it } from "vitest";
import {
  calculateCents,
  formatNote,
  frequencyToMidi,
  frequencyToNote,
  midiToFrequency,
  midiToNote,
  noteToFrequency,
  noteToMidi,
  parseNoteName,
} from "./pitch";

describe("note <-> midi", () => {
  it("anchors on A4 = 69", () => {
    expect(noteToMidi("A4")).toBe(69);
    expect(midiToNote(69).name).toBe("A");
    expect(midiToNote(69).octave).toBe(4);
  });

  it("round-trips across the full instrument range", () => {
    for (let midi = 12; midi <= 108; midi++) {
      expect(noteToMidi(formatNote(midi))).toBe(midi);
    }
  });

  it("parses flats, sharps and negative octaves", () => {
    expect(noteToMidi("Bb1")).toBe(34);
    expect(noteToMidi("A#1")).toBe(34);
    expect(noteToMidi("C-1")).toBe(0);
    expect(parseNoteName("Gb")).toEqual({ pitchClass: 6, octave: null });
  });

  it("returns null rather than throwing on bad input", () => {
    expect(noteToMidi("H4")).toBeNull();
    expect(noteToMidi("")).toBeNull();
    expect(parseNoteName("wat")).toBeNull();
  });
});

describe("frequency conversion", () => {
  it("matches the published standard-tuning frequencies", () => {
    expect(noteToFrequency("A4")!).toBeCloseTo(440, 6);
    expect(noteToFrequency("E2")!).toBeCloseTo(82.41, 2);
    expect(noteToFrequency("E4")!).toBeCloseTo(329.63, 2);
  });

  it("matches the bass frequencies the product must support", () => {
    // 4-string standard
    expect(noteToFrequency("E1")!).toBeCloseTo(41.2, 2);
    expect(noteToFrequency("A1")!).toBeCloseTo(55.0, 2);
    expect(noteToFrequency("D2")!).toBeCloseTo(73.42, 2);
    expect(noteToFrequency("G2")!).toBeCloseTo(98.0, 2);
    // 5-string low B
    expect(noteToFrequency("B0")!).toBeCloseTo(30.87, 2);
  });

  it("round-trips frequency -> midi -> frequency", () => {
    for (let midi = 12; midi <= 96; midi++) {
      expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 9);
    }
  });

  it("respects a non-440 reference pitch", () => {
    expect(noteToFrequency("A4", 442)).toBeCloseTo(442, 6);
    expect(frequencyToNote(442, { a4: 442 }).cents).toBeCloseTo(0, 6);
  });
});

describe("cents", () => {
  it("is zero at the reference and ±100 a semitone away", () => {
    expect(calculateCents(440, 440)).toBeCloseTo(0, 9);
    expect(calculateCents(466.164, 440)).toBeCloseTo(100, 1);
    expect(calculateCents(415.305, 440)).toBeCloseTo(-100, 1);
  });

  it("reports a slightly sharp low E as sharp, not as the next note", () => {
    const reading = frequencyToNote(41.5);
    expect(formatNote(reading.note.midi)).toBe("E1");
    expect(reading.cents).toBeGreaterThan(0);
    expect(reading.cents).toBeLessThan(20);
  });

  it("never reports more than half a semitone of deviation", () => {
    for (let hz = 30; hz < 1200; hz += 0.37) {
      expect(Math.abs(frequencyToNote(hz).cents)).toBeLessThanOrEqual(50.01);
    }
  });
});
