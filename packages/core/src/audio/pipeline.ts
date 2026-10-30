import { SignalConditioner } from "./conditioning";
import { Decimator, chooseDecimationFactor } from "./decimate";
import {
  SpectrumAnalyzer,
  harmonicEnergyRatio,
  previousPowerOfTwo,
  spectralFlatness,
  zeroCrossingRate,
} from "./fft";
import { NoiseFloorTracker } from "./noise-floor";
import { OnsetDetector } from "./onset";
import type { FrameQuality, PitchDetectorOptions, PitchEstimate } from "./types";
import { YinDetector, computePeak, computeRms } from "./yin";

export interface PitchPipelineOptions extends PitchDetectorOptions {
  /** Override the automatic decimation factor. 1 disables decimation entirely. */
  readonly decimationFactor?: number;
  /**
   * Compute spectral quality metrics alongside the pitch estimate.
   * These are what let the instrument gate reject speech and room noise, so the
   * live pipeline enables them; offline pitch benchmarks do not need them.
   */
  readonly analyzeQuality?: boolean;
  /**
   * Let the silence threshold follow the room instead of being fixed.
   *
   * On by default: a fixed floor is the single biggest cause of "it only hears
   * me when I dig in", because it has to be set for the worst room anyone might
   * use. `rmsThreshold`, when given, becomes the absolute minimum rather than
   * the whole answer.
   */
  readonly adaptiveNoiseFloor?: boolean;
}

/**
 * The complete analysis chain for one frame of audio:
 *
 *   condition (DC block, band limit) → decimate → YIN → estimate
 *
 * Packaged as one object because the order and the shared configuration matter,
 * and because every caller — the AudioWorklet path, the Web Worker, the offline
 * benchmark, the unit tests — must run the identical chain. If the worker and
 * the test harness could drift apart, the tests would stop meaning anything.
 *
 * Stateful across frames (the filters carry memory), allocation-free once warm.
 */
export class PitchPipeline {
  private readonly conditioner: SignalConditioner;
  private readonly decimator: Decimator;
  private readonly detector: YinDetector;
  private readonly rmsThreshold: number;
  private readonly noiseFloor: NoiseFloorTracker | null;
  private readonly spectrum: SpectrumAnalyzer | null;
  private readonly onsetDetector: OnsetDetector | null;
  private scratch: Float32Array;

  constructor(private readonly options: PitchPipelineOptions) {
    const factor =
      options.decimationFactor ??
      chooseDecimationFactor(options.sampleRate, options.maxFrequency);

    this.conditioner = new SignalConditioner(
      options.sampleRate,
      options.minFrequency,
      // Keep the conditioner's ceiling below the decimated Nyquist, or its
      // passband would hand aliasing straight to the decimator.
      Math.min(options.maxFrequency * 6, (options.sampleRate / factor) * 0.4),
    );
    this.decimator = new Decimator(options.sampleRate, factor);
    this.detector = new YinDetector({
      ...options,
      sampleRate: this.decimator.decimatedRate,
      // The pipeline owns the silence decision, and it makes that decision
      // against the room's measured noise floor. Leaving the detector's own
      // fixed threshold in place gated a second time, higher, and against the
      // *decimated* signal — so quiet playing was discarded here no matter how
      // low the adaptive floor went. This is why the app "only heard you when
      // you dug in".
      rmsThreshold: 0,
    });
    this.rmsThreshold = options.rmsThreshold ?? 0.008;
    this.noiseFloor =
      (options.adaptiveNoiseFloor ?? true)
        ? new NoiseFloorTracker({ absoluteFloor: Math.min(this.rmsThreshold, 0.0015) })
        : null;

    if (options.analyzeQuality) {
      // Sized against the decimated frame, so the transform stays cheap and its
      // bins stay narrow enough to resolve a bass fundamental's partials.
      const decimatedFrame = Math.floor(
        (this.detector.requiredFrameSize * this.decimator.factor) / this.decimator.factor,
      );
      this.spectrum = new SpectrumAnalyzer(
        Math.max(256, Math.min(1024, previousPowerOfTwo(decimatedFrame))),
      );
      this.onsetDetector = new OnsetDetector();
    } else {
      this.spectrum = null;
      this.onsetDetector = null;
    }

    this.scratch = new Float32Array(0);
  }

  get decimationFactor(): number {
    return this.decimator.factor;
  }

  get decimatedRate(): number {
    return this.decimator.decimatedRate;
  }

  /** Frame length, in original-rate samples, needed to resolve minFrequency. */
  get requiredFrameSize(): number {
    // Four periods give the independent window filters time to settle before
    // YIN compares the low-E waveform; two periods were phase-sensitive live.
    return this.detector.requiredFrameSize * this.decimator.factor * 2;
  }

  process(frame: Float32Array): PitchEstimate {
    // Gate on the *raw* level: conditioning and decimation on silence is wasted
    // work, and this is the common case between notes.
    const rawRms = computeRms(frame);
    const rawPeak = computePeak(frame);
    this.noiseFloor?.observe(rawRms);
    const threshold = this.noiseFloor ? this.noiseFloor.threshold : this.rmsThreshold;
    if (rawRms < threshold) {
      // Keep the onset baseline tracking through silence, otherwise the first
      // note after a pause is measured against a stale reference level.
      this.onsetDetector?.push(rawRms);
      return { frequency: null, clarity: 0, rms: rawRms, peak: rawPeak, silent: true };
    }

    if (this.scratch.length !== frame.length) this.scratch = new Float32Array(frame.length);
    this.scratch.set(frame);
    // Worklet frames overlap: carrying IIR state from the previous window's
    // END into this window's earlier START creates a discontinuity every hop.
    // Each complete window is conditioned independently; temporal gate/onset
    // state remains continuous below.
    this.conditioner.reset();
    this.decimator.reset();
    this.conditioner.processInPlace(this.scratch);

    const decimated = this.decimator.process(this.scratch);
    const estimate = this.detector.detect(decimated);

    // Report the level the caller can reason about — the input's, not the
    // filtered and downsampled signal's. Peak specifically must come from the
    // raw frame: it exists to catch clipping at the input stage, which
    // conditioning and decimation would already have smoothed away.
    const base = { ...estimate, rms: rawRms, peak: rawPeak };
    if (!this.spectrum || !this.onsetDetector) return base;

    const magnitudes = this.spectrum.analyze(decimated);
    const quality: FrameQuality = {
      clarity: estimate.clarity,
      flatness: spectralFlatness(magnitudes),
      harmonicRatio:
        estimate.frequency === null
          ? 0
          : harmonicEnergyRatio(magnitudes, estimate.frequency, this.decimator.decimatedRate),
      zeroCrossingRate: zeroCrossingRate(decimated),
      rms: rawRms,
      onset: this.onsetDetector.push(rawRms).onset,
    };
    return { ...base, quality };
  }

  reset(): void {
    this.conditioner.reset();
    this.decimator.reset();
    this.onsetDetector?.reset();
    this.noiseFloor?.reset();
  }

  /** Current silence threshold and the ambient level it was derived from. */
  get noiseFloorState(): { threshold: number; ambient: number } {
    return {
      threshold: this.noiseFloor ? this.noiseFloor.threshold : this.rmsThreshold,
      ambient: this.noiseFloor?.ambientLevel ?? 0,
    };
  }

  /** The configuration this pipeline was built with, for diagnostics. */
  get config(): PitchPipelineOptions {
    return this.options;
  }
}
