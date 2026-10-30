"use client";

import {
  type Fretboard,
  InstrumentGate,
  NoteStabilizer,
  type PitchReading,
  type PitchState,
  PitchStateMachine,
  type PositionCandidate,
  type PositionContext,
  PositionEstimator,
  type RejectReason,
  type StabilizerEvent,
  appBus,
  assessSignal,
  getInstrument,
} from "@fretlight/core";
import {
  MicrophonePermissionError,
  MicrophonePitchSource,
  type MicrophoneOptions,
} from "./microphone-pitch-source";
import { MockPitchSource } from "./mock-pitch-source";
import {
  EMPTY_AUDIO_STATE,
  EMPTY_PITCH_STATE,
  EMPTY_POSITION_STATE,
  EMPTY_SIGNAL_STATE,
  type AudioState,
  type FretPositionStateSlice,
  type PitchStateSlice,
  type SignalStateSlice,
  reuseIfEqual,
} from "./detection-state";
import { sharedInput } from "./shared-input";
import { captureEvents } from "./session-recording";
import type { InputType } from "./audio-input";
import type { PitchFrame, PitchSource, PitchSourceKind } from "./pitch-source";

export interface DetectionSnapshot {
  readonly listening: boolean;
  readonly sourceKind: PitchSourceKind;
  readonly sourceLabel: string;
  readonly error: string | null;
  readonly starting: boolean;

  /** What the UI should be showing: no_signal | detecting | stable | holding. */
  readonly uiState: PitchState["state"];
  /** The reading to display. Survives brief signal loss while `uiState` is "holding". */
  readonly reading: PitchReading | null;
  readonly activeMidi: number | null;
  /** True while the display is being held after the signal stopped. */
  readonly held: boolean;

  /** 0..1 — how confident we are this is the instrument and not the room. */
  readonly instrumentConfidence: number;
  /** Why the last frame was rejected, when it was. */
  readonly rejectReason: RejectReason | null;
  readonly clarity: number;
  readonly rms: number;
  readonly peak: number;

  /**
   * The single most likely place the note was played — not every position where
   * that pitch exists.
   */
  readonly position: PositionCandidate | null;
  /** All mathematically possible positions, ranked. For the "other places" hint. */
  readonly candidates: readonly PositionCandidate[];

  /** Increments once per committed note — animations key off this. */
  readonly noteEventId: number;
}

const EMPTY: DetectionSnapshot = {
  listening: false,
  sourceKind: "mock",
  sourceLabel: "Virtual instrument",
  error: null,
  starting: false,
  uiState: "no_signal",
  reading: null,
  activeMidi: null,
  held: false,
  instrumentConfidence: 0,
  rejectReason: null,
  clarity: 0,
  rms: 0,
  peak: 0,
  position: null,
  candidates: [],
  noteEventId: 0,
};

/**
 * Where raw pitch frames become application state.
 *
 * The chain, in order, and why each stage is here:
 *
 * ```
 * frame → InstrumentGate   is this the instrument, or someone talking?
 *       → NoteStabilizer   median + agreement, kills per-frame jitter
 *       → PitchStateMachine what the tuner displays, with hold and hysteresis
 *       → PositionEstimator where on the neck it was most likely played
 *       → rAF-batched notify
 * ```
 *
 * Deliberately not a React store. Frames arrive tens of times a second, and
 * notifying React on each one would re-render the tree at audio rate. Components
 * attach through `useSyncExternalStore`, and notifications are coalesced onto an
 * animation frame — so the UI updates at most once per painted frame no matter
 * how fast the detector runs.
 */
/**
 * Baseline the "Noise Gate" calibration control scales. Matches the silence
 * floor `assessSignal` already uses for the "no signal" UI state, so a
 * multiplier of 1 lines up with what the player already sees as silence.
 */
const NOISE_GATE_BASE = 0.006;

/** How many frames of agreement/silence the stabiliser waits for — the user-facing "Smoothing" control. */
export type SmoothingLevel = "low" | "medium" | "high";
const SMOOTHING_PRESETS: Record<SmoothingLevel, { confirmFrames: number; releaseFrames: number }> = {
  low: { confirmFrames: 2, releaseFrames: 5 },
  medium: { confirmFrames: 3, releaseFrames: 8 },
  high: { confirmFrames: 5, releaseFrames: 12 },
};

