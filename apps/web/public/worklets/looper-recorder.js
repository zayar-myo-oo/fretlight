/**
 * AudioWorklet: sample-accurate recorder for the Companion looper.
 *
 * It copies the input into memory between two audio-clock frames, which is what
 * lets a take line up with the loop to the sample. The audio never leaves the
 * browser: chunks go to the page over the worklet's message port, nowhere else.
 *
 * Messages in:  { type: "start", startFrame, endFrame? }  { type: "end", endFrame }  { type: "cancel" }
 * Messages out: { type: "chunk", data: Float32Array }     { type: "done", frames }
 */
class LooperRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.startFrame = 0;
    this.endFrame = Infinity;
    this.written = 0;
    this.pending = new Float32Array(8192);
    this.pendingLength = 0;

    this.port.onmessage = (event) => {
      const message = event.data;
      if (message.type === "start") {
        this.active = true;
        this.startFrame = message.startFrame;
        this.endFrame = message.endFrame === undefined ? Infinity : message.endFrame;
        this.written = 0;
        this.pendingLength = 0;
      } else if (message.type === "end") {
        this.endFrame = message.endFrame;
      } else if (message.type === "cancel") {
        this.active = false;
        this.pendingLength = 0;
      }
    };
  }

  flush() {
    if (this.pendingLength === 0) return;
    const data = this.pending.slice(0, this.pendingLength);
    this.port.postMessage({ type: "chunk", data }, [data.buffer]);
    this.pendingLength = 0;
  }

  process(inputs) {
    if (!this.active) return true;
    const channel = inputs[0] && inputs[0][0];
    const length = channel ? channel.length : 128;
    const blockStart = currentFrame;
    const blockEnd = blockStart + length;

    // Only the part of this block inside [startFrame, endFrame) is kept.
    const from = Math.max(blockStart, this.startFrame);
    const to = Math.min(blockEnd, this.endFrame);
    for (let frame = from; frame < to; frame++) {
      this.pending[this.pendingLength++] = channel ? channel[frame - blockStart] : 0;
      if (this.pendingLength === this.pending.length) this.flush();
    }
    if (to > from) this.written += to - from;

    if (blockEnd >= this.endFrame) {
      this.flush();
      this.active = false;
      this.port.postMessage({ type: "done", frames: this.written });
    }
    return true;
  }
}

registerProcessor("looper-recorder", LooperRecorder);
