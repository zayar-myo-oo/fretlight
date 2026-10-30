"use client";

import { PitchPipeline, type PitchEstimate } from "@fretlight/core";
import { sharedInput, type InputSession } from "./shared-input";
import { type InputType, noiseFloorFor } from "./audio-input";
import type { PitchFrame, PitchSource } from "./pitch-source";

export interface MicrophoneOptions {
  /** Lowest fundamental to search for — 26 Hz for a 5-string bass, 70 for guitar. */
  readonly minFrequency: number;
  readonly maxFrequency: number;
  /** Specific input device, from `navigator.mediaDevices.enumerateDevices()`. */
  readonly deviceId?: string;
  /**
   * Which kind of input this is. Both kinds run the identical pipeline; this
   * only sets the noise floor, which genuinely differs between a DI signal and
   * a microphone in a room.
   */
  readonly inputType?: InputType;
  /** Software gain applied before analysis, 1 = unity. */
  readonly gain?: number;
  /** Called when the device goes away mid-session — unplugged, or taken over. */
  readonly onDeviceLost?: () => void;
}

export class MicrophonePermissionError extends Error {
  constructor(
    message: string,
    readonly reason: "denied" | "unavailable" | "insecure" | "unsupported",
  ) {
    super(message);
    this.name = "MicrophonePermissionError";
  }
}

/** Smallest power of two at or above `value`. */
function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

/**
 * Live microphone input.
 *
 * ```
 * getUserMedia → AudioWorklet (framing) → Worker (conditioning, decimation, YIN)
 *   → PitchFrame → detectionHub → stabiliser → UI
 * ```
 *
 * Nothing in that chain leaves the device.
 */
export class MicrophonePitchSource implements PitchSource {
  readonly kind = "microphone" as const;
  label = "Microphone";

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private gainNode: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private listeners = new Set<(frame: PitchFrame) => void>();
  readonly diagnostics = { workletFrames: 0, workerFrames: 0, workerReady: false, processingMs: 0 };
  private running = false;
  private generation = 0;
  private input: InputSession | null = null;
  private unsubscribeInput: (() => void) | null = null;

  constructor(private options: MicrophoneOptions) {}

  get isRunning(): boolean {
    return this.running;
  }

  now(): number {
    return this.context?.currentTime ?? 0;
  }

  onFrame(listener: (frame: PitchFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.running) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new MicrophonePermissionError(
        typeof window !== "undefined" && !window.isSecureContext
          ? "Microphone access needs a secure context — use https:// or localhost."
          : "This browser does not expose microphone input.",
        typeof window !== "undefined" && !window.isSecureContext ? "insecure" : "unsupported",
      );
    }

    const ticket = ++this.generation;
    try {
      const input = await sharedInput.open(this.options.deviceId, this.options.gain);
      if (ticket !== this.generation) { await input.close(); return; }
      this.input = input;
      const { stream, context } = input;
      this.stream = stream;
      this.context = context;

      // Size the frame from what the detector actually needs at this sample rate:
      // a 30.87 Hz low B needs a much longer window than a guitar's low E, and
      // padding every instrument to the worst case would add latency for nothing.
      const probe = new PitchPipeline({
        sampleRate: context.sampleRate,
        minFrequency: this.options.minFrequency,
        maxFrequency: this.options.maxFrequency,
      });
      const rmsThreshold = noiseFloorFor(this.options.inputType ?? "microphone");
      const frameSize = nextPowerOfTwo(probe.requiredFrameSize);

      await context.audioWorklet.addModule("/worklets/frame-collector.js");
      if (ticket !== this.generation) return;

      const node = new AudioWorkletNode(context, "frame-collector", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { frameSize, hopSize: Math.max(256, frameSize >> 3) },
      });
      this.node = node;

