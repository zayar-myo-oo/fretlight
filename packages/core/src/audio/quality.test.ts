import { describe, expect, it } from "vitest";
import {
  SpectrumAnalyzer,
  fft,
  harmonicEnergyRatio,
  hannWindow,
  isPowerOfTwo,
  previousPowerOfTwo,
  spectralFlatness,
  zeroCrossingRate,
} from "./fft";
import { OnsetDetector } from "./onset";
import { InstrumentGate } from "./quality";
import { synthesizeBassPluck, synthesizeGuitarNote, synthesizeTone } from "./test-signals";
import type { FrameQuality, PitchEstimate } from "./types";

const SAMPLE_RATE = 48000;

function whiteNoise(length: number, seed = 5): Float32Array {
  let a = seed >>> 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return out;
}

describe("FFT", () => {
  it("puts a pure tone in the expected bin", () => {
    const size = 1024;
    const analyzer = new SpectrumAnalyzer(size);
    const binHz = SAMPLE_RATE / size;
    const targetBin = 64;
    const frame = synthesizeTone({
      frequency: targetBin * binHz,
      sampleRate: SAMPLE_RATE,
      length: size,
    });

    const magnitudes = analyzer.analyze(frame);
    let peak = 1;
    for (let i = 2; i < magnitudes.length; i++) {
      if (magnitudes[i]! > magnitudes[peak]!) peak = i;
    }
    expect(Math.abs(peak - targetBin)).toBeLessThanOrEqual(1);
  });

  it("round-trips a known transform", () => {
    const real = new Float32Array([1, 0, 0, 0]);
    const imag = new Float32Array(4);
    expect(fft(real, imag)).toBe(true);
    // An impulse transforms to a flat spectrum.
    for (let i = 0; i < 4; i++) expect(real[i]).toBeCloseTo(1, 5);
  });

  it("refuses a non-power-of-two length instead of corrupting memory", () => {
    expect(fft(new Float32Array(6), new Float32Array(6))).toBe(false);
    expect(isPowerOfTwo(6)).toBe(false);
    expect(previousPowerOfTwo(1000)).toBe(512);
  });

  it("builds a symmetric window", () => {
    const window = hannWindow(64);
    expect(window[0]).toBeCloseTo(0, 6);
    expect(window[32]).toBeCloseTo(1, 6);
  });
});

describe("spectral flatness — the tonal/noisy discriminator", () => {
  const analyzer = new SpectrumAnalyzer(1024);

  it("is low for a plucked instrument note", () => {
    const guitar = analyzer.analyze(synthesizeGuitarNote(196, SAMPLE_RATE, 1024));
    expect(spectralFlatness(guitar)).toBeLessThan(0.25);
  });

  it("is high for white noise", () => {
    const noise = analyzer.analyze(whiteNoise(1024));
    expect(spectralFlatness(noise)).toBeGreaterThan(0.4);
  });

  it("separates the two clearly, which is what the gate depends on", () => {
    const tonal = spectralFlatness(analyzer.analyze(synthesizeBassPluck(55, SAMPLE_RATE, 1024)));
    const noisy = spectralFlatness(analyzer.analyze(whiteNoise(1024, 99)));
    expect(noisy).toBeGreaterThan(tonal * 2);
  });
});

describe("harmonic energy ratio", () => {
  it("is high when the spectrum sits on the harmonic series", () => {
    const analyzer = new SpectrumAnalyzer(2048);
    const magnitudes = analyzer.analyze(synthesizeGuitarNote(220, SAMPLE_RATE, 2048));
    expect(harmonicEnergyRatio(magnitudes, 220, SAMPLE_RATE)).toBeGreaterThan(0.3);
  });

  it("is low when measured against an unrelated fundamental", () => {
    const analyzer = new SpectrumAnalyzer(2048);
    const magnitudes = analyzer.analyze(synthesizeGuitarNote(220, SAMPLE_RATE, 2048));
    const wrong = harmonicEnergyRatio(magnitudes, 317, SAMPLE_RATE);
    const right = harmonicEnergyRatio(magnitudes, 220, SAMPLE_RATE);
    expect(wrong).toBeLessThan(right);
  });

  it("handles a zero or negative fundamental safely", () => {
    const analyzer = new SpectrumAnalyzer(256);
    const magnitudes = analyzer.analyze(new Float32Array(256));
    expect(harmonicEnergyRatio(magnitudes, 0, SAMPLE_RATE)).toBe(0);
  });
});

describe("zero-crossing rate", () => {
  it("is low for a low sustained tone and high for noise", () => {
    const low = zeroCrossingRate(synthesizeTone({ frequency: 41.2, sampleRate: SAMPLE_RATE, length: 2048 }));
    const noisy = zeroCrossingRate(whiteNoise(2048));
    expect(low).toBeLessThan(0.02);
    expect(noisy).toBeGreaterThan(0.3);
  });

  it("handles degenerate input", () => {
    expect(zeroCrossingRate(new Float32Array(1))).toBe(0);
  });
});