class DetectionHub {
  private source: PitchSource = new MockPitchSource();
  private stabilizer = new NoteStabilizer(SMOOTHING_PRESETS.medium);
  private gate = new InstrumentGate();
  private pitchState = new PitchStateMachine();
  private estimator: PositionEstimator | null = null;

  // --- User calibration, applied without ever restarting the input stream ---
  private gain = 1;
  /** Extra multiple of the base silence floor a frame's RMS must clear. 1 = off. */
  private noiseGateMultiplier = 1;
  private smoothing: SmoothingLevel = "medium";

  private unsubscribeSource: (() => void) | null = null;
  private snapshot: DetectionSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private noteCounter = 0;
  private operation = 0;

  /** Context the camera and the practice engine can feed the position estimator. */
  private positionContext: PositionContext = {};

  private inputType: InputType = "microphone";
  private deviceId: string | null = null;

  private frameHandle: number | null = null;
  private dirty = false;

  // --- Separated state slices (see detection-state.ts) ---
  private audioState: AudioState = EMPTY_AUDIO_STATE;
  private pitchStateSlice: PitchStateSlice = EMPTY_PITCH_STATE;
  private positionState: FretPositionStateSlice = EMPTY_POSITION_STATE;
  private signalState: SignalStateSlice = EMPTY_SIGNAL_STATE;

  constructor() {
    sharedInput.subscribe(() => {
      if (this.source.kind === "microphone" && sharedInput.current?.context.state !== "running") {
        this.resetStages();
        this.patch({ uiState: "no_signal", reading: null, activeMidi: null, held: false, position: null, candidates: [], instrumentConfidence: 0, rms: 0, peak: 0 });
      }
    });
  }

  getSnapshot = (): DetectionSnapshot => this.snapshot;
  getAudioState = (): AudioState => this.audioState;
  getPitchState = (): PitchStateSlice => this.pitchStateSlice;
  getPositionState = (): FretPositionStateSlice => this.positionState;
  getSignalState = (): SignalStateSlice => this.signalState;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get mock(): MockPitchSource | null {
    return this.source instanceof MockPitchSource ? this.source : null;
  }

  get currentSource(): PitchSource {
    return this.source;
  }

  now(): number {
    return this.source.now();
  }

  /**
   * Give the estimator a neck to reason about. Called when the instrument or
   * tuning changes; without it there is nothing to map a pitch onto.
   */
  setFretboard(board: Fretboard, instrumentId?: string): void {
    if (this.estimator) this.estimator.setBoard(board);
    else this.estimator = new PositionEstimator(board);

    if (instrumentId) {
      const profile = getInstrument(instrumentId);
      if (profile) this.gate = new InstrumentGate(profile.detection);
    }
  }

  /**
   * Evidence from elsewhere that narrows down where a note was played — the
   * camera's fretting-hand position, or the note a practice exercise expects.
   */
  setPositionContext(context: PositionContext): void {
    const previousAnchor = this.positionContext.handFret?.fret ?? null;
    const nextAnchor = context.handFret?.fret ?? null;
    this.positionContext = context;

    // Moving the hand invalidates the held position. Without this the
    // estimator's hysteresis — which exists to stop the highlight oscillating
    // between equivalent positions — also stops it responding when the player
    // explicitly says they have moved, so the control appears to do nothing.
    if (previousAnchor !== nextAnchor) {
      this.estimator?.reset();
      if (this.snapshot.activeMidi !== null && this.estimator) {
        const result = this.estimator.estimate(this.snapshot.activeMidi, context, 0);
        this.snapshot = { ...this.snapshot, position: result.best, candidates: result.candidates };
        this.deriveSlices();
        this.scheduleFlush();
      }
    }
  }

  async start(): Promise<void> {
    if (this.source.isRunning) return;
    const source = this.source;
    const ticket = ++this.operation;
    this.resetStages();
    this.unsubscribeSource?.();
    this.unsubscribeSource = source.onFrame(this.handleFrame);
    await source.start();
    if (ticket !== this.operation || source !== this.source) return;
    this.patch({
      listening: true,
      sourceKind: this.source.kind,
      sourceLabel: this.source.label,
    });
  }

