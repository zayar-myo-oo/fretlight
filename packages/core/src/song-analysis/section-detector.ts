import { SECTION_CONFIG } from "./config";
import type { ChromaFrames } from "./chroma-analyzer";
import type { SectionType, AnalysisSection } from "./types";

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Mean chroma and mean loudness of each equal-length block of the song. */
function blockFeatures(frames: ChromaFrames, blockSeconds: number, duration: number) {
  const count = Math.max(1, Math.floor(duration / blockSeconds));
  const sums = Array.from({ length: count }, () => new Float32Array(12));
  const counts = new Array<number>(count).fill(0);
  const energy = new Float32Array(count);
  frames.times.forEach((t, f) => {
    const b = Math.min(count - 1, Math.floor(t / blockSeconds));
    const chroma = frames.chroma[f]!;
    for (let i = 0; i < 12; i++) sums[b]![i]! += chroma[i]!;
    energy[b]! += frames.energy[f]!;
    counts[b]!++;
  });
  for (let b = 0; b < count; b++) {
    const n = counts[b]! || 1;
    for (let i = 0; i < 12; i++) sums[b]![i]! /= n;
    energy[b]! /= n;
  }
  return { blocks: sums, energy };
}

/**
 * Estimate the song's structure from audio similarity (no lyrics involved).
 *
 * The song is cut into bars (or fixed 2 s blocks without a tempo); runs of bars
 * are compared with each other, so two places with the same chord progression
 * match even when single bars are ambiguous. Where the music stops resembling
 * its recent past a boundary is placed (checkerboard novelty), and sections
 * that resemble each other are grouped. Repeated groups get verse / chorus
 * names by loudness; anything uncertain stays "Section A/B/C".
 */
