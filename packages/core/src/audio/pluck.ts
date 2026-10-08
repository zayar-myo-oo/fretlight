/**
 * Plucked-string synthesis (Karplus-Strong with a fractional delay line).
 *
 * A burst of noise circulates in a delay line whose length sets the pitch, and a
 * two-point average in the loop strips the highs a little more on every pass.
 * That is, very nearly, what a real string does, which is why it sounds like a
 * string and a stack of oscillators does not. Pure and deterministic: the same
 * inputs always give the same samples, so notes can be rendered once and cached.
 */
export interface PluckOptions {
  readonly frequency: number;
  readonly sampleRate: number;
  /** Time for the note to fall by 60 dB, in seconds. */
  readonly decaySeconds: number;
  /** 0 = soft, dark pluck (finger, nylon) .. 1 = bright, hard pluck (pick). */
  readonly brightness: number;
  /** Where along the string it is plucked, 0..0.5 of its length. 0 disables the comb. */
  readonly position: number;
  /** Seeds the noise, so a given note always renders identically. */
  readonly seed?: number;
}

function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Render one plucked note as mono samples, peak-normalised to 0.9. */
export function renderPluck(options: PluckOptions): Float32Array {
  const { frequency, sampleRate, decaySeconds, brightness, position, seed = 1 } = options;
  const total = Math.max(1, Math.floor(sampleRate * decaySeconds * 1.15));
  const out = new Float32Array(total);

  // The two-point average adds half a sample of delay, so take it off the line.
  const delay = sampleRate / frequency - 0.5;
  const size = Math.ceil(delay) + 2;
  const line = new Float32Array(size);

  // Excitation: noise through a one-pole lowpass (soft picks lose the highs)...
  const random = rng(seed);
  const k = 0.15 + 0.85 * brightness;
  const burst = new Float32Array(size);
  let last = 0;
  for (let i = 0; i < size; i++) {
    last += k * (random() - last);
    burst[i] = last;
  }
  // ...then a comb, which notches the harmonics that have a node at the pluck point.
  const comb = Math.round(position * delay);
  for (let i = size - 1; i >= 0; i--) {
    line[i] = comb > 0 && i >= comb ? burst[i]! - burst[i - comb]! : burst[i]!;
  }

  // Per-pass loss that gives the requested 60 dB decay time.
  const loss = 10 ** (-3 / (decaySeconds * frequency));

  let write = 0;
  let previous = 0;
  for (let n = 0; n < total; n++) {
    // Read `delay` samples behind the write head, interpolating between neighbours.
    const readPos = write - delay;
    const base = Math.floor(readPos);
    const frac = readPos - base;
    const a = line[((base % size) + size) % size]!;
    const b = line[(((base + 1) % size) + size) % size]!;
    const sample = a + (b - a) * frac;

    out[n] = sample;
    line[write] = 0.5 * (sample + previous) * loss;
    previous = sample;
    write = (write + 1) % size;
  }

  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.9 / peak : 0;
  // Short fade so the buffer never ends on a click.
  const fade = Math.min(total, Math.floor(sampleRate * 0.05));
  for (let n = 0; n < total; n++) {
    const tail = total - n < fade ? (total - n) / fade : 1;
    out[n] = out[n]! * gain * tail;
  }
  return out;
}
