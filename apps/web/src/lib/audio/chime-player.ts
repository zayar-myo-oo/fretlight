export type ChimeLevel = "normal" | "mid" | "high";

const CHIME_SOURCES: Record<ChimeLevel, string> = {
  normal: "/sounds/tuner-chime-normal.m4a",
  mid: "/sounds/tuner-chime-mid.m4a",
  high: "/sounds/tuner-chime-high.m4a",
};

/**
 * Plays the tuner's recorded "in tune" clips.
 *
 * Decoded once per level and cached as an `AudioBuffer` — a repeated string
 * re-triggers this far too often to re-fetch or re-decode every time. Uses
 * its own `AudioContext` rather than sharing one with `ReferenceToneEngine`:
 * the two are independent features that happen to run at the same time, and
 * tying their lifecycles together would mean disposing one for a reason that
 * has nothing to do with the other.
 */
export class ChimePlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<ChimeLevel, AudioBuffer>();
  private pending = new Map<ChimeLevel, Promise<AudioBuffer>>();

  async play(level: ChimeLevel): Promise<void> {
    const context = await this.ensureContext();
    const buffer = await this.loadBuffer(level, context);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master!);
    source.start();
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.buffers.clear();
    this.pending.clear();
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  private loadBuffer(level: ChimeLevel, context: AudioContext): Promise<AudioBuffer> {
    const cached = this.buffers.get(level);
    if (cached) return Promise.resolve(cached);

    const inFlight = this.pending.get(level);
    if (inFlight) return inFlight;

    const request = fetch(CHIME_SOURCES[level])
      .then((response) => response.arrayBuffer())
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        this.buffers.set(level, buffer);
        this.pending.delete(level);
        return buffer;
      });
    this.pending.set(level, request);
    return request;
  }
}
