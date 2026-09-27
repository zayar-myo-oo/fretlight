/**
 * In-place iterative radix-2 FFT.
 *
 * Added for spectral analysis in the instrument gate, not for pitch detection —
 * YIN stays the pitch estimator because it is more accurate on low, harmonically
 * rich notes than peak-picking a spectrum. This runs on the already-decimated
 * signal, so a 512-point transform covers the whole useful band cheaply.
 */

/** Largest power of two at or below `value`. */
export function previousPowerOfTwo(value: number): number {
  let size = 1;
  while (size * 2 <= value) size *= 2;
  return size;
}

export function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/** Periodic Hann window — reduces the spectral leakage that would smear flatness. */
export function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return window;
}

/**
 * Transform `real`/`imag` in place. Both must be the same power-of-two length.
 * Returns false rather than throwing on a bad length, so a caller on the audio
 * path can degrade instead of crashing.
 */
export function fft(real: Float32Array, imag: Float32Array): boolean {
  const n = real.length;
  if (n !== imag.length || !isPowerOfTwo(n)) return false;
  if (n === 1) return true;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tempReal = real[i]!;
      real[i] = real[j]!;
      real[j] = tempReal;
      const tempImag = imag[i]!;
      imag[i] = imag[j]!;
      imag[j] = tempImag;
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < length / 2; k++) {
        const evenIndex = start + k;
        const oddIndex = start + k + length / 2;
        const oddReal = real[oddIndex]! * curReal - imag[oddIndex]! * curImag;
        const oddImag = real[oddIndex]! * curImag + imag[oddIndex]! * curReal;

        real[oddIndex] = real[evenIndex]! - oddReal;
        imag[oddIndex] = imag[evenIndex]! - oddImag;
        real[evenIndex] = real[evenIndex]! + oddReal;
        imag[evenIndex] = imag[evenIndex]! + oddImag;

        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
  return true;
}

/**
 * Magnitude spectrum of a real signal, up to Nyquist.
 * Reuses the caller's scratch buffers to stay allocation-free on the hot path.
 */
export class SpectrumAnalyzer {
  private readonly real: Float32Array;
  private readonly imag: Float32Array;
  private readonly window: Float32Array;
  readonly magnitudes: Float32Array;

  constructor(readonly size: number) {
    if (!isPowerOfTwo(size)) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);
    this.window = hannWindow(size);
    this.magnitudes = new Float32Array(size / 2);
  }

  /** Analyse the most recent `size` samples of `frame`. */
  analyze(frame: Float32Array): Float32Array {
    const offset = Math.max(0, frame.length - this.size);
    for (let i = 0; i < this.size; i++) {
      this.real[i] = (frame[offset + i] ?? 0) * this.window[i]!;
      this.imag[i] = 0;
    }
    fft(this.real, this.imag);
    for (let i = 0; i < this.magnitudes.length; i++) {
      this.magnitudes[i] = Math.hypot(this.real[i]!, this.imag[i]!);
    }
    return this.magnitudes;
  }
}

/**
 * Spectral flatness (Wiener entropy): geometric mean over arithmetic mean of the
 * magnitude spectrum.
 *
 * Near 0 for a tonal signal whose energy sits in a few harmonic peaks — a
 * plucked string. Near 1 for noise-like signals, which is what fricatives,
 * consonants, handling noise and room ambience look like. This is one of the few
 * cheap measures that separates "a note" from "a person talking" even when both
 * land in the same frequency band.
 */
export function spectralFlatness(magnitudes: Float32Array, from = 1, to = magnitudes.length): number {
  const start = Math.max(1, from);
  const end = Math.min(magnitudes.length, to);
  const count = end - start;
  if (count <= 0) return 1;

  let logSum = 0;
  let sum = 0;
  // A small floor keeps log(0) out of the geometric mean on silent bins.
  const epsilon = 1e-10;
  for (let i = start; i < end; i++) {
    const magnitude = magnitudes[i]! + epsilon;
    logSum += Math.log(magnitude);
    sum += magnitude;
  }

  const geometricMean = Math.exp(logSum / count);
  const arithmeticMean = sum / count;
  if (arithmeticMean <= 0) return 1;
  return Math.max(0, Math.min(1, geometricMean / arithmeticMean));
}

/**
 * Share of total spectral energy sitting at integer multiples of `frequency`.
 *
 * A struck or plucked string puts most of its energy into a harmonic series. A
 * voice does too for vowels — so this is not sufficient on its own — but a low
 * value is strong evidence that whatever produced the signal was not a string.
 */
export function harmonicEnergyRatio(
  magnitudes: Float32Array,
  frequency: number,
  sampleRate: number,
  harmonics = 6,
): number {
  if (frequency <= 0) return 0;
  const binWidth = sampleRate / (magnitudes.length * 2);
  if (binWidth <= 0) return 0;

  let total = 0;
  for (let i = 1; i < magnitudes.length; i++) total += magnitudes[i]!;
  if (total <= 0) return 0;

  let harmonic = 0;
  for (let h = 1; h <= harmonics; h++) {
    const bin = Math.round((frequency * h) / binWidth);
    if (bin < 1 || bin >= magnitudes.length) break;
    // Take a small neighbourhood: the true partial rarely lands dead centre.
    for (let offset = -1; offset <= 1; offset++) {
      const index = bin + offset;
      if (index >= 1 && index < magnitudes.length) harmonic += magnitudes[index]!;
    }
  }
  return Math.max(0, Math.min(1, harmonic / total));
}

/**
 * Zero-crossing rate, normalised to 0..1.
 *
 * High for noisy and consonant-heavy signals, low for a sustained low note.
 * Weak on its own, useful as one term in a combined score.
 */
export function zeroCrossingRate(frame: Float32Array): number {
  if (frame.length < 2) return 0;
  let crossings = 0;
  let previous = frame[0]!;
  for (let i = 1; i < frame.length; i++) {
    const current = frame[i]!;
    if ((previous >= 0 && current < 0) || (previous < 0 && current >= 0)) crossings++;
    previous = current;
  }
  return crossings / (frame.length - 1);
}
