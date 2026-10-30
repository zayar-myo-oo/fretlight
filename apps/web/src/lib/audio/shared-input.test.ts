import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedInput } from "./shared-input";
class Context extends EventTarget {
  static instances: Context[] = [];
  state = "suspended"; sampleRate = 48000; currentTime = 0;
  constructor() { super(); Context.instances.push(this); }
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createGain = vi.fn(() => ({ gain: { value: 1 }, disconnect: vi.fn() }));
}
function stream() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}
let gum: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Context.instances = [];
  gum = vi.fn();
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: gum, getSupportedConstraints: () => ({ deviceId: true }) } });
});
afterEach(() => vi.unstubAllGlobals());
describe("shared capture lifecycle", () => {
  it("unlocks context before permission and requests unprocessed selected input", async () => {
    const input = new SharedInput(), media = stream();
    gum.mockResolvedValue(media);
    const pending = input.open("usb-interface");
    expect(Context.instances[0]!.resume).toHaveBeenCalledOnce();
    const session = await pending;
    expect(session.stream).toBe(media);
    expect(gum).toHaveBeenCalledWith({ audio: { deviceId: { exact: "usb-interface" }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } }, video: false });
    await input.stop(); await session.close();
    expect(media.track.stop).toHaveBeenCalledOnce();
  });
  it("closes the old track before opening a replacement", async () => {
    const input = new SharedInput(), one = stream(), two = stream();
    gum.mockResolvedValueOnce(one).mockImplementationOnce(async () => { expect(one.track.stop).toHaveBeenCalledOnce(); return two; });
    await input.open("one"); await input.open("two");
    expect(input.current?.deviceId).toBe("two"); await input.stop();
  });
  it("cleans up permission failures", async () => {
    gum.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const input = new SharedInput();
    await expect(input.open()).rejects.toThrow("denied");
    expect(Context.instances[0]!.state).toBe("closed"); expect(input.current).toBeNull();
  });
  it("stop during pending permission prevents a late live capture", async () => {
    let grant!: (s: unknown) => void;
    gum.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    const input = new SharedInput(), media = stream();
    const pending = input.open(); const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(gum).toHaveBeenCalledOnce());
    await input.stop(); grant(media); await rejected;
    expect(media.track.stop).toHaveBeenCalledOnce(); expect(input.current).toBeNull();
  });
  it("last request wins without overlapping getUserMedia sessions", async () => {
    const input = new SharedInput(), media = stream(); gum.mockResolvedValue(media);
    const first = input.open("one"); const firstRejected = expect(first).rejects.toThrow("cancelled");
    const second = input.open("two"); await firstRejected; await second;
    expect(gum).toHaveBeenCalledOnce(); expect(input.current?.deviceId).toBe("two"); await input.stop();
  });
  it("device loss disposes and notifies consumers", async () => {
    const input = new SharedInput(), media = stream(); gum.mockResolvedValue(media);
    const notify = vi.fn(); input.subscribe(notify);
    await input.open(); media.track.dispatchEvent(new Event("ended"));
    expect(input.current).toBeNull(); expect(notify).toHaveBeenCalledTimes(2);
    expect(Context.instances[0]!.state).toBe("closed");
  });
});
