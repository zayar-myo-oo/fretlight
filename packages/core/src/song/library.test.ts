import { describe, expect, it } from "vitest";
import { SONGS, getSong } from "./library";
import { phraseToSequence, phrasesForTrack } from "./phrase";
import { createFretboard } from "../instrument/fretboard";
import { getTuning } from "../instrument/tunings";
import { PracticeEngine } from "../practice/practice-engine";

describe("built-in song library", () => {
  it("has at least one track for guitar and one for bass", () => {
    expect(SONGS.length).toBeGreaterThan(0);
    expect(SONGS.some((t) => t.instrumentId.startsWith("guitar"))).toBe(true);
    expect(SONGS.some((t) => t.instrumentId.startsWith("bass"))).toBe(true);
  });

  it("resolves a known id and returns null for an unknown one", () => {
    expect(getSong(SONGS[0]!.id)).toBe(SONGS[0]);
    expect(getSong("does-not-exist")).toBeNull();
  });

  it("references a real, resolvable tuning", () => {
    for (const track of SONGS) {
      expect(getTuning(track.tuningId)).not.toBeNull();
    }
  });

  it("decomposes into at least two learnable phrases", () => {
    for (const track of SONGS) {
      const phrases = phrasesForTrack(track);
      expect(phrases.length).toBeGreaterThanOrEqual(2);
      for (const phrase of phrases) {
        expect(phrase.notes.length).toBeGreaterThan(0);
        expect(phrase.difficulty).toBeGreaterThanOrEqual(0);
        expect(phrase.difficulty).toBeLessThanOrEqual(1);
      }
    }
  });

  it("every phrase turns into a sequence the practice engine can grade end to end", () => {
    for (const track of SONGS) {
      const board = createFretboard(getTuning(track.tuningId)!, 22);
      for (const phrase of phrasesForTrack(track)) {
        const sequence = phraseToSequence(phrase, board, { bpm: track.bpm, timed: true });
        expect(sequence.steps.length).toBe(phrase.notes.length);

        const engine = new PracticeEngine(sequence);
        engine.start(0);
        for (const step of sequence.steps) {
          const event = engine.submitNote({ midi: step.midi, time: step.expectedTime ?? 0 });
          expect(event?.verdict).toBe("correct");
        }
        expect(engine.summary.pitchAccuracy).toBe(1);
      }
    }
  });
});
