import { describe, expect, it } from "vitest";
import { generateBassline, progressionLengthBeats, type ChordSlot } from "./bassline";
import { getChord } from "../theory/chords";
import { mod } from "../theory/pitch";

// E -> C#m -> B -> A, the exact progression used as an example in the spec.
const PROGRESSION: ChordSlot[] = [
  { root: "E", chord: "major", beats: 4 },
  { root: "C#", chord: "minor", beats: 4 },
  { root: "B", chord: "major", beats: 4 },
  { root: "A", chord: "major", beats: 4 },
];

function pitchClassesInChord(root: string, chordId: ChordSlot["chord"]): ReadonlySet<number> {
  return getChord(root, chordId)!.pitchClasses;
}

describe("generateBassline — beginner", () => {
  it("plays only the root of each chord, held for its full duration", () => {
    const notes = generateBassline(PROGRESSION, "beginner");
    expect(notes).toHaveLength(4);

    const roots = PROGRESSION.map((slot) => getChord(slot.root, slot.chord)!.tones[0]!.pitchClass);
    notes.forEach((note, i) => {
      expect(mod(note.midi, 12)).toBe(roots[i]);
      expect(note.role).toBe("root");
      expect(note.durationBeats).toBe(4);
      expect(note.startBeat).toBe(i * 4);
    });
  });
});

describe("generateBassline — intermediate", () => {
  it("uses only notes that belong to the chord actually sounding", () => {
    const notes = generateBassline(PROGRESSION, "intermediate");
    let beat = 0;
    for (const slot of PROGRESSION) {
      const allowed = pitchClassesInChord(slot.root as string, slot.chord);
      const inThisChord = notes.filter((n) => n.startBeat >= beat && n.startBeat < beat + slot.beats);
      expect(inThisChord.length).toBeGreaterThan(1); // more than just the root
      for (const note of inThisChord) {
        expect(allowed.has(mod(note.midi, 12))).toBe(true);
      }
      beat += slot.beats;
    }
  });

  it("fills each chord's full duration with no gaps", () => {
    const notes = generateBassline(PROGRESSION, "intermediate");
    const total = progressionLengthBeats(PROGRESSION);
    const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
    let cursor = 0;
    for (const note of sorted) {
      expect(note.startBeat).toBeCloseTo(cursor, 5);
      cursor += note.durationBeats;
    }
    expect(cursor).toBeCloseTo(total, 5);
  });
});

describe("generateBassline — advanced", () => {
  it("adds a chromatic approach note aimed at the next chord's root, wrapping at the end", () => {
    const notes = generateBassline(PROGRESSION, "advanced");
    const approaches = notes.filter((n) => n.role === "approach");
    // One approach per chord — the last one leads back to the top, since a
    // bassline is a vamp meant to repeat.
    expect(approaches.length).toBe(PROGRESSION.length);

    approaches.forEach((approach, i) => {
      const nextSlot = PROGRESSION[(i + 1) % PROGRESSION.length]!;
      const nextRoot = getChord(nextSlot.root, nextSlot.chord)!.tones[0]!.pitchClass;
      const distance = mod(nextRoot - mod(approach.midi, 12), 12);
      // A semitone below the target, i.e. one semitone of distance upward to it.
      expect(distance).toBe(1);
    });
  });

  it("never invents a pitch outside the chord tones or a real approach note", () => {
    const notes = generateBassline(PROGRESSION, "advanced");
    for (const note of notes) {
      if (note.role === "approach") continue;
      const slotIndex = Math.floor(note.startBeat / 4);
      const slot = PROGRESSION[Math.min(slotIndex, PROGRESSION.length - 1)]!;
      const allowed = pitchClassesInChord(slot.root as string, slot.chord);
      expect(allowed.has(mod(note.midi, 12))).toBe(true);
    }
  });
});

describe("generateBassline — edge cases", () => {
  it("returns an empty line for an empty progression", () => {
    expect(generateBassline([], "intermediate")).toEqual([]);
  });

  it("skips a chord id that fails to resolve rather than throwing", () => {
    const notes = generateBassline([{ root: "not-a-note", chord: "major", beats: 4 }], "beginner");
    expect(notes).toEqual([]);
  });
});
