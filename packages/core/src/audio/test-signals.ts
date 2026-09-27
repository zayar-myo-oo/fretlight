/**
 * Synthetic test signals. Kept in src (not a test file) so benchmarks and the
 * browser-side detector playground can use the same generators the unit tests do.
 */

export interface ToneOptions {
  readonly frequency: number;
  readonly sampleRate: number;
  readonly length: number;
  /** Relative amplitude of each harmonic, index 0 = fundamental. */
  readonly harmonics?: readonly number[];
  /** Exponential decay time constant in seconds. Omit for a steady tone. */
  readonly decay?: number;
  readonly noise?: number;
  readonly amplitude?: number;
  readonly seed?: number;
}

/** Deterministic PRNG so noisy tests never flake. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthesizeTone(options: ToneOptions): Float32Array {
  const {
    frequency,
    sampleRate,
    length,
    harmonics = [1],
    decay,
    noise = 0,
    amplitude = 0.5,
    seed = 1,
  } = options;

  const random = mulberry32(seed);
  const buffer = new Float32Array(length);
  // Random but fixed phases: a real string's harmonics are not phase-aligned,
  // and a detector that only works on phase-aligned sums is not a real detector.
  const phases = harmonics.map(() => random() * Math.PI * 2);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sample = 0;
    for (let h = 0; h < harmonics.length; h++) {
      sample += harmonics[h]! * Math.sin(2 * Math.PI * frequency * (h + 1) * t + phases[h]!);
    }
    const envelope = decay === undefined ? 1 : Math.exp(-t / decay);
    sample = sample * envelope * amplitude;
    if (noise > 0) sample += (random() * 2 - 1) * noise;
    buffer[i] = sample;
  }
  return buffer;
}

/**
 * A plucked electric bass: the fundamental is *weaker* than the 2nd and 3rd
 * harmonics, which is exactly the situation that makes naive autocorrelation
 * report the octave above.
 */
export function synthesizeBassPluck(
  frequency: number,
  sampleRate: number,
  length: number,
  seed = 7,
): Float32Array {
  return synthesizeTone({
    frequency,
    sampleRate,
    length,
    harmonics: [0.35, 1.0, 0.75, 0.45, 0.25, 0.15, 0.08],
    decay: 1.4,
    noise: 0.004,
    amplitude: 0.45,
    seed,
  });
}

/** A clean electric guitar note: strong fundamental, gently falling harmonics. */
export function synthesizeGuitarNote(
  frequency: number,
  sampleRate: number,
  length: number,
  seed = 11,
): Float32Array {
  return synthesizeTone({
    frequency,
    sampleRate,
    length,
    harmonics: [1.0, 0.55, 0.3, 0.18, 0.1, 0.05],
    decay: 2.2,
    noise: 0.003,
    amplitude: 0.4,
    seed,
  });
}

/**
 * A speech-like signal: voiced, harmonic, and in the same frequency band as a
 * guitar — the case a frequency filter cannot help with.
 *
 * What makes it speech rather than a note is the *behaviour*: the fundamental
 * slides continuously the way prosody does, formant-shaped amplitude moves
 * independently of pitch, and there is broadband breath noise underneath. A
 * detector that accepts this will report notes while someone talks near the mic.
 */
export function synthesizeSpeechLike(
  centerFrequency: number,
  sampleRate: number,
  length: number,
  options: { glideCents?: number; glideRateHz?: number; seed?: number; noise?: number } = {},
): Float32Array {
  const glideCents = options.glideCents ?? 140;
  const glideRateHz = options.glideRateHz ?? 3.2;
  const noise = options.noise ?? 0.05;
  const random = mulberry32(options.seed ?? 17);

  const harmonics = [1.0, 0.7, 0.45, 0.55, 0.3, 0.18, 0.1];
  const phases = harmonics.map(() => random() * Math.PI * 2);
  const buffer = new Float32Array(length);

  // Integrate the instantaneous frequency so the phase stays continuous — a
  // naive per-sample sin(2*pi*f(t)*t) produces phase jumps that read as noise.
  let phase = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const cents = Math.sin(2 * Math.PI * glideRateHz * t) * glideCents;
    const frequency = centerFrequency * Math.pow(2, cents / 1200);
    phase += (2 * Math.PI * frequency) / sampleRate;

    let sample = 0;
    for (let h = 0; h < harmonics.length; h++) {
      // Formant-ish: harmonic amplitudes move on their own timescale.
      const formant = 1 + 0.5 * Math.sin(2 * Math.PI * (1.7 + h * 0.4) * t);
      sample += harmonics[h]! * formant * Math.sin(phase * (h + 1) + phases[h]!);
    }

    // Syllabic envelope plus breath noise.
    const envelope = 0.55 + 0.45 * Math.sin(2 * Math.PI * 2.6 * t);
    buffer[i] = (sample * 0.14 * envelope + (random() * 2 - 1) * noise) * 0.9;
  }
  return buffer;
}

