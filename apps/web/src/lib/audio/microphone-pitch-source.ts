"use client";

import { PitchPipeline, type PitchEstimate } from "@fretlight/core";
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
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private listeners = new Set<(frame: PitchFrame) => void>();
  private running = false;

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

    const stream = await this.requestStream();
    this.stream = stream;

    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    if (context.state === "suspended") await context.resume();

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

    const node = new AudioWorkletNode(context, "frame-collector", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
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

    node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; time: number }>) => {
      const { samples, time } = event.data;
      worker.postMessage({ type: "frame", samples, time }, [samples.buffer]);
    };

    worker.onmessage = (
      event: MessageEvent<{ type: string; estimate?: PitchEstimate; time?: number }>,
    ) => {
      if (event.data.type !== "estimate" || !event.data.estimate) return;
      const frame: PitchFrame = {
        estimate: event.data.estimate,
        time: event.data.time ?? context.currentTime,
      };
      for (const listener of this.listeners) listener(frame);
    };

    context.createMediaStreamSource(stream).connect(node);

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
  }

  async stop(): Promise<void> {
    this.running = false;

    this.node?.port.postMessage("stop");
    this.node?.disconnect();
    this.node = null;

    this.worker?.terminate();
    this.worker = null;

    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;

    await this.context?.close();
    this.context = null;
  }

  /** Re-tune the detector's search range after an instrument change. */
  async reconfigure(options: MicrophoneOptions): Promise<void> {
    this.options = options;
    if (!this.running) return;
    await this.stop();
    await this.start();
  }

  private async requestStream(): Promise<MediaStream> {
    // Every one of these processors is tuned for speech and actively harmful
    // here: AGC pumps a decaying note, noise suppression treats a sustained
    // low bass fundamental as background hum and removes it, and echo
    // cancellation introduces comb filtering that wrecks periodicity.
    const audio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
    if (this.options.deviceId) audio.deviceId = { exact: this.options.deviceId };

    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new MicrophonePermissionError(
          "Microphone access was blocked. Allow it in your browser's site settings and try again.",
          "denied",
        );
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new MicrophonePermissionError(
          "No usable microphone or audio interface was found.",
          "unavailable",
        );
      }
      throw error;
    }
  }
}

/** Input devices, once permission has been granted at least once. */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput");
}