      const worker = new Worker(new URL("./pitch.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.postMessage({
        type: "configure",
        options: {
          sampleRate: context.sampleRate,
          minFrequency: this.options.minFrequency,
          maxFrequency: this.options.maxFrequency,
          rmsThreshold,
          // Spectral flatness, harmonic ratio and onset detection — what the
          // instrument gate needs to tell a plucked string from a conversation.
          analyzeQuality: true,
        },
      });

      let inFlight = false;
      let submittedAt = 0;
      worker.onerror = () => { if (this.running) this.options.onDeviceLost?.(); };
      node.onprocessorerror = () => { if (this.running) this.options.onDeviceLost?.(); };
      node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; time: number }>) => {
        this.diagnostics.workletFrames++;
        if (inFlight || !this.running || context.state !== "running") return;
        inFlight = true;
        submittedAt = performance.now();
        const { samples, time } = event.data;
        worker.postMessage({ type: "frame", samples, time }, [samples.buffer]);
      };

      worker.onmessage = (
        event: MessageEvent<{ type: string; estimate?: PitchEstimate; time?: number }>,
      ) => {
        if (event.data.type === "ready") this.diagnostics.workerReady = true;
        if (event.data.type !== "estimate" || !event.data.estimate) return;
        this.diagnostics.workerFrames++;
        this.diagnostics.processingMs = performance.now() - submittedAt;
        inFlight = false;
        if (!this.running || context.state !== "running") return;
        const frame: PitchFrame = {
          estimate: event.data.estimate,
          time: event.data.time ?? context.currentTime,
        };
        for (const listener of this.listeners) listener(frame);
      };

      // A software gain stage ahead of analysis. getUserMedia's own AGC is
      // disabled (it pumps a decaying note), so this is the only volume control
      // there is — set once at unity by default, adjustable live via `setGain`
      // without touching the stream or restarting anything downstream.
      this.gainNode = input.gain;
      input.gain.connect(node);
      // Worklet outputs zeros; a destination connection keeps Safari pulling frames.
      node.connect(context.destination);
      this.unsubscribeInput = sharedInput.subscribe(() => {
        if (sharedInput.current !== input && this.running) {
          this.running = false;
          this.options.onDeviceLost?.();
        }
      });

      const track = stream.getAudioTracks()[0];
      if (track) {
        this.label = track.label || (this.options.inputType === "audio_interface" ? "Audio interface" : "Microphone");
        // An interface being unplugged ends the track rather than raising an
        // error. Without this the app would sit there looking live and deaf.
        track.addEventListener("ended", () => {
          if (!this.running) return;
          this.running = false;
          this.options.onDeviceLost?.();
        });
      }

      this.running = true;
    } catch (error) { if (ticket === this.generation) await this.stop(); throw error; }
  }

  async stop(): Promise<void> {
    this.running = false;
    ++this.generation;
    this.unsubscribeInput?.();
    this.unsubscribeInput = null;

    this.node?.port.postMessage("stop");
    this.node?.disconnect();
    this.node = null;
    this.gainNode?.disconnect();
    this.gainNode = null;

    this.worker?.terminate();
    this.worker = null;

    this.stream = null;
    const input = this.input;
    this.input = null;
    await input?.close();
    this.context = null;
  }

  /** Re-tune the detector's search range after an instrument change. */
  async reconfigure(options: MicrophoneOptions): Promise<void> {
    this.options = { ...this.options, ...options };
    if (!this.running) return;
    await this.stop();
    await this.start();
  }

  /** Live gain adjustment — no restart, takes effect on the next audio block. */
  setGain(gain: number): void {
    this.options = { ...this.options, gain };
    if (this.gainNode) this.gainNode.gain.value = gain;
  }

  /** Seconds of output-path latency the browser reports, for a calibration readout. */
  get estimatedLatencySeconds(): number | null {
    if (!this.context) return null;
    const base = this.context.baseLatency ?? 0;
    const output = this.context.outputLatency ?? 0;
    return base + output;
  }


}

/** Input devices, once permission has been granted at least once. */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput");
}