/**
 * A realistic phrase: several notes, each with a real pluck envelope.
 *
 * The point is to test what actually happens when someone *plays*, rather than
 * when someone holds one steady note. A picked note has a noisy, inharmonic
 * attack lasting tens of milliseconds, then decays; notes follow each other
 * closely; short notes may be gone in under 200 ms. Every one of those is a
 * chance for a detector to miss the note entirely.
 */
export function synthesizePhrase(
  notes: readonly { frequency: number; startSeconds: number; durationSeconds: number }[],
  sampleRate: number,
  options: { seed?: number; attackNoise?: number; decay?: number; amplitude?: number } = {},
): Float32Array {
  const seed = options.seed ?? 5;
  const attackNoise = options.attackNoise ?? 0.35;
  const decay = options.decay ?? 1.1;
  const amplitude = options.amplitude ?? 0.5;

  const random = mulberry32(seed);
  const last = notes[notes.length - 1];
  const totalSeconds = last ? last.startSeconds + last.durationSeconds + 0.3 : 1;
  const buffer = new Float32Array(Math.ceil(totalSeconds * sampleRate));

  const harmonics = [0.4, 1.0, 0.7, 0.45, 0.28, 0.16, 0.09];

  for (const note of notes) {
    const start = Math.floor(note.startSeconds * sampleRate);
    const length = Math.floor(note.durationSeconds * sampleRate);
    const phases = harmonics.map(() => random() * Math.PI * 2);

    for (let i = 0; i < length; i++) {
      const index = start + i;
      if (index >= buffer.length) break;
      const t = i / sampleRate;

      let sample = 0;
      for (let h = 0; h < harmonics.length; h++) {
        sample += harmonics[h]! * Math.sin(2 * Math.PI * note.frequency * (h + 1) * t + phases[h]!);
      }

      // Pick attack: a short burst of inharmonic noise over the first few ms,
      // exactly the part a strict gate throws away.
      const attack = Math.exp(-t / 0.012);
      const noise = (random() * 2 - 1) * attackNoise * attack;

      // Slight upward bend on attack, as a real string does when struck.
      const envelope = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.004));
      buffer[index] = buffer[index]! + (sample * envelope + noise * envelope) * amplitude;
    }
  }
  return buffer;
}

/** A note with vibrato — pitch moving by design, not by accident. */
export function synthesizeVibratoNote(
  frequency: number,
  sampleRate: number,
  length: number,
  options: { depthCents?: number; rateHz?: number; seed?: number } = {},
): Float32Array {
  const depth = options.depthCents ?? 35;
  const rate = options.rateHz ?? 5.5;
  const random = mulberry32(options.seed ?? 3);
  const harmonics = [0.45, 1.0, 0.65, 0.4, 0.22];
  const phases = harmonics.map(() => random() * Math.PI * 2);

  const buffer = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const cents = Math.sin(2 * Math.PI * rate * t) * depth;
    const instant = frequency * Math.pow(2, cents / 1200);
    phase += (2 * Math.PI * instant) / sampleRate;

    let sample = 0;
    for (let h = 0; h < harmonics.length; h++) {
      sample += harmonics[h]! * Math.sin(phase * (h + 1) + phases[h]!);
    }
    buffer[i] = sample * Math.exp(-t / 2.5) * 0.45;
  }
  return buffer;
}
