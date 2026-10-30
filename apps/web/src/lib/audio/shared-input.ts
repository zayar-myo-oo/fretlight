"use client";

/** One capture owner per tab. A new request invalidates all older pending opens. */
export interface InputSession {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  deviceId: string;
  close: () => Promise<void>;
}
export class SharedInput {
  current: InputSession | null = null;
  private generation = 0;
  private pending: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private notify() { for (const fn of this.listeners) fn(); }

  async open(deviceId = "", gain = 1): Promise<InputSession> {
    const ticket = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Audio input needs HTTPS and a browser with microphone support.");
    // Construct and resume on the click stack, before permission/device awaits (Safari).
    const context = new AudioContext({ latencyHint: "interactive" });
    const resumed = context.resume();
    // Handle rejection immediately, even while another permission prompt is pending.
    void resumed.catch(() => {});
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => { release = resolve; });
    let stream: MediaStream | undefined;
    try {
      await previous;
      await this.current?.close();
      if (ticket !== this.generation) throw new DOMException("Input request cancelled", "AbortError");
      await resumed;
      const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? {};
      const audio: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } };
      if (deviceId && supported.deviceId !== false) audio.deviceId = { exact: deviceId };
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      if (ticket !== this.generation) throw new DOMException("Input request cancelled", "AbortError");
      if (context.state !== "running") await context.resume();
      const source = context.createMediaStreamSource(stream);
      const gainNode = context.createGain();
      gainNode.gain.value = gain;
      source.connect(gainNode);
      let closed = false;
      const session: InputSession = {
        stream, context, source, gain: gainNode, deviceId,
        close: async () => {
          if (closed) return;
          closed = true;
          if (this.current === session) { this.current = null; this.notify(); }
          source.disconnect(); gainNode.disconnect();
          stream?.getTracks().forEach((track) => track.stop());
          context.removeEventListener("statechange", stateChange);
          if (context.state !== "closed") await context.close();
        },
      };
      const stateChange = () => { this.notify(); };
      context.addEventListener("statechange", stateChange);
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => { void session.close(); }, { once: true }));
      this.current = session;
      this.notify();
      return session;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context.state !== "closed") await context.close();
      throw error;
    } finally { release(); }
  }

  async resume(): Promise<void> {
    const context = this.current?.context;
    if (context && context.state !== "running") await context.resume();
    this.notify();
  }
  async stop(): Promise<void> { ++this.generation; await this.current?.close(); }
}
export const sharedInput = new SharedInput();
