import { describe, expect, it } from "vitest";
import { matchChord } from "../theory/key-detection";
import { chromaFromSpectrum } from "./chroma";

const SAMPLE_RATE = 48000;
const FFT = 16384;

/** A synthetic spectrum with a peak (and a little skirt) at each frequency. */
function spectrum(frequencies: number[]): Float32Array {
  const db = new Float32Array(FFT / 2).fill(-120);
  const binHz = SAMPLE_RATE / FFT;
  for (const f of frequencies) {
    const k = Math.round(f / binHz);
    db[k] = -20;
    db[k - 1] = -35;
    db[k + 1] = -35;
  }
  return db;
}

describe("chromaFromSpectrum", () => {
  it("is silent for an empty spectrum", () => {
    expect(chromaFromSpectrum(spectrum([]), SAMPLE_RATE, FFT).every((v) => v === 0)).toBe(true);
  });

  it("puts C E G into pitch classes 0, 4 and 7", () => {
    const chroma = chromaFromSpectrum(spectrum([261.63, 329.63, 392.0]), SAMPLE_RATE, FFT);
    for (const pc of [0, 4, 7]) expect(chroma[pc]).toBeGreaterThan(0.9);
    for (const pc of [1, 2, 3, 5, 6, 8, 9, 10, 11]) expect(chroma[pc]).toBe(0);
  });

  it("feeds chord matching end to end", () => {
    // G7 = G B D F, with an octave of G for good measure.
    const chroma = chromaFromSpectrum(spectrum([196.0, 246.94, 293.66, 349.23, 392.0]), SAMPLE_RATE, FFT);
    expect(matchChord(chroma, 1)[0]?.symbol).toBe("G7");
  });

  it("ignores a faint noise peak", () => {
    const db = spectrum([440]);
    db[Math.round(1000 / (SAMPLE_RATE / FFT))] = -70;
    const chroma = chromaFromSpectrum(db, SAMPLE_RATE, FFT);
    expect(chroma.filter((v) => v > 0)).toHaveLength(1);
  });
});
