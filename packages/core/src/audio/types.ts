/** Raw output of a pitch detector for one analysis frame. */
export interface PitchEstimate {
  /** Fundamental frequency in Hz, or null when nothing reliable was found. */
  readonly frequency: number | null;
  /** 0..1 periodicity confidence. Below ~0.75 the estimate is not worth showing. */
  readonly clarity: number;
  /** RMS level of the analysed frame, 0..1. */
  readonly rms: number;
  /** True when the frame was rejected by the amplitude gate rather than by clarity. */
  readonly silent: boolean;
  /**
   * Signal-quality measurements used to tell an instrument apart from speech and
   * room noise. Optional: a detector configured without spectral analysis, and
   * the unit tests that predate it, simply omit this.
   */
  readonly quality?: FrameQuality;
}

/**
 * Per-frame signal measurements, produced by the analysis pipeline.
 * All are cheap to compute and none require history.
 */
export interface FrameQuality {
  /** YIN periodicity, 0..1. */
  readonly clarity: number;
  /** Spectral flatness, 0..1. Low means tonal. */
  readonly flatness: number;
  /** Share of energy on the harmonic series of the detected pitch, 0..1. */
  readonly harmonicRatio: number;
  /** Normalised zero-crossing rate, 0..1. */
  readonly zeroCrossingRate: number;
  readonly rms: number;
  /** True when this frame begins a new note. */
  readonly onset: boolean;
}

export interface PitchDetectorOptions {
  readonly sampleRate: number;
  /** Lowest fundamental to search for. Bass 5-string needs ~26 Hz; guitar can start at 70 Hz. */
  readonly minFrequency: number;
  readonly maxFrequency: number;
  /** YIN absolute threshold. 0.10–0.15 is the usual range; lower is stricter. */
  readonly threshold?: number;
  /** Frames quieter than this RMS are treated as silence. */
  readonly rmsThreshold?: number;
}
