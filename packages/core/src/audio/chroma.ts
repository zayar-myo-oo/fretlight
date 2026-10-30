import { mod } from "../theory/pitch";

/**
 * Fold an FFT magnitude spectrum into 12 pitch-class bins (a chroma vector).
 *
 * Takes decibel values as produced by `AnalyserNode.getFloatFrequencyData`.
 * Only spectral peaks that sit close to an equal-tempered pitch count, so
 * leakage between notes and broadband noise add little. The result is scaled
 * so its largest bin is 1; an empty or silent spectrum gives all zeros.
 */
export function chromaFromSpectrum(
  decibels: Float32Array,
  sampleRate: number,
  fftSize: number,
  options: { minHz?: number; maxHz?: number; floorDb?: number; suppressHarmonics?: boolean } = {},
): number[] {
  const { minHz = 70, maxHz = 2000, floorDb = -90 } = options;
  const binHz = sampleRate / fftSize;
  const from = Math.max(1, Math.ceil(minHz / binHz));
  const to = Math.min(decibels.length - 2, Math.floor(maxHz / binHz));
  const chroma = new Array<number>(12).fill(0);

  const peaks: { pc: number; magnitude: number; frequency: number }[] = [];
  let loudest = 0;
  for (let k = from; k <= to; k++) {
    const a = decibels[k - 1]!;
    const b = decibels[k]!;
    const c = decibels[k + 1]!;
    if (!Number.isFinite(a + b + c) || b < floorDb || b < a || b <= c) continue;

    // Parabolic interpolation: a bin is wider than a semitone at guitar's low end.
    const denominator = a - 2 * b + c;
    const offset = denominator === 0 ? 0 : (0.5 * (a - c)) / denominator;
    const frequency = (k + offset) * binHz;
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const nearest = Math.round(midi);
    if (Math.abs(midi - nearest) > 0.35) continue;

    const magnitude = 10 ** (b / 20);
    loudest = Math.max(loudest, magnitude);
    peaks.push({ pc: mod(nearest, 12), magnitude, frequency });
  }

  if (options.suppressHarmonics) {
    // Work from low to high. Subtract a conservative harmonic envelope rather
    // than counting a string's third/fifth partial as another played note.
    for (let i = 0; i < peaks.length; i++) {
      const fundamental = peaks[i]!;
      if (fundamental.magnitude < loudest * 0.08) continue;
      for (let j = i + 1; j < peaks.length; j++) {
        const partial = peaks[j]!;
        const ratio = partial.frequency / fundamental.frequency;
        const harmonic = Math.round(ratio);
        if (harmonic >= 2 && harmonic <= 8 && Math.abs(ratio - harmonic) / harmonic < 0.015) {
          partial.magnitude = Math.max(0, partial.magnitude - fundamental.magnitude * 1.2 / harmonic);
        }
      }
    }
  }

  // Ignore peaks far below the loudest one: they are noise, not notes.
  for (const peak of peaks) {
    if (peak.magnitude >= loudest * 0.1) chroma[peak.pc]! += peak.magnitude;
  }

  const max = Math.max(...chroma);
  return max > 0 ? chroma.map((v) => v / max) : chroma;
}
