import type { PitchDetectorOptions, PitchEstimate } from "./types";

/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002) with
 * parabolic interpolation and an explicit octave-recovery pass.
 *
 * Why YIN and not plain autocorrelation: autocorrelation's peak at lag 0 and its
 * bias toward short lags makes it pick the first harmonic on a plucked low B
 * (30.87 Hz) far too often. YIN's cumulative mean normalised difference removes
 * that bias, and the extra pass below catches the remaining octave errors that
 * bass strings — with a fundamental much weaker than its 2nd harmonic — still
 * produce.
 *
 * Pure function over a Float32Array: runs identically in an AudioWorklet, a Web
 * Worker, React Native, or a Node test harness.
 */
export class YinDetector {
  private readonly sampleRate: number;
  private readonly threshold: number;
  private readonly rmsThreshold: number;
  private readonly tauMin: number;
  private readonly tauMax: number;
  /** Scratch buffer for the cumulative mean normalised difference, allocated once. */
  private readonly cmnd: Float32Array;

  constructor(options: PitchDetectorOptions) {
    this.sampleRate = options.sampleRate;
    this.threshold = options.threshold ?? 0.12;
    this.rmsThreshold = options.rmsThreshold ?? 0.008;
    this.tauMin = Math.max(2, Math.floor(this.sampleRate / options.maxFrequency));
    this.tauMax = Math.ceil(this.sampleRate / options.minFrequency);
    this.cmnd = new Float32Array(this.tauMax + 1);
  }

  /** Minimum frame length this detector needs to resolve its lowest frequency. */
  get requiredFrameSize(): number {
    return (this.tauMax + 1) * 2;
  }

  detect(frame: Float32Array): PitchEstimate {
    const rms = computeRms(frame);
    if (rms < this.rmsThreshold) {
      return { frequency: null, clarity: 0, rms, silent: true };
    }

    const tauMax = Math.min(this.tauMax, Math.floor(frame.length / 2) - 1);
    if (tauMax <= this.tauMin) {
      return { frequency: null, clarity: 0, rms, silent: false };
    }

    const cmnd = this.cmnd;
    const windowSize = frame.length - tauMax;

    // Steps 1 & 2: squared difference function, then cumulative mean normalisation.
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < windowSize; i++) {
        const delta = frame[i]! - frame[i + tau]!;
        sum += delta * delta;
      }
      runningSum += sum;
      cmnd[tau] = runningSum === 0 ? 1 : (sum * tau) / runningSum;
    }

    // Step 3: first local minimum below the absolute threshold.
    let tauEstimate = -1;
    for (let tau = this.tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau]! < this.threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1]! < cmnd[tau]!) tau++;
        tauEstimate = tau;
        break;
      }
    }

    // Fallback: no lag cleared the threshold, so take the global minimum and let
    // the clarity value tell the caller how much to trust it.
    if (tauEstimate === -1) {
      let best = this.tauMin;
      for (let tau = this.tauMin + 1; tau <= tauMax; tau++) {
        if (cmnd[tau]! < cmnd[best]!) best = tau;
      }
      tauEstimate = best;
    }

    // Step 4: octave recovery. A plucked bass note often shows its strongest dip
    // at half the true period. If an integer multiple of the chosen lag dips
    // nearly as low, that longer lag is the real fundamental.
    tauEstimate = this.recoverOctave(cmnd, tauEstimate, tauMax);

    // Step 5: parabolic interpolation around the minimum for sub-sample accuracy,
    // which is what makes a ±1 cent tuner readout possible at all.
    const refinedTau = parabolicRefine(cmnd, tauEstimate, tauMax);
    const frequency = this.sampleRate / refinedTau;
    const clarity = Math.max(0, Math.min(1, 1 - cmnd[tauEstimate]!));

    if (frequency < this.sampleRate / this.tauMax || frequency > this.sampleRate / this.tauMin) {
      return { frequency: null, clarity, rms, silent: false };
    }

    return { frequency, clarity, rms, silent: false };
  }

  /**
   * Guard against locking onto a harmonic instead of the fundamental.
   *
   * Direction matters. YIN already takes the *shortest* qualifying lag, so it
   * rarely reports an octave too low; the failure mode on bass is the opposite —
   * a fundamental so weak that the 2nd harmonic's dip is the first one under the
   * threshold, and the reported note comes out an octave high.
   *
   * So we only look at longer lags, and only when the current dip is mediocre.
   * If the chosen lag is already a deep minimum the period is right, and
   * doubling it would invent a sub-harmonic — the bug this guard exists to
   * avoid in the first place.
   */
  private recoverOctave(cmnd: Float32Array, tau: number, tauMax: number): number {
    const base = cmnd[tau]!;
    if (base < 0.10) return tau; // already an unambiguous match

    let best = tau;
    let bestValue = base;

    for (const multiple of [2, 3, 4]) {
      const candidate = tau * multiple;
      if (candidate > tauMax) break;
      const local = localMinimumNear(
        cmnd,
        candidate,
        Math.max(2, Math.round(candidate * 0.03)),
        tauMax,
      );
      if (local === null) continue;
      // The longer lag has to be decisively better, not merely comparable.
      if (cmnd[local]! < bestValue * 0.8) {
        best = local;
        bestValue = cmnd[local]!;
      }
    }
    return best;
  }
}

/** Search a small window around `centre` for the lowest cmnd value. */
function localMinimumNear(
  cmnd: Float32Array,
  centre: number,
  radius: number,
  tauMax: number,
): number | null {
  const from = Math.max(1, centre - radius);
  const to = Math.min(tauMax, centre + radius);
  if (from > to) return null;
  let best = from;
  for (let tau = from + 1; tau <= to; tau++) {
    if (cmnd[tau]! < cmnd[best]!) best = tau;
  }
  return best;
}

/** Fit a parabola through (tau-1, tau, tau+1) and return the interpolated minimum. */
function parabolicRefine(cmnd: Float32Array, tau: number, tauMax: number): number {
  if (tau <= 0 || tau >= tauMax) return tau;
  const prev = cmnd[tau - 1]!;
  const current = cmnd[tau]!;
  const next = cmnd[tau + 1]!;
  const denominator = 2 * (2 * current - next - prev);
  if (denominator === 0) return tau;
  const shift = (next - prev) / denominator;
  // Guard against a degenerate fit throwing the estimate into the next lag bin.
  return Math.abs(shift) < 1 ? tau + shift : tau;
}

export function computeRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i]!;
    sum += sample * sample;
  }
  return Math.sqrt(sum / frame.length);
}

/** Convenience wrapper for one-shot analysis (tests, benchmarks, offline files). */
export function detectPitch(frame: Float32Array, options: PitchDetectorOptions): PitchEstimate {
  return new YinDetector(options).detect(frame);
}
