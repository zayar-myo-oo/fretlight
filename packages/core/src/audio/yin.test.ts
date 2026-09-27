import { describe, expect, it } from "vitest";
import { YinDetector } from "./yin";
import { synthesizeBassPluck, synthesizeGuitarNote, synthesizeTone } from "./test-signals";
import { calculateCents, noteToFrequency } from "../theory/pitch";
import { frequencyToNote } from "../theory/pitch";

const SAMPLE_RATE = 48000;

const bassDetector = () =>
  new YinDetector({ sampleRate: SAMPLE_RATE, minFrequency: 26, maxFrequency: 500 });
const guitarDetector = () =>
  new YinDetector({ sampleRate: SAMPLE_RATE, minFrequency: 70, maxFrequency: 1400 });

/** Frame long enough to resolve a 26 Hz fundamental at 48 kHz. */
const BASS_FRAME = 8192;
const GUITAR_FRAME = 4096;

function centsError(detected: number, expected: number): number {
  return Math.abs(calculateCents(detected, expected));
}

describe("YIN on steady tones", () => {
  it("tracks pure sines across the whole instrument range", () => {
    const detector = bassDetector();
    for (const frequency of [30.87, 41.2, 55, 73.42, 98, 110, 196, 329.63]) {
      const frame = synthesizeTone({ frequency, sampleRate: SAMPLE_RATE, length: BASS_FRAME });
      const result = detector.detect(frame);
      expect(result.frequency).not.toBeNull();
      expect(centsError(result.frequency!, frequency)).toBeLessThan(5);
      expect(result.clarity).toBeGreaterThan(0.9);
    }
  });

  it("reports silence rather than guessing", () => {
    const detector = bassDetector();
    const quiet = new Float32Array(BASS_FRAME);
    const result = detector.detect(quiet);
    expect(result.silent).toBe(true);
    expect(result.frequency).toBeNull();
  });
});

describe("YIN on bass, where the fundamental is weak", () => {
  it("finds the fundamental of every open string on a 5-string bass", () => {
    const detector = bassDetector();
    const strings = { B0: 30.87, E1: 41.2, A1: 55.0, D2: 73.42, G2: 98.0 };
    for (const [name, frequency] of Object.entries(strings)) {
      const frame = synthesizeBassPluck(frequency, SAMPLE_RATE, BASS_FRAME);
      const result = detector.detect(frame);
      expect(result.frequency, `${name} produced no estimate`).not.toBeNull();
      // The crucial assertion: not the octave above.
      expect(
        centsError(result.frequency!, frequency),
        `${name}: detected ${result.frequency?.toFixed(2)} Hz, expected ${frequency} Hz`,
      ).toBeLessThan(25);
    }
  });

  it("names the right note for a plucked low B and low E", () => {
    const detector = bassDetector();
    for (const [expected, frequency] of [["B0", 30.87], ["E1", 41.2]] as const) {
      const frame = synthesizeBassPluck(frequency as number, SAMPLE_RATE, BASS_FRAME);
      const result = detector.detect(frame);
      const reading = frequencyToNote(result.frequency!);
      expect(`${reading.note.name}${reading.note.octave}`).toBe(expected);
    }
  });

  it("holds up on fretted notes across the neck", () => {
    const detector = bassDetector();
    for (const name of ["F1", "C2", "G2", "C3", "E3"]) {
      const frequency = noteToFrequency(name)!;
      const frame = synthesizeBassPluck(frequency, SAMPLE_RATE, BASS_FRAME, 23);
      const result = detector.detect(frame);
      expect(result.frequency, name).not.toBeNull();
      expect(centsError(result.frequency!, frequency), name).toBeLessThan(25);
    }
  });

  it("survives light playing and background noise", () => {
    const detector = bassDetector();
    const quiet = synthesizeTone({
      frequency: 41.2,
      sampleRate: SAMPLE_RATE,
      length: BASS_FRAME,
      harmonics: [0.4, 1.0, 0.6],
      amplitude: 0.05,
      noise: 0.01,
      seed: 31,
    });
    const result = detector.detect(quiet);
    expect(result.frequency).not.toBeNull();
    expect(centsError(result.frequency!, 41.2)).toBeLessThan(30);
  });
});

describe("YIN on guitar", () => {
  it("tracks every open string in standard tuning", () => {
    const detector = guitarDetector();
    for (const name of ["E2", "A2", "D3", "G3", "B3", "E4"]) {
      const frequency = noteToFrequency(name)!;
      const frame = synthesizeGuitarNote(frequency, SAMPLE_RATE, GUITAR_FRAME);
      const result = detector.detect(frame);
      expect(result.frequency, name).not.toBeNull();
      expect(centsError(result.frequency!, frequency), name).toBeLessThan(10);
    }
  });

  it("resolves detuning finely enough for a usable tuner", () => {
    const detector = guitarDetector();
    // 10 cents sharp of A2
    const target = noteToFrequency("A2")! * Math.pow(2, 10 / 1200);
    const frame = synthesizeGuitarNote(target, SAMPLE_RATE, GUITAR_FRAME);
    const result = detector.detect(frame);
    const reading = frequencyToNote(result.frequency!);
    expect(reading.note.name).toBe("A");
    expect(reading.cents).toBeGreaterThan(4);
    expect(reading.cents).toBeLessThan(16);
  });
});

describe("detector configuration", () => {
  it("reports the frame size it needs for its lowest frequency", () => {
    const detector = bassDetector();
    expect(detector.requiredFrameSize).toBeGreaterThan(SAMPLE_RATE / 26);
    expect(detector.requiredFrameSize).toBeLessThanOrEqual(BASS_FRAME);
  });
});
