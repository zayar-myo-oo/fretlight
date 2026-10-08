import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../theory/pitch";
import { analyzeSong } from "./analyze";
import { detectBpm } from "./bpm-detector";
import { smoothChords } from "./chord-smoother";
import { chordPitchClasses } from "./chord-templates";
import { detectChordFromChroma } from "./chord-detector";
import { CHROMA_CONFIG } from "./config";
import { extractChroma } from "./chroma-analyzer";
import { analyzeKey } from "./key-analyzer";
import { buildChart, editChord, exportText } from "./timeline-builder";
import type { ChordDetection, ChordQuality } from "./types";

const SR = 22050;

/** Chroma vector with weight 1 on the pitch classes of a chord. */
function chromaOf(root: number, quality: ChordQuality, noise = 0): Float32Array {
  const v = new Float32Array(12).fill(noise);
  for (const pc of chordPitchClasses(root, quality)) v[pc] = 1;
  return v;
}

/** Sum of harmonic tones, one per MIDI note. */
function tone(midis: number[], seconds: number, out: Float32Array, offset: number, gain = 1) {
  const n = Math.floor(seconds * SR);
  for (const midi of midis) {
    const f = midiToFrequency(midi);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let s = 0;
      for (let h = 1; h <= 3; h++) s += Math.sin(2 * Math.PI * f * h * t) / h;
      out[offset + i]! += 0.2 * gain * s;
    }
  }
}

/** Build a song from [chord root pitch class, quality, seconds]; voicing around C3. */
function song(parts: readonly [number, ChordQuality, number][], bass = false, gains: readonly number[] = []): Float32Array {
  const total = parts.reduce((s, p) => s + p[2], 0);
  const out = new Float32Array(Math.floor(total * SR));
  let offset = 0;
  for (const [index, [root, quality, seconds]] of parts.entries()) {
    const base = 48 + root; // C3 upward
    const midis = bass ? [base - 12] : chordPitchClasses(root, quality).map((pc) => 48 + ((pc - root + 12) % 12) + root);
    tone(midis, seconds, out, offset, gains[index] ?? 1);
    offset += Math.floor(seconds * SR);
  }
  return out;
}

const C = 0, D = 2, F = 5, G = 7, A = 9, BB = 10;

describe("detectChordFromChroma", () => {
  it("names clean triads", () => {
    expect(detectChordFromChroma(chromaOf(C, "maj")).chord).toBe("C");
    expect(detectChordFromChroma(chromaOf(G, "maj")).chord).toBe("G");
    expect(detectChordFromChroma(chromaOf(A, "min")).chord).toBe("Am");
  });
  it("names sevenths when all four notes are present", () => {
    expect(detectChordFromChroma(chromaOf(C, "7")).chord).toBe("C7");
    expect(detectChordFromChroma(chromaOf(C, "maj7")).chord).toBe("Cmaj7");
    expect(detectChordFromChroma(chromaOf(D, "m7")).chord).toBe("Dm7");
  });
  it("prefers the plain triad when the extension is faint", () => {
    const v = chromaOf(C, "maj");
    v[11] = 0.15;
    expect(detectChordFromChroma(v).chord).toBe("C");
  });
  it("says Unknown for a flat or silent frame", () => {
    expect(detectChordFromChroma(new Float32Array(12).fill(1)).chord).toBeNull();
    expect(detectChordFromChroma(new Float32Array(12)).chord).toBeNull();
  });
  it("exposes confidence", () => {
    expect(detectChordFromChroma(chromaOf(C, "maj")).confidence).toBeGreaterThan(0.85);
    const murky = chromaOf(C, "maj", 0.6);
    expect(detectChordFromChroma(murky).confidence).toBeLessThan(detectChordFromChroma(chromaOf(C, "maj")).confidence);
  });
});

