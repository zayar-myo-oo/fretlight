import { Biquad } from "./conditioning";

/**
 * Anti-aliased downsampler.
 *
 * YIN costs O(tauMax x windowSize), and tauMax is sampleRate/minFrequency. At
 * 48 kHz a 30.87 Hz low B needs tauMax ≈ 1850, which against an 8192-sample
 * frame is ~11.7 million operations *per frame*. Run that 20 times a second and
 * a phone is warm and the battery is gone.
 *
 * Pitch is a low-frequency property: nothing above a few kHz tells us anything
 * about a 30 Hz period. Decimating to ~5 kHz first cuts the cost by roughly 80x
 * with no meaningful loss of accuracy, because parabolic interpolation recovers
 * sub-sample precision on the period either way.
 *
 * The low-pass cascade before the downsample is not optional: without it,
 * everything above the new Nyquist folds back into the band we are analysing and
 * shows up as spurious periodicity.
 */
export class Decimator {
  private readonly stages: Biquad[];
  private output: Float32Array;

  constructor(
    readonly sampleRate: number,
    readonly factor: number,
  ) {
    const decimatedRate = sampleRate / factor;
    // Two cascaded biquads: a single pole leaves too much energy just above the
    // new Nyquist, which is exactly where aliasing hurts most.
    this.stages =
      factor <= 1
        ? []
        : [
            Biquad.lowpass(sampleRate, decimatedRate * 0.42, 0.54),
            Biquad.lowpass(sampleRate, decimatedRate * 0.42, 1.31),
          ];
    this.output = new Float32Array(0);
  }

  get decimatedRate(): number {
    return this.sampleRate / this.factor;
  }

  /**
   * Filter and downsample. Returns a view onto an internal buffer that is
   * reused on the next call — copy it if you need to keep it.
   */
  process(input: Float32Array): Float32Array {
    if (this.factor <= 1) return input;

    const outLength = Math.floor(input.length / this.factor);
    if (this.output.length !== outLength) this.output = new Float32Array(outLength);

    // Filtering happens in place on a scratch copy so the caller's frame, which
    // other stages may still want, is untouched.
    const filtered = input.slice();
    for (const stage of this.stages) stage.processInPlace(filtered);

    for (let i = 0; i < outLength; i++) {
      this.output[i] = filtered[i * this.factor]!;
    }
    return this.output;
  }

  reset(): void {
    for (const stage of this.stages) stage.reset();
  }
}

/**
 * Pick a decimation factor for an instrument's frequency range.
 *
 * Targets roughly 10 samples per period at the highest note, which keeps
 * parabolic interpolation on the period accurate to well under a cent — a
 * tuner's whole job — while still throwing away the bulk of the work.
 */
export function chooseDecimationFactor(
  sampleRate: number,
  maxFrequency: number,
  minTargetRate = 4000,
): number {
  const targetRate = Math.max(minTargetRate, maxFrequency * 10);
  return Math.max(1, Math.floor(sampleRate / targetRate));
}
