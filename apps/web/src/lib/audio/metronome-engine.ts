"use client";

import {
  type ClickEvent,
  type MetronomeSettings,
  appBus,
  ticksInWindow,
} from "@fretlight/core";

/**
 * Web Audio metronome.
 *
 * The timing rule that matters: `setInterval` is not accurate enough to click
 * on, but it is accurate enough to *schedule* with. So a coarse timer wakes up
 * every 25 ms, asks the core for every tick falling in the next 120 ms, and
 * books them on the AudioContext clock — which is sample-accurate. Tempo stays
 * rock solid even while the main thread is busy rendering the fretboard.
 *
 * All beat maths lives in @fretlight/core; this class only owns the audio nodes
 * and the browser clock.
 */
export class MetronomeEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private scheduledUntil = 0;
  private running = false;
  private settings: MetronomeSettings;
  private volume = 0.6;

  private readonly lookaheadSeconds = 0.12;
  private readonly tickIntervalMs = 25;

  /** Fires slightly *before* each click sounds, so visuals can be scheduled too. */
  private beatListeners = new Set<(event: ClickEvent) => void>();

  constructor(settings: MetronomeSettings) {
    this.settings = settings;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Seconds on the audio clock — the same clock practice timing is graded on. */
  now(): number {
    return this.context?.currentTime ?? 0;
  }

  /**
   * The audio-clock instant beat zero actually falls on. A timed practice
   * exercise must start its own clock here, not at whatever moment
   * `start()` happened to be called — this already carries the small
   * scheduling pad `start()` adds so the first click is not clipped, and
   * grading against anything else would make every note in the run look
   * systematically early or late by that same fixed offset.
   */
  get startedAt(): number {
    return this.startTime;
  }

  onBeat(listener: (event: ClickEvent) => void): () => void {
    this.beatListeners.add(listener);
    return () => this.beatListeners.delete(listener);
  }

  update(settings: Partial<MetronomeSettings>): void {
    const previous = this.settings;
    this.settings = { ...previous, ...settings };
    if (settings.bpm !== undefined && settings.bpm !== previous.bpm) {
      appBus.emit("BPM_CHANGED", { bpm: settings.bpm });
    }
    // Re-anchor the grid to the next scheduling window so a tempo change takes
    // effect immediately instead of after the already-booked clicks.
    if (this.running && this.context) {
      this.startTime = this.context.currentTime;
      this.scheduledUntil = this.context.currentTime;
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  async start(): Promise<void> {
    if (this.running) return;
    const context = await this.ensureContext();
    this.startTime = context.currentTime + 0.08; // small pad so the first click is not clipped
    this.scheduledUntil = context.currentTime;
    this.running = true;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), this.tickIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async toggle(): Promise<void> {
    if (this.running) this.stop();
    else await this.start();
  }

  dispose(): void {
    this.stop();
    this.beatListeners.clear();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    // Browsers start contexts suspended until a user gesture.
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  private schedule(): void {
    const context = this.context;
    if (!context || !this.running) return;

    const until = context.currentTime + this.lookaheadSeconds;
    const from = Math.max(this.scheduledUntil, this.startTime);
    const events = ticksInWindow(this.settings, this.startTime, from, until);

    for (const event of events) {
      this.scheduleClick(event);
      this.notify(event);
      appBus.emit("BEAT_DETECTED", event);
    }
    this.scheduledUntil = until;
  }

  /**
   * Synthesised click rather than a sample: no asset to load, works offline on
   * first run, and the three accents stay perfectly matched in level.
   */
  private scheduleClick(event: ClickEvent): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const frequency = event.accent === "downbeat" ? 1760 : event.accent === "beat" ? 1320 : 880;
    const peak = event.accent === "downbeat" ? 1 : event.accent === "beat" ? 0.7 : 0.35;
    const duration = event.accent === "subdivision" ? 0.03 : 0.045;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, event.time);

    // Fast attack, exponential release: a click, not a beep.
    gain.gain.setValueAtTime(0.0001, event.time);
    gain.gain.exponentialRampToValueAtTime(peak, event.time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, event.time + duration);

    oscillator.connect(gain).connect(master);
    oscillator.start(event.time);
    oscillator.stop(event.time + duration + 0.01);
  }

  private notify(event: ClickEvent): void {
    const context = this.context;
    if (!context) return;
    // Hand the visual layer the event at the moment it sounds, not when it was booked.
    const delayMs = Math.max(0, (event.time - context.currentTime) * 1000);
    setTimeout(() => {
      for (const listener of this.beatListeners) listener(event);
    }, delayMs);
  }
}