describe("smoothChords", () => {
  const hop = 0.5;
  const run = (frames: Float32Array[]) => {
    const times = Float32Array.from(frames, (_, i) => i * hop + hop / 2);
    return smoothChords(frames, times, hop, frames.length * hop);
  };
  it("merges repeats into one chord per change", () => {
    const frames = [...Array(4).fill(chromaOf(C, "maj")), ...Array(3).fill(chromaOf(G, "maj"))];
    const out = run(frames);
    expect(out.map((c) => c.chord)).toEqual(["C", "G"]);
    expect(out[0]!.end).toBeCloseTo(out[1]!.start, 5);
    expect(out[1]!.end).toBeCloseTo(3.5, 5);
  });
  it("ignores a one-frame wobble", () => {
    const frames = [...Array(5).fill(chromaOf(C, "maj"))];
    frames[2] = chromaOf(C, "maj7");
    expect(run(frames).map((c) => c.chord)).toEqual(["C"]);
  });
  it("leaves unclear stretches unnamed", () => {
    const frames = [...Array(4).fill(chromaOf(C, "maj")), ...Array(4).fill(new Float32Array(12).fill(1))];
    const out = run(frames);
    expect(out.map((c) => c.chord)).toEqual(["C", null]);
  });
});

describe("analyzeKey", () => {
  const seq = (...roots: [number, ChordQuality][]): ChordDetection[] =>
    roots.map(([root, quality], i) => ({ chord: "x", root, quality, start: i * 2, end: i * 2 + 2, confidence: 0.9 }));

  it("C G Am F -> C Major", () => {
    const k = analyzeKey(seq([C, "maj"], [G, "maj"], [A, "min"], [F, "maj"]));
    expect(k.key?.name).toBe("C Major");
    expect(k.confidence).toBeGreaterThan(0.6);
  });
  it("Am F C G -> A Minor or C Major, with the relative named", () => {
    const k = analyzeKey(seq([A, "min"], [F, "maj"], [C, "maj"], [G, "maj"]));
    expect(["A Minor", "C Major"]).toContain(k.key?.name);
    expect(k.relative).not.toBeNull();
  });
  it("refuses to name a key from a single chord", () => {
    expect(analyzeKey(seq([C, "maj"], [C, "maj"])).key).toBeNull();
  });
  it("handles a flat key", () => {
    expect(analyzeKey(seq([F, "maj"], [BB, "maj"], [C, "maj"], [F, "maj"])).key?.name).toBe("F Major");
  });
});

