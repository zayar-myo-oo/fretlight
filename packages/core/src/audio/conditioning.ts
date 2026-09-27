/**
 * Signal conditioning that runs before pitch detection.
 *
 * Everything here is sample-by-sample and allocation-free so it can live inside
 * an AudioWorklet's process() call without causing GC pauses on the audio thread.
 */

/**
 * One-pole DC blocker. Cheap microphones and interfaces carry a DC offset that
 * biases YIN's difference function toward long lags; removing it is the single
 * highest-value pre-processing step for low-frequency bass.
 */
export class DcBlocker {
  private lastInput = 0;
  private lastOutput = 0;

  constructor(private readonly coefficient = 0.995) {}

  processInPlace(buffer: Float32Array): void {
    for (let i = 0; i < buffer.length; i++) {
      const input = buffer[i]!;
      const output = input - this.lastInput + this.coefficient * this.lastOutput;
      this.lastInput = input;
      this.lastOutput = output;
      buffer[i] = output;
    }
  }

  reset(): void {
    this.lastInput = 0;
    this.lastOutput = 0;
  }
}

/**
 * Transposed direct-form-II biquad. Used as a gentle low-pass above the
 * instrument's top note: string noise and pick attack carry a lot of high
 * frequency energy that adds nothing to the fundamental estimate.
 */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0;
  private a1 = 0; private a2 = 0;
  private z1 = 0; private z2 = 0;

  static lowpass(sampleRate: number, cutoff: number, q = 0.707): Biquad {
    const filter = new Biquad();
    const omega = (2 * Math.PI * cutoff) / sampleRate;
    const sin = Math.sin(omega);
    const cos = Math.cos(omega);
    const alpha = sin / (2 * q);
    const a0 = 1 + alpha;
    filter.b0 = ((1 - cos) / 2) / a0;
    filter.b1 = (1 - cos) / a0;
    filter.b2 = filter.b0;
    filter.a1 = (-2 * cos) / a0;
    filter.a2 = (1 - alpha) / a0;
    return filter;
  }

  static highpass(sampleRate: number, cutoff: number, q = 0.707): Biquad {
    const filter = new Biquad();
    const omega = (2 * Math.PI * cutoff) / sampleRate;
    const sin = Math.sin(omega);
    const cos = Math.cos(omega);
    const alpha = sin / (2 * q);
    const a0 = 1 + alpha;
    filter.b0 = ((1 + cos) / 2) / a0;
    filter.b1 = -(1 + cos) / a0;
    filter.b2 = filter.b0;
    filter.a1 = (-2 * cos) / a0;
    filter.a2 = (1 - alpha) / a0;
    return filter;
  }

  processInPlace(buffer: Float32Array): void {
    for (let i = 0; i < buffer.length; i++) {
      const input = buffer[i]!;
      const output = this.b0 * input + this.z1;
      this.z1 = this.b1 * input - this.a1 * output + this.z2;
      this.z2 = this.b2 * input - this.a2 * output;
      buffer[i] = output;
    }
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/**
 * The conditioning chain applied to every analysis frame.
 * Order matters: DC first, then band-limit around the instrument's real range.
 */
export class SignalConditioner {
  private readonly dc = new DcBlocker();
  private readonly highpass: Biquad;
  private readonly lowpass: Biquad;

  constructor(sampleRate: number, minFrequency: number, maxFrequency: number) {
    // Sit well below the lowest fundamental so the note itself is untouched:
    // a 30.87 Hz low B only needs rumble below ~20 Hz removed.
    this.highpass = Biquad.highpass(sampleRate, Math.max(15, minFrequency * 0.6));
    // Keep several harmonics — they carry the periodicity YIN relies on.
    this.lowpass = Biquad.lowpass(sampleRate, Math.min(sampleRate / 2.2, maxFrequency * 6));
  }

  processInPlace(buffer: Float32Array): void {
    this.dc.processInPlace(buffer);
    this.highpass.processInPlace(buffer);
    this.lowpass.processInPlace(buffer);
  }

  reset(): void {
    this.dc.reset();
    this.highpass.reset();
    this.lowpass.reset();
  }
}
