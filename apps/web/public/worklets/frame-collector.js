/**
 * AudioWorklet stage: framing only.
 *
 * This runs on the audio rendering thread, where every millisecond spent is a
 * millisecond the browser did not have to fill the output buffer — overrun it
 * and you get audible glitches. So it does the minimum that has to happen here
 * and nothing else: keep a ring buffer of the most recent `frameSize` samples
 * and hand one out every `hopSize` samples.
 *
 * All actual analysis (conditioning, decimation, YIN) happens in a Web Worker
 * that imports @fretlight/core, so the tested implementation is the one that
 * runs — no second copy of the DSP living in this file to drift out of sync.
 */
class FrameCollector extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.frameSize = settings.frameSize || 8192;
    this.hopSize = settings.hopSize || 1024;

    this.ring = new Float32Array(this.frameSize);
    this.writeIndex = 0;
    this.filled = 0;
    this.sinceLastEmit = 0;
    this.running = true;

    this.port.onmessage = (event) => {
      if (event.data === "stop") this.running = false;
    };
  }

  process(inputs) {
    if (!this.running) return false;

    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.ring[this.writeIndex] = channel[i];
      this.writeIndex = (this.writeIndex + 1) % this.frameSize;
    }
    this.filled = Math.min(this.frameSize, this.filled + channel.length);
    this.sinceLastEmit += channel.length;

    if (this.sinceLastEmit >= this.hopSize && this.filled >= this.frameSize) {
      this.sinceLastEmit = 0;

      // Unwrap the ring so the worker receives samples in time order.
      const frame = new Float32Array(this.frameSize);
      const head = this.writeIndex;
      frame.set(this.ring.subarray(head), 0);
      frame.set(this.ring.subarray(0, head), this.frameSize - head);

      // Transferred, not copied: at ~47 frames a second this is the difference
      // between a trickle of garbage and none at all.
      this.port.postMessage({ samples: frame, time: currentTime }, [frame.buffer]);
    }

    return true;
  }
}

registerProcessor("frame-collector", FrameCollector);
