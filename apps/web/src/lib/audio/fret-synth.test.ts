import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({
  players: [] as { resolve: () => void; reject: () => void; start: ReturnType<typeof vi.fn> }[],
  sources: [] as { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[],
  resume: null as Promise<void> | null,
}));

vi.mock("@/store/session", () => ({ useSession: { getState: () => ({ instrumentId: "guitar" }) } }));
vi.mock("@fretlight/core", () => ({
  getInstrument: () => ({ kind: "guitar" }),
  midiToFrequency: () => 220,
  renderPluck: () => new Float32Array(32),
}));
vi.mock("smplr", () => ({
  Soundfont: class {
    load: Promise<void>;
    start = vi.fn(() => vi.fn());
    constructor() {
      this.load = new Promise<void>((resolve, reject) => {
        audio.players.push({ resolve, reject: () => reject(new Error("offline")), start: this.start });
      });
    }
  },
}));

import { FretSynth, SOUND_PRESETS } from "./fret-synth";

const param = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
const node = () => ({ connect: vi.fn().mockReturnThis(), disconnect: vi.fn() });

class TestContext {
  state = audio.resume ? "suspended" : "running";
  currentTime = 10;
  sampleRate = 44100;
  destination = node();
  resume = vi.fn(async () => { await audio.resume; this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  createGain = () => ({ ...node(), gain: param() });
  createDynamicsCompressor = () => ({ ...node(), threshold: param(), ratio: param() });
  createBiquadFilter = () => ({ ...node(), frequency: param(), gain: param(), Q: param() });
  createWaveShaper = () => node();
  createBuffer = () => ({ getChannelData: () => new Float32Array(32) });
  createBufferSource = () => {
    const source = { ...node(), start: vi.fn(), stop: vi.fn() };
    audio.sources.push(source);
    return source;
  };
}

// Flush nested async context/preload continuations without advancing timeouts.
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe("FretSynth playback lifecycle", () => {
  let synth: FretSynth;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", TestContext);
    audio.players = [];
    audio.sources = [];
    audio.resume = null;
    synth = new FretSynth();
  });
  afterEach(() => {
    synth.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads guitar and bass together within one timeout budget", async () => {
    const warm = synth.warm([{ midi: 52, preset: SOUND_PRESETS[0]! }, { midi: 40, preset: SOUND_PRESETS[4]! }]);
    await flush();
    expect(audio.players).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(warm).resolves.toBe(10);
  });

  it("uses the model immediately while samples load, then switches when ready", async () => {
    await synth.pluck(52);
    expect(audio.sources[0]!.start).toHaveBeenCalledWith(10);
    expect(synth.getSampleStatus()).toBe("loading");
    audio.players[0]!.resolve();
    await flush();
    await synth.pluck(55);
    expect(synth.getSampleStatus()).toBe("ready");
    expect(audio.players[0]!.start).toHaveBeenCalledWith(expect.objectContaining({ note: 55, time: 10 }));
  });

  it("keeps playing with the model after a sample download fails", async () => {
    const preload = synth.preload();
    await flush();
    audio.players[0]!.reject();
    await expect(preload).resolves.toBe(false);
    expect(synth.getSampleStatus()).toBe("fallback");
    await synth.pluck(52);
    expect(audio.sources).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not play a pending note after Stop during context resume", async () => {
    let resume!: () => void;
    audio.resume = new Promise<void>((resolve) => { resume = resolve; });
    const pluck = synth.pluck(52);
    synth.stopAll();
    resume();
    await pluck;
    expect(audio.players).toHaveLength(0);
    expect(audio.sources).toHaveLength(0);
  });

  it("stops both sampled and modelled notes on dispose", async () => {
    await synth.pluck(52);
    audio.players[0]!.resolve();
    await flush();
    await synth.pluck(55);
    const stop = audio.players[0]!.start.mock.results[0]!.value;
    synth.dispose();
    expect(audio.sources[0]!.stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(synth.getSampleStatus()).toBe("idle");
  });

  it("does not recreate a disposed context when an old resume completes", async () => {
    let resume!: () => void;
    audio.resume = new Promise<void>((resolve) => { resume = resolve; });
    const warm = synth.warm([{ midi: 52 }]);
    synth.dispose();
    resume();
    await warm;
    expect(audio.players).toHaveLength(0);
    expect(synth.currentTime()).toBe(0);
  });

  it("accepts samples arriving after a timeout and clears completed preload timers", async () => {
    const preload = synth.preload(undefined, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(preload).resolves.toBe(false);
    audio.players[0]!.resolve();
    await flush();
    await expect(synth.preload()).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("notifies the sound menu when sample loading completes", async () => {
    const listener = vi.fn();
    synth.subscribe(listener);
    const preload = synth.preload();
    await flush();
    expect(listener).toHaveBeenCalledOnce();
    audio.players[0]!.resolve();
    await expect(preload).resolves.toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
