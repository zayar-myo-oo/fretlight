/// <reference lib="webworker" />

import { type AnalysisInstrument, type AnalysisProgress, type SongAnalysis, analyzeSong } from "@fretlight/core";

/**
 * Runs the whole analysis off the main thread so the page stays responsive.
 * The samples arrive by transfer, are read once, and are garbage once this
 * function returns; nothing is kept or sent anywhere.
 */
export interface AnalyzeRequest {
  readonly type: "analyze";
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly instrument: AnalysisInstrument;
}

export type AnalyzeResponse =
  | { readonly type: "progress"; readonly progress: AnalysisProgress }
  | { readonly type: "result"; readonly analysis: SongAnalysis }
  | { readonly type: "error"; readonly message: string };

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { samples, sampleRate, instrument } = event.data;
  try {
    const analysis = analyzeSong(samples, sampleRate, {
      instrument,
      onProgress: (progress) => self.postMessage({ type: "progress", progress } satisfies AnalyzeResponse),
    });
    self.postMessage({ type: "result", analysis } satisfies AnalyzeResponse);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Analysis failed.",
    } satisfies AnalyzeResponse);
  }
};