export function detectSections(
  frames: ChromaFrames,
  duration: number,
  bpm: number | null,
): AnalysisSection[] {
  const cfg = SECTION_CONFIG;
  const barSeconds = bpm ? Math.min(4, Math.max(1.2, (60 / bpm) * 4)) : cfg.fallbackBlockSeconds;
  const { blocks, energy } = blockFeatures(frames, barSeconds, duration);
  const n = blocks.length;
  const whole = (start: number, end: number): AnalysisSection[] => [
    { type: "unknown", label: "Section A", cluster: 0, start, end, confidence: 0.3 },
  ];
  if (n < 4 || duration < cfg.minSectionSeconds * 1.5) return whole(0, duration);

  // Harmony: stack consecutive bars so a feature describes a short progression, not one bar.
  const stack = Math.max(1, Math.min(Math.round(cfg.stackSeconds / barSeconds), n));
  const stacked = blocks.map((_, i) => {
    const v = new Float32Array(12 * stack);
    for (let s = 0; s < stack; s++) v.set(blocks[Math.max(0, Math.min(n - 1, i - Math.floor(stack / 2) + s))]!, s * 12);
    return v;
  });
  const sim: Float32Array[] = stacked.map((a) => Float32Array.from(stacked, (b) => cosine(a, b)));

  // Texture: one bar's chroma plus how loud it is, so a section that gets louder or thinner stands out.
  const logEnergy = Array.from(energy, (e) => Math.log(e + 1e-4));
  const lo = Math.min(...logEnergy);
  const span = Math.max(1e-6, Math.max(...logEnergy) - lo);
  const textured = blocks.map((chroma, i) => {
    const v = new Float32Array(13);
    for (let k = 0; k < 12; k++) v[k] = chroma[k]! * cfg.textureChromaWeight;
    v[12] = ((logEnergy[i]! - lo) / span) * cfg.energyWeight;
    return v;
  });
  const textureSim: Float32Array[] = textured.map((a) => Float32Array.from(textured, (b) => cosine(a, b)));

  const limit = Math.floor(n / 2) - 1;
  const harmonyHalf = Math.max(2, Math.min(Math.round(cfg.kernelSeconds / barSeconds), limit));
  const textureHalf = Math.max(2, Math.min(Math.round(cfg.minSectionSeconds / barSeconds), limit));
  const half = Math.min(harmonyHalf, textureHalf);
  const a = zscore(noveltyCurve(sim, harmonyHalf));
  const b = zscore(noveltyCurve(textureSim, textureHalf));
  const novelty = Float32Array.from(a, (v, i) => (v + b[i]!) / 2);

  const mean = 0;
  const std = 1;
  const minGap = Math.max(1, Math.round(cfg.minSectionSeconds / barSeconds));
  const peaks: number[] = [];
  for (let i = half; i < n - half; i++) {
    const v = novelty[i]!;
    if (v < mean + cfg.noveltyThreshold * std) continue;
    let isMax = true;
    for (let j = Math.max(0, i - minGap); j <= Math.min(n - 1, i + minGap); j++) {
      if (novelty[j]! > v) isMax = false;
    }
    if (isMax) peaks.push(i);
  }

  const edges = [0, ...peaks.filter((p) => p * barSeconds >= cfg.minSectionSeconds && duration - p * barSeconds >= cfg.minSectionSeconds), n];
  if (edges.length <= 2) return whole(0, duration);

  // Sections as [fromBlock, toBlock) ranges; the first starts at 0 and the last ends at the song end.
  const ranges = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1]! }));
  const seconds = (block: number) => Math.min(duration, block * barSeconds);

  // Group sections that sound alike.
  const similarity = (a: { from: number; to: number }, b: { from: number; to: number }) => {
    const len = Math.min(a.to - a.from, b.to - b.from);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += sim[a.from + i]![b.from + i]!;
    return len > 0 ? sum / len : 0;
  };
  const cluster = new Array<number>(ranges.length).fill(-1);
  const representative: number[] = [];
  const confidence = new Array<number>(ranges.length).fill(0.3);
  ranges.forEach((range, i) => {
    let bestCluster = -1;
    let bestSim = 0;
    representative.forEach((rep, c) => {
      const s = similarity(range, ranges[rep]!);
      if (s > bestSim) {
        bestSim = s;
        bestCluster = c;
      }
    });
    if (bestCluster >= 0 && bestSim >= cfg.sameSectionSimilarity) {
      cluster[i] = bestCluster;
      confidence[i] = Math.round(Math.min(1, bestSim) * 100) / 100;
    } else {
      cluster[i] = representative.length;
      representative.push(i);
    }
  });

  // A section that repeats is as sure as the mean of its matches; the first occurrence shares that.
  for (let c = 0; c < representative.length; c++) {
    const others = cluster.flatMap((x, i) => (x === c && i !== representative[c] ? [confidence[i]!] : []));
    if (others.length) confidence[representative[c]!] = Math.round((others.reduce((s, v) => s + v, 0) / others.length) * 100) / 100;
  }

  const clusterCount = representative.length;
  const members = Array.from({ length: clusterCount }, (_, c) => cluster.flatMap((x, i) => (x === c ? [i] : [])));
  const loudness = (c: number) => {
    let sum = 0;
    let len = 0;
    for (const i of members[c]!) {
      for (let b = ranges[i]!.from; b < ranges[i]!.to; b++) {
        sum += energy[b]!;
        len++;
      }
    }
    return len ? sum / len : 0;
  };

  const types = new Array<SectionType>(ranges.length).fill("unknown");
  const repeated = members.map((m, c) => ({ c, m })).filter((x) => x.m.length >= 2);
  let chorus = -1;
  let verse = -1;
  if (repeated.length > 0) {
    const sorted = [...repeated].sort((a, b) => loudness(b.c) - loudness(a.c) || b.m.length - a.m.length);
    chorus = sorted[0]!.c;
    const rest = repeated.filter((x) => x.c !== chorus).sort((a, b) => a.m[0]! - b.m[0]!);
    verse = rest[0]?.c ?? -1;
  }

  const length = (i: number) => (ranges[i]!.to - ranges[i]!.from) * barSeconds;
  ranges.forEach((_, i) => {
    const c = cluster[i]!;
    if (c === chorus) types[i] = "chorus";
    else if (c === verse) types[i] = "verse";
  });
  // Roles for sections that appear only once.
  const firstChorus = types.indexOf("chorus");
  const lastChorus = types.lastIndexOf("chorus");
  ranges.forEach((_, i) => {
    if (types[i] !== "unknown" || members[cluster[i]!]!.length > 1) return;
    if (i === 0 && length(i) <= cfg.maxIntroOutroSeconds) types[i] = "intro";
    else if (i === ranges.length - 1 && length(i) <= cfg.maxIntroOutroSeconds && firstChorus >= 0) types[i] = "outro";
    else if (types[i + 1] === "chorus" && length(i) <= cfg.maxPreChorusSeconds && i > 0) types[i] = "pre-chorus";
    else if (firstChorus >= 0 && i > firstChorus && i < lastChorus + 1 && i !== ranges.length - 1 && length(i) >= 8) types[i] = "bridge";
  });

  const letter = (c: number) => String.fromCharCode(65 + (c % 26));
  return ranges.map((range, i) => {
    const type = types[i]!;
    const named = type !== "unknown";
    return {
      type,
      label: named ? type.charAt(0).toUpperCase() + type.slice(1) : `Section ${letter(cluster[i]!)}`,
      cluster: cluster[i]!,
      start: i === 0 ? 0 : seconds(range.from),
      end: i === ranges.length - 1 ? duration : seconds(range.to),
      // Roles of one-off sections are guesses from position alone.
      confidence: named && members[cluster[i]!]!.length < 2 ? 0.35 : confidence[i]!,
    };
  });
}

/** Checkerboard-kernel novelty along the diagonal: similar on each side of a point, different across it. */
function noveltyCurve(sim: Float32Array[], half: number): Float32Array {
  const n = sim.length;
  const out = new Float32Array(n);
  for (let i = half; i < n - half; i++) {
    let sum = 0;
    for (let a = -half; a < half; a++) {
      for (let b = -half; b < half; b++) {
        const sign = (a < 0) === (b < 0) ? 1 : -1;
        sum += sign * sim[i + a]![i + b]!;
      }
    }
    out[i] = sum / (4 * half * half);
  }
  return out;
}

/** Rescale to mean 0 / std 1 over the points the kernel could evaluate (zeros at the edges are not data). */
function zscore(values: Float32Array): Float32Array {
  const inner = values.filter((v) => v !== 0);
  if (inner.length < 2) return values;
  const mean = inner.reduce((s, v) => s + v, 0) / inner.length;
  const std = Math.sqrt(inner.reduce((s, v) => s + (v - mean) ** 2, 0) / inner.length) || 1;
  return values.map((v) => (v === 0 ? 0 : (v - mean) / std));
}
