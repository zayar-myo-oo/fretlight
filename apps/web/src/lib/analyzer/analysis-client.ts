import type { AnalysisInstrument, AnalysisProgress, SongAnalysis } from "@fretlight/core";
import type { AnalyzeRequest, AnalyzeResponse } from "./analysis.worker";
import type { DecodedAudio } from "./audio-decoder";

export interface AnalysisJob {
  readonly result: Promise<SongAnalysis>;
  /** Stop the worker and free its memory. */
  readonly cancel: () => void;
}

/**
 * Start an analysis in a Web Worker. The decoded samples are transferred, not
 * copied, so the page no longer holds them once this is called.
 */
export function startAnalysis(
  audio: DecodedAudio,
  instrument: AnalysisInstrument,
  onProgress: (progress: AnalysisProgress) => void,
): AnalysisJob {
  const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
  let finished = false;

  const result = new Promise<SongAnalysis>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message.progress);
      else {
        finished = true;
        worker.terminate();
        if (message.type === "result") resolve(message.analysis);
        else reject(new Error(message.message));
      }
    };
    worker.onerror = () => {
      finished = true;
      worker.terminate();
      reject(new Error("Analysis failed."));
    };
    const request: AnalyzeRequest = {
      type: "analyze",
      samples: audio.samples,
      sampleRate: audio.sampleRate,
      instrument,
    };
    worker.postMessage(request, [audio.samples.buffer]);
  });

  return {
    result,
    cancel: () => {
      if (!finished) worker.terminate();
    },
  };
}
