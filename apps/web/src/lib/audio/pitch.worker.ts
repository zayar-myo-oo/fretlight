/// <reference lib="webworker" />

import { PitchPipeline, type PitchPipelineOptions } from "@fretlight/core";

/**
 * Analysis worker.
 *
 * Runs the exact `PitchPipeline` the unit tests exercise, off both the audio
 * thread (where overrunning the budget causes glitches) and the main thread
 * (where it would stutter the fretboard). Decimation makes each frame cost
 * roughly 150k operations, so this sits near idle even on a phone.
 */

export interface ConfigureMessage {
  readonly type: "configure";
  readonly options: PitchPipelineOptions;
}

export interface FrameMessage {
  readonly type: "frame";
  readonly samples: Float32Array;
  readonly time: number;
}

export type WorkerInbound = ConfigureMessage | FrameMessage | { type: "reset" };

let pipeline: PitchPipeline | null = null;

self.onmessage = (event: MessageEvent<WorkerInbound>) => {
  const message = event.data;

  switch (message.type) {
    case "configure":
      pipeline = new PitchPipeline(message.options);
      self.postMessage({
        type: "ready",
        decimationFactor: pipeline.decimationFactor,
        decimatedRate: pipeline.decimatedRate,
        requiredFrameSize: pipeline.requiredFrameSize,
      });
      break;

    case "reset":
      pipeline?.reset();
      break;

    case "frame": {
      if (!pipeline) return;
      const estimate = pipeline.process(message.samples);
      self.postMessage({ type: "estimate", estimate, time: message.time });
      break;
    }
  }
};
