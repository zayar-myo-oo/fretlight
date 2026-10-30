"use client";
import { PolyphonicDetector, type PolyphonicFrame } from "@fretlight/core";
import { classifyDevice, noiseFloorFor } from "./audio-input";
import { sharedInput, type InputSession } from "./shared-input";
import { captureEvents } from "./session-recording";
export type ChordFrame = PolyphonicFrame;

export class ChordListener {
  private input: InputSession | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  get running() { return this.timer !== null; }

  /** Owns its input: opens (and later closes) the shared session. */
  async start(deviceId: string, label: string, onFrame: (frame: ChordFrame) => void, onLost?: () => void): Promise<void> {
    void this.stop();
    const ticket = ++this.generation;
    try {
      const input = await sharedInput.open(deviceId);
      if (ticket !== this.generation) { await input.close(); return; }
      this.input = input;
      this.run(input, label, onFrame, onLost);
    } catch (error) {
      if (ticket === this.generation) await this.stop();
      throw error;
    }
  }

  /**
   * Borrow an input another consumer already opened (the note detector), so
   * notes and chords run side by side on one stream. Never closes it.
   */
  attach(input: InputSession, label: string, onFrame: (frame: ChordFrame) => void, onLost?: () => void): void {
    void this.stop();
    ++this.generation;
    this.run(input, label, onFrame, onLost);
  }

  private analyser: AnalyserNode | null = null;
  private run(input: InputSession, label: string, onFrame: (frame: ChordFrame) => void, onLost?: () => void): void {
    {
      const analyser = input.context.createAnalyser();
      // ~186 ms at 44.1k; keep comparable resolution at 96k.
      analyser.fftSize = input.context.sampleRate > 48000 ? 16384 : 8192;
      analyser.smoothingTimeConstant = 0;
      input.gain.connect(analyser);
      this.analyser = analyser;
      const detector = new PolyphonicDetector(input.context.sampleRate, analyser.fftSize, noiseFloorFor(classifyDevice(label || input.stream.getAudioTracks()[0]?.label || "")));
      const wave = new Float32Array(analyser.fftSize);
      this.unsubscribe = sharedInput.subscribe(() => {
        if (sharedInput.current !== input) { void this.stop(); onLost?.(); }
      });
      this.timer = setInterval(() => {
        if (input.context.state !== "running") return;
        analyser.getFloatTimeDomainData(wave);
        const frame = detector.process(wave);
        captureEvents.push(input.context.currentTime, { kind: "chord", chord: frame.chord, notes: frame.notes });
        onFrame(frame);
      }, 50);
    }
  }
  async stop(): Promise<void> {
    ++this.generation;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.(); this.unsubscribe = null;
    try { this.analyser?.disconnect(); } catch { /* context already closed */ }
    this.analyser = null;
    const input = this.input; this.input = null;
    await input?.close();
  }
}