describe("audio pipeline", () => {
  it("hears a C major triad in a synthetic signal", () => {
    const signal = song([[C, "maj", 3]]);
    const frames = extractChroma(signal, SR, CHROMA_CONFIG.guitar);
    const mid = frames.chroma[Math.floor(frames.chroma.length / 2)]!;
    expect(detectChordFromChroma(mid).chord).toBe("C");
  });

  it("estimates 120 BPM from a click track", () => {
    const seconds = 24;
    const clicks = new Float32Array(seconds * SR);
    for (let t = 0; t < seconds; t += 0.5) {
      const start = Math.round(t * SR);
      for (let i = 0; i < 200; i++) clicks[start + i] = Math.sin(i * 0.5) * (1 - i / 200);
    }
    const tempo = detectBpm(clicks, SR);
    expect(tempo.bpm).toBeGreaterThanOrEqual(117);
    expect(tempo.bpm).toBeLessThanOrEqual(123);
    expect(tempo.beats.length).toBeGreaterThan(30);
  });

  it("reads a four-chord loop end to end", () => {
    const loop: [number, ChordQuality, number][] = [[C, "maj", 2], [G, "maj", 2], [A, "min", 2], [F, "maj", 2]];
    const signal = song([...loop, ...loop, ...loop, ...loop]);
    const result = analyzeSong(signal, SR);
    const names = result.chords.filter((c) => c.chord).map((c) => c.chord);
    expect(names.slice(0, 4)).toEqual(["C", "G", "Am", "F"]);
    expect(result.key).toBe("C Major");
    expect(result.duration).toBeCloseTo(32, 1);
  });

  it("finds repeated sections", () => {
    const a: [number, ChordQuality, number][] = [[C, "maj", 4], [G, "maj", 4], [A, "min", 4], [F, "maj", 4]];
    const b: [number, ChordQuality, number][] = [[D, "min", 4], [BB, "maj", 4], [F, "maj", 4], [C, "maj", 4]];
    // Real choruses are louder; loudness is the cue that places the boundaries.
    const gains = [...a, ...b, ...a, ...b].map((_, i) => (Math.floor(i / 4) % 2 === 1 ? 1.8 : 1));
    const signal = song([...a, ...b, ...a, ...b], false, gains);
    const result = analyzeSong(signal, SR);
    expect(result.sections.map((s) => [Math.round(s.start), s.cluster])).toEqual([[0, 0], [16, 1], [32, 0], [48, 1]]);
    expect(result.sections.map((s) => s.type)).toEqual(["verse", "chorus", "verse", "chorus"]);
    // the song is fully covered, with no gaps
    expect(result.sections[0]!.start).toBe(0);
    expect(result.sections[result.sections.length - 1]!.end).toBeCloseTo(result.duration, 5);
  });

  it("infers chords from a bass line in bass mode", () => {
    const line: [number, ChordQuality, number][] = [[C, "maj", 3], [G, "maj", 1.5], [A, "maj", 1.5], [F, "maj", 2]];
    const signal = song([...line, ...line, ...line, ...line], true);
    const result = analyzeSong(signal, SR, { instrument: "bass" });
    expect(result.chords.filter((c) => c.chord).map((c) => c.chord).slice(0, 4)).toEqual(["C", "G", "Am", "F"]);
  });
});

describe("timeline", () => {
  const chords: ChordDetection[] = [
    { chord: "C", root: 0, quality: "maj", start: 0, end: 2, confidence: 0.9 },
    { chord: "G", root: 7, quality: "maj", start: 2, end: 4, confidence: 0.9 },
    { chord: "Am", root: 9, quality: "min", start: 4, end: 6, confidence: 0.9 },
    { chord: "F", root: 5, quality: "maj", start: 6, end: 8, confidence: 0.9 },
  ];
  const sections = [{ type: "unknown" as const, label: "Section A", cluster: 0, start: 0, end: 8, confidence: 0.3 }];

  it("lays chords out as bars when the tempo is known", () => {
    const beats = Array.from({ length: 16 }, (_, i) => i * 0.5);
    const chart = buildChart(chords, sections, 120, beats);
    expect(chart[0]!.rows.flat().map((b) => b.chordIndexes)).toEqual([[0], [1], [2], [3]]);
  });
  it("falls back to one cell per chord without a tempo", () => {
    expect(buildChart(chords, sections, null, [])[0]!.rows.flat()).toHaveLength(4);
  });
  it("edits a chord in place", () => {
    const edited = editChord(chords, 0, 9, "min");
    expect(edited[0]!.chord).toBe("Am");
    expect(edited[0]!.edited).toBe(true);
    expect(edited[1]).toBe(chords[1]);
    expect(editChord(chords, 1, null, null)[1]!.chord).toBeNull();
  });
  it("exports a text chord sheet", () => {
    const analysis = {
      duration: 8, instrument: "guitar" as const, bpm: 120, bpmConfidence: 0.9,
      beats: Array.from({ length: 16 }, (_, i) => i * 0.5), key: "C Major", keyInfo: null,
      keyConfidence: 0.9, keyLevel: "High" as const, chords, sections,
    };
    const text = exportText("Demo", analysis, chords);
    expect(text).toContain("Song: Demo");
    expect(text).toContain("Key: C Major");
    expect(text).toContain("| C    | G    | Am   | F    |");
  });
});
