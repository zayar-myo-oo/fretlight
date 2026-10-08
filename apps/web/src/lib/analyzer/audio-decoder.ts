import { MAX_DURATION_SECONDS } from "@fretlight/core";

/** Rate every song is decoded at: enough for chord analysis, half the memory of 44.1 kHz. */
export const ANALYSIS_SAMPLE_RATE = 22050;

export const ACCEPTED_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "webm"] as const;
export const ACCEPT_ATTRIBUTE = ".mp3,.wav,.m4a,.ogg,.webm,audio/*";

export class AnalyzerError extends Error {}

export interface DecodedAudio {
  /** Mono samples at `ANALYSIS_SAMPLE_RATE`. */
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly duration: number;
}

export function hasSupportedExtension(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
}

/**
 * Decode a file in memory and fold it to mono.
 *
 * An OfflineAudioContext at the analysis rate makes the browser resample while
 * decoding, so a 4-minute song never has to exist as a 44.1 kHz stereo buffer.
 * Nothing is uploaded; the bytes are read and dropped.
 */
export async function decodeToMono(data: ArrayBuffer): Promise<DecodedAudio> {
  let buffer: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
    buffer = await context.decodeAudioData(data);
  } catch {
    throw new AnalyzerError("Unable to read this audio file.");
  }

  if (buffer.duration > MAX_DURATION_SECONDS) {
    throw new AnalyzerError(`This file is longer than ${MAX_DURATION_SECONDS / 60} minutes. Try a shorter one.`);
  }

  const samples = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < samples.length; i++) samples[i]! += channel[i]! / channels;
  }
  return { samples, sampleRate: buffer.sampleRate, duration: buffer.duration };
}