  async stop(): Promise<void> {
    const ticket = ++this.operation;
    this.unsubscribeSource?.();
    this.unsubscribeSource = null;
    await this.source.stop();
    if (ticket !== this.operation) return;
    this.resetStages();
    this.snapshot = { ...EMPTY, sourceKind: this.source.kind, sourceLabel: this.source.label };
    this.deriveSlices();
    this.flush();
  }

  async setSource(source: PitchSource): Promise<void> {
    const wasRunning = this.source.isRunning;
    await this.stop();
    this.source = source;
    if (wasRunning) await this.start();
  }

  async useMicrophone(options: MicrophoneOptions): Promise<void> {
    this.patch({ starting: true, error: null });
    this.inputType = options.inputType ?? "microphone";
    this.deviceId = options.deviceId ?? null;

    const microphone = new MicrophonePitchSource({
      ...options,
      gain: this.gain,
      // An interface unplugged mid-session ends its track silently. Surface it
      // and fall back, rather than looking live while hearing nothing.
      onDeviceLost: () => {
        void this.handleDeviceLost();
      },
    });
    const ticket = ++this.operation;
    const previous = this.source;
    this.unsubscribeSource?.();
    this.resetStages();
    this.source = microphone;
    this.unsubscribeSource = microphone.onFrame(this.handleFrame);
    // Start synchronously from the gesture so AudioContext can be unlocked.
    const started = microphone.start();
    void started.catch(() => {});
    try {
      await previous.stop();
      await started;
      if (ticket !== this.operation) return;
      this.patch({ listening: true, sourceKind: "microphone", starting: false, error: null, sourceLabel: microphone.label });
    } catch (error) {
      await microphone.stop();
      if (ticket !== this.operation) return;
      this.unsubscribeSource?.();
      this.source = new MockPitchSource();
      await this.start();
      this.patch({ starting: false, error: error instanceof Error ? error.message : "Could not open the audio input." });
    }
  }

  /**
   * Turn the input off completely.
   *
   * Not the same as switching to the virtual instrument: this releases the
   * MediaStream, tears down the worklet and worker, and clears every piece of
   * pitch state so nothing stays lit on the fretboard. When the player says the
   * microphone is off, nothing should still be listening to it.
   */
  async disable(): Promise<void> {
    // Releases the MediaStream and tears down the worklet and worker — nothing
    // keeps listening to a microphone the player switched off.
    const stopped = this.stop();
    const ticket = this.operation;
    await stopped;
    if (ticket !== this.operation) return;
    this.deviceId = null;

    // Then fall back to the virtual instrument. The spec's "mic off, camera off"
    // mode is still a usable screen: tapping the neck should sound a note and
    // light it up, so the fretboard stays a manual instrument rather than going
    // inert. The source kind flips to "mock", which is what tells the UI the
    // microphone is off.
    this.source = new MockPitchSource();
    await this.start();
    this.patch({ error: null, starting: false });
  }

  async useVirtualInstrument(): Promise<void> {
    const stopped = this.stop();
    const ticket = this.operation;
    await stopped;
    if (ticket !== this.operation) return;
    this.source = new MockPitchSource();
    this.deviceId = null;
    await this.start();
    this.patch({ error: null, starting: false });
  }

  /** The selected device disappeared — say so and keep the app usable. */
  private async handleDeviceLost(): Promise<void> {
    const stopped = this.stop();
    const ticket = this.operation;
    await stopped;
    if (ticket !== this.operation) return;
    this.source = new MockPitchSource();
    this.deviceId = null;
    await this.start();
    this.patch({
      starting: false,
      error: "The audio input was disconnected. Reconnect it and choose it again.",
    });
  }

  async retune(options: MicrophoneOptions): Promise<void> {
    if (this.source instanceof MicrophonePitchSource && this.source.isRunning) {
      await this.source.reconfigure(options);
    }
  }

  clearError(): void {
    if (this.snapshot.error !== null) this.patch({ error: null });
  }

  // --- Calibration ------------------------------------------------------
  //
  // All three of these apply live, with nothing restarted: gain is a
  // GainNode's value, the noise gate is an extra check this class already
  // makes on every frame, and smoothing just swaps which NoteStabilizer
  // instance handleFrame reads next. None of them touch the MediaStream,
  // the AudioWorklet or the analysis worker.

  /** Software input gain, 1 = unity. */
  setGain(gain: number): void {
    this.gain = gain;
    if (this.source instanceof MicrophonePitchSource) this.source.setGain(gain);
  }

