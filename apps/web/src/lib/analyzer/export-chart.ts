import {
  type ChordDetection,
  type SongAnalysis,
  buildChart,
  exportText,
  formatTimestamp,
  spellChord,
} from "@fretlight/core";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function bpmLabel(analysis: Pick<SongAnalysis, "bpm" | "bpmConfidence">): string {
  if (!analysis.bpm) return "unknown";
  return analysis.bpmConfidence < 0.35 ? `~${analysis.bpm}` : String(analysis.bpm);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[^\w\- ]+/g, "").trim() || "song";

export function downloadText(name: string, analysis: SongAnalysis, chords: readonly ChordDetection[]) {
  download(new Blob([exportText(name, analysis, chords)], { type: "text/plain" }), `${baseName(name)}-chords.txt`);
}

export function downloadJson(name: string, analysis: SongAnalysis, chords: readonly ChordDetection[]) {
  const data = {
    song: name,
    key: analysis.key,
    keyConfidence: analysis.keyConfidence,
    bpm: analysis.bpm,
    bpmConfidence: analysis.bpmConfidence,
    duration: analysis.duration,
    sections: analysis.sections,
    chords,
  };
  download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `${baseName(name)}-chords.json`);
}

/** A lead-sheet style chart: title, key / tempo, then each section as rows of bars. */
export async function downloadPng(name: string, analysis: SongAnalysis, chords: readonly ChordDetection[]) {
  const chart = buildChart(chords, analysis.sections, analysis.bpm, analysis.beats);
  const W = 1200;
  const pad = 56;
  const barW = (W - pad * 2) / 4;
  const barH = 52;

  let height = pad + 120;
  for (const { rows } of chart) height += 60 + Math.max(1, rows.length) * (barH + 10) + 18;
  height += pad;

  const canvas = document.createElement("canvas");
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, W, height);

  let y = pad;
  ctx.fillStyle = "#22e0d6";
  ctx.font = `600 18px ${MONO}`;
  ctx.fillText("FRETlight · Song Analyzer", pad, y);
  y += 44;
  ctx.fillStyle = "#e8edf7";
  ctx.font = `600 34px ${MONO}`;
  ctx.fillText(baseName(name), pad, y);
  y += 32;
  ctx.fillStyle = "#6c7a94";
  ctx.font = `16px ${MONO}`;
  ctx.fillText(`Key: ${analysis.key ?? "uncertain"}   BPM: ${bpmLabel(analysis)}   Duration: ${formatTimestamp(analysis.duration)}`, pad, y);
  y += 28;

  for (const { section, rows } of chart) {
    y += 22;
    ctx.fillStyle = "#8b7cff";
    ctx.font = `600 18px ${MONO}`;
    ctx.fillText(section.label.toUpperCase(), pad, y);
    ctx.fillStyle = "#6c7a94";
    ctx.font = `14px ${MONO}`;
    ctx.fillText(`${formatTimestamp(section.start)} - ${formatTimestamp(section.end)}`, pad + 220, y);
    y += 14;

    rows.forEach((row) => {
      row.forEach((bar, i) => {
        const x = pad + i * barW;
        ctx.strokeStyle = "#26324a";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, barW - 8, barH);
        const label = bar.chordIndexes.map((index) => spellChord(chords[index]!, analysis.keyInfo)).join("  ") || "-";
        ctx.fillStyle = "#e8edf7";
        ctx.font = `600 ${label.length > 8 ? 18 : 24}px ${MONO}`;
        ctx.textAlign = "center";
        ctx.fillText(label, x + (barW - 8) / 2, y + barH / 2 + 8);
        ctx.textAlign = "left";
      });
      y += barH + 10;
    });
    if (rows.length === 0) y += barH + 10;
    y += 4;
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
  );
  download(blob, `${baseName(name)}-chords.png`);
}