describe("OnsetDetector", () => {
  it("fires on a sharp rise, not on a steady level", () => {
    const detector = new OnsetDetector({ refractoryFrames: 2 });
    for (let i = 0; i < 10; i++) detector.push(0.02);
    expect(detector.push(0.02).onset).toBe(false);
    expect(detector.push(0.3).onset).toBe(true);
  });

  it("does not fire twice for one pluck", () => {
    const detector = new OnsetDetector({ refractoryFrames: 5 });
    for (let i = 0; i < 8; i++) detector.push(0.02);
    expect(detector.push(0.3).onset).toBe(true);
    expect(detector.push(0.32).onset).toBe(false);
    expect(detector.push(0.31).onset).toBe(false);
  });

  it("ignores rises below the absolute floor", () => {
    const detector = new OnsetDetector({ floor: 0.05, refractoryFrames: 1 });
    for (let i = 0; i < 6; i++) detector.push(0.001);
    expect(detector.push(0.01).onset).toBe(false);
  });

  it("re-arms for the next note after the first decays", () => {
    const detector = new OnsetDetector({ refractoryFrames: 3 });
    for (let i = 0; i < 6; i++) detector.push(0.02);
    expect(detector.push(0.4).onset).toBe(true);
    for (let i = 0; i < 12; i++) detector.push(0.03);
    expect(detector.push(0.4).onset).toBe(true);
  });
});

// --- The gate: instrument vs everything else in the room -------------------

const estimate = (frequency: number | null, clarity = 0.93): PitchEstimate => ({
  frequency,
  clarity: frequency === null ? 0 : clarity,
  rms: frequency === null ? 0 : 0.2,
  silent: frequency === null,
});

const quality = (partial: Partial<FrameQuality> = {}): FrameQuality => ({
  clarity: 0.93,
  flatness: 0.12,
  harmonicRatio: 0.55,
  zeroCrossingRate: 0.06,
  rms: 0.2,
  onset: false,
  ...partial,
});

describe("InstrumentGate", () => {
  it("accepts a steady, tonal, periodic note", () => {
    const gate = new InstrumentGate();
    let verdict = gate.evaluate(estimate(110), quality());
    for (let i = 0; i < 6; i++) verdict = gate.evaluate(estimate(110), quality());
    expect(verdict.accepted).toBe(true);
    expect(verdict.confidence).toBeGreaterThan(0.6);
    expect(verdict.pitchStability).toBeGreaterThan(0.9);
  });

  it("rejects a pitch that keeps sliding — the signature of speech", () => {
    const gate = new InstrumentGate();
    // A spoken vowel glides tens of cents within a syllable. Periodicity and
    // spectrum can look fine; the movement is what gives it away.
    const glide = [110, 118, 126, 119, 131, 124, 136];
    let verdict = gate.evaluate(estimate(glide[0]!), quality({ flatness: 0.28 }));
    for (const frequency of glide.slice(1)) {
      verdict = gate.evaluate(estimate(frequency), quality({ flatness: 0.28 }));
    }
    expect(verdict.pitchStability).toBeLessThan(0.4);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("unstable_pitch");
  });

  it("rejects noise-like signals outright", () => {
    const gate = new InstrumentGate();
    const verdict = gate.evaluate(estimate(140), quality({ zeroCrossingRate: 0.62 }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("noise_like");
  });

  it("rejects aperiodic signals outright", () => {
    const gate = new InstrumentGate();
    const verdict = gate.evaluate(estimate(140, 0.35), quality({ clarity: 0.35 }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("aperiodic");
  });

  it("uses hysteresis so a marginal signal does not flicker", () => {
    const gate = new InstrumentGate({ activateConfidence: 0.6, releaseConfidence: 0.3 });
    // Establish a solid note first.
    for (let i = 0; i < 6; i++) gate.evaluate(estimate(110), quality());
    expect(gate.isAccepting).toBe(true);

    // Degrade to a level that would never have started a note, but is above the
    // release threshold — the note must hold rather than drop out.
    const marginal = quality({ clarity: 0.84, flatness: 0.26, harmonicRatio: 0.3 });
    const held = gate.evaluate(estimate(110.4), marginal);
    expect(held.accepted).toBe(true);
    expect(held.confidence).toBeLessThan(0.6);
  });

  it("clears its state on silence", () => {
    const gate = new InstrumentGate();
    for (let i = 0; i < 6; i++) gate.evaluate(estimate(110), quality());
    const verdict = gate.evaluate(estimate(null), quality({ rms: 0 }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe("silent");
    expect(gate.isAccepting).toBe(false);
  });

  it("gives a fresh note the benefit of the doubt before it has history", () => {
    const gate = new InstrumentGate();
    const first = gate.evaluate(estimate(110), quality({ onset: true }));
    expect(first.pitchStability).toBeGreaterThan(0.5);
  });
});