  get currentGain(): number {
    return this.gain;
  }

  /** How much above the measured noise floor a frame must be to count, 1 = default. */
  setNoiseGateMultiplier(multiplier: number): void {
    this.noiseGateMultiplier = Math.max(0.5, multiplier);
  }

  get currentNoiseGateMultiplier(): number {
    return this.noiseGateMultiplier;
  }

  setSmoothing(level: SmoothingLevel): void {
    if (this.smoothing === level) return;
    this.smoothing = level;
    // A fresh stabiliser rather than mutating one in place: it carries a
    // short median-filter history that would otherwise mix frames analysed
    // under the old settings with the new ones.
    this.stabilizer = new NoteStabilizer(SMOOTHING_PRESETS[level]);
  }

  get currentSmoothing(): SmoothingLevel {
    return this.smoothing;
  }

  /** Browser-reported output latency, for the calibration panel's read-only figure. */
  get estimatedLatencySeconds(): number | null {
    return this.source instanceof MicrophonePitchSource ? this.source.estimatedLatencySeconds : null;
  }

  // --- The hot path ---------------------------------------------------------

  private handleFrame = (frame: PitchFrame): void => {
    const timeMs = frame.time * 1000;

    // 0. The user's noise-gate control, layered on top of the pipeline's own
    //    adaptive floor. That floor is tuned for a typical room; a player in
    //    a genuinely noisy one can raise this further without touching the
    //    input stream. At the default multiplier this never fires — the
    //    pipeline's own floor already decided the frame was worth analysing.
    const estimate =
      this.noiseGateMultiplier > 1 && frame.estimate.rms < NOISE_GATE_BASE * this.noiseGateMultiplier
        ? { ...frame.estimate, frequency: null, silent: true }
        : frame.estimate;

    // 1. Is this the instrument at all? Speech and room noise stop here.
    const verdict = this.gate.evaluate(
      estimate,
      frame.estimate.quality ?? {
        clarity: frame.estimate.clarity,
        // Without spectral analysis, fall back to neutral values so the gate
        // still works on clarity and pitch stability alone.
        flatness: 0.2,
        harmonicRatio: 0.4,
        zeroCrossingRate: 0.08,
        rms: frame.estimate.rms,
        onset: false,
      },
    );

    // 2. Per-frame jitter removal. Only frames the gate accepted get through, so
    //    a conversation never reaches the stabiliser's agreement counter.
    const event: StabilizerEvent = verdict.accepted
      ? this.stabilizer.push(estimate)
      : this.stabilizer.push({ ...estimate, frequency: null, silent: true });

    const stabilised =
      event.type === "confirmed" || event.type === "sustained" || event.type === "candidate"
        ? event.reading
        : null;

    // 3. What the tuner should display, with hold and hysteresis.
    const display = this.pitchState.update({
      reading: stabilised,
      accepted: verdict.accepted,
      confidence: verdict.confidence,
      timeMs,
    });

    // 4. Where on the neck it was most likely played.
    const committed = display.midi !== null && display.state === "stable";
    let position = this.snapshot.position;
    let candidates = this.snapshot.candidates;

    if (committed && this.estimator) {
      if (display.midi !== this.snapshot.activeMidi || position === null) {
        // How much to trust the pitch itself, straight from the instrument
        // gate that just evaluated this frame — a shaky reading should not
        // be allowed to bounce the highlight off a position it was already
        // holding confidently.
        const context: PositionContext = { ...this.positionContext, pitchConfidence: verdict.confidence };
        const result = this.estimator.estimate(display.midi!, context, timeMs);
        position = result.best;
        candidates = result.candidates;
      }
    } else if (display.state === "no_signal") {
      position = null;
      candidates = [];
      this.estimator?.release(timeMs);
    }

    const noteChanged = display.midi !== this.snapshot.activeMidi && display.midi !== null;
    if (noteChanged) this.noteCounter++;

    this.snapshot = {
      ...this.snapshot,
      uiState: display.state,
      reading: display.reading,
      activeMidi: display.midi,
      held: display.held,
      instrumentConfidence: verdict.confidence,
      rejectReason: verdict.accepted ? null : verdict.reason,
      clarity: frame.estimate.clarity,
      rms: frame.estimate.rms,
      peak: frame.estimate.peak,
      position,
      candidates,
      noteEventId: this.noteCounter,
    };

    if (this.source.kind === "microphone") captureEvents.push(this.source.now(), {
      kind: "note", midi: committed ? display.midi : null,
      frequency: committed ? display.reading?.frequency ?? null : null,
      confidence: committed ? verdict.confidence : 0,
    });
    this.deriveSlices();
    this.dispatch(event, frame);
    this.scheduleFlush();
  };

