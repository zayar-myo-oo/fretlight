import { AnalyzerError, hasSupportedExtension } from "./audio-decoder";

export const YOUTUBE_MESSAGE =
  "YouTube direct analysis requires supported access. Please upload the audio file for local analysis.";

const YOUTUBE = /^(https?:\/\/)?([\w-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)/i;

export function isYouTubeUrl(value: string): boolean {
  return YOUTUBE.test(value.trim());
}

export interface LoadedSong {
  readonly name: string;
  readonly blob: Blob;
}

/**
 * Load a song from a direct link to an audio file. The browser makes this
 * request itself, so it only works when the host allows it (CORS); there is no
 * server of ours in between, and no scraping of streaming sites.
 */
export async function loadFromUrl(value: string, signal?: AbortSignal): Promise<LoadedSong> {
  const text = value.trim();
  if (isYouTubeUrl(text)) throw new AnalyzerError(YOUTUBE_MESSAGE);

  let url: URL;
  try {
    url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new AnalyzerError("That doesn't look like a web address.");
  }

  const name = decodeURIComponent(url.pathname.split("/").pop() || "song");
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch {
    throw new AnalyzerError("Couldn't reach that address. The site may not allow direct access. Please upload the audio file instead.");
  }
  if (!response.ok) throw new AnalyzerError(`That address returned an error (${response.status}). Please upload the audio file instead.`);

  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("audio/") && !type.includes("ogg") && !type.includes("webm") && !hasSupportedExtension(name)) {
    throw new AnalyzerError("That address isn't a direct link to an audio file. Please upload the audio file instead.");
  }
  return { name, blob: await response.blob() };
}
