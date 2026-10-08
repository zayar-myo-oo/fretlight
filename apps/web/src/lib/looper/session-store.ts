/**
 * Keeps the looper's lines in this browser (IndexedDB) so a refresh does not
 * lose them. Local only: nothing here talks to a server. Audio is far too big
 * for localStorage, which is why this uses IndexedDB.
 */

export interface StoredTrack {
  readonly name: string;
  readonly kind: string;
  readonly volume: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly samples: Float32Array;
}

export interface StoredSession {
  readonly savedAt: number;
  readonly sampleRate: number;
  readonly loopSeconds: number;
  readonly bars: number;
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly loopMode: "free" | "musical";
  readonly tracks: readonly StoredTrack[];
}

const DB = "fretlight-looper";
const STORE = "session";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveSession(session: StoredSession): Promise<void> {
  try {
    await run("readwrite", (store) => store.put(session, KEY));
  } catch {
    // Private mode or storage full: the loop simply is not kept.
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const value = await run<StoredSession | undefined>("readonly", (store) => store.get(KEY));
    return value && Array.isArray(value.tracks) && value.tracks.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(KEY));
  } catch {
    // nothing to clear
  }
}

/** Linear resampling, for a session saved on a device with a different sample rate. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const length = Math.round((samples.length * to) / from);
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = samples[index] ?? 0;
    const b = samples[index + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