  /**
   * Project the internal snapshot onto the four slices, reusing the previous
   * object whenever nothing in that slice changed.
   */
  private deriveSlices(): void {
    const snap = this.snapshot;

    this.audioState = reuseIfEqual(this.audioState, {
      listening: snap.listening,
      starting: snap.starting,
      sourceKind: snap.sourceKind,
      inputType: this.inputType,
      deviceId: this.deviceId,
      deviceLabel: snap.sourceLabel,
      // Bucketed: the meter does not need frame-accurate values, and this stops
      // the audio slice invalidating on every single frame.
      signalStrength: Math.round(snap.rms * 100) / 100,
      peakLevel: Math.round(snap.peak * 100) / 100,
      error: snap.error,
    });

    this.pitchStateSlice = reuseIfEqual(this.pitchStateSlice, {
      frequency: snap.reading ? Math.round(snap.reading.frequency * 100) / 100 : null,
      noteName: snap.reading?.note.name ?? null,
      octave: snap.reading?.note.octave ?? null,
      midi: snap.activeMidi,
      cents: snap.reading ? Math.round(snap.reading.cents * 10) / 10 : null,
      confidence: Math.round(snap.instrumentConfidence * 100) / 100,
      display: snap.uiState,
      held: snap.held,
    });

    const assessment = assessSignal({
      listening: snap.listening,
      rms: snap.rms,
      peak: snap.peak,
      instrumentConfidence: snap.instrumentConfidence,
      rejectReason: snap.rejectReason,
      display: snap.uiState,
      positionScore: snap.position?.score ?? null,
    });

    this.signalState = reuseIfEqual(this.signalState, {
      state: assessment.signal,
      message: assessment.message,
      rejectReason: snap.rejectReason,
    });

    this.positionState = reuseIfEqual(this.positionState, {
      string: snap.position?.string ?? null,
      fret: snap.position?.fret ?? null,
      noteName: snap.position?.name ?? null,
      confidence: Math.round((snap.position?.score ?? 0) * 100) / 100,
      state: assessment.position,
      candidates: snap.candidates.map((c) => ({
        string: c.string, fret: c.fret, name: c.name, score: c.score,
      })),
    });
  }

  /** Mirror detection onto the app-wide bus for non-React consumers. */
  private dispatch(event: StabilizerEvent, frame: PitchFrame): void {
    switch (event.type) {
      case "candidate":
        appBus.emit("NOTE_DETECTED", { reading: event.reading, clarity: event.clarity });
        break;
      case "confirmed":
        appBus.emit("NOTE_CONFIRMED", {
          reading: event.reading,
          clarity: event.clarity,
          time: frame.time,
        });
        break;
      case "released":
        appBus.emit("NOTE_RELEASED", { midi: event.midi, time: frame.time });
        break;
      case "silent":
      case "sustained":
        break;
    }
  }

  /**
   * Coalesce notifications onto an animation frame.
   *
   * The detector can produce frames faster than the display refreshes, and there
   * is no value in a React render that is painted over before it is seen. One
   * notification per frame, at most.
   */
  private scheduleFlush(): void {
    this.dirty = true;
    if (this.frameHandle !== null) return;
    if (typeof requestAnimationFrame === "undefined") {
      this.flush();
      return;
    }
    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = null;
      if (this.dirty) this.flush();
    });
  }

  private patch(partial: Partial<DetectionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.deriveSlices();
    this.flush();
  }

  private flush(): void {
    this.dirty = false;
    for (const listener of this.listeners) listener();
  }

  private resetStages(): void {
    this.stabilizer.reset();
    this.gate.reset();
    this.pitchState.reset();
    this.estimator?.reset();
  }
}

/** One microphone and one detector per tab, so one hub. */
export const detectionHub = new DetectionHub();

// Exposed in development only, for inspecting the live pipeline from the console.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__hub = detectionHub;
}
