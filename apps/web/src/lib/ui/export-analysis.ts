export interface AnalysisImage {
  /** The rendered fretboard SVG element. */
  readonly svg: SVGSVGElement;
  readonly title: string;
  readonly lines: readonly { readonly label: string; readonly value: string }[];
  readonly filename: string;
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function svgToImage(svg: SVGSVGElement): Promise<{ img: HTMLImageElement; width: number; height: number }> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.viewBox.baseVal;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(box.width));
  clone.setAttribute("height", String(box.height));
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  // A standalone SVG has no page CSS: restore the `.readout` font and drop hover states.
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `.readout{font-family:${MONO}}`;
  clone.insertBefore(style, clone.firstChild);

  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }),
  );
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ img, width: box.width, height: box.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not render the fretboard"));
    };
    img.src = url;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Draws the analysis card (title, info lines, fretboard) and returns a PNG blob. */
export async function renderAnalysisPng({ svg, title, lines }: AnalysisImage): Promise<Blob> {
  const { img, width, height } = await svgToImage(svg);
  const pad = 48;
  const W = Math.max(1200, width + pad * 2);
  const scale = (W - pad * 2) / width;
  const boardH = height * scale;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `18px ${MONO}`;
  const rows = lines.map((l) => wrap(measure, `${l.label}: ${l.value}`, W - pad * 2));
  const textH = rows.reduce((s, r) => s + r.length * 28 + 8, 0);

  const H = Math.ceil(pad + 40 + 60 + boardH + 24 + textH + pad);
  const canvas = document.createElement("canvas");
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#05070c";
  ctx.fillRect(0, 0, W, H);

  let y = pad + 24;
  ctx.fillStyle = "#22e0d6";
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText("FRETlight", pad, y);
  y += 52;
  ctx.fillStyle = "#e8edf7";
  ctx.font = `600 40px ${MONO}`;
  ctx.fillText(title, pad, y);
  y += 24;

  ctx.drawImage(img, pad, y, W - pad * 2, boardH);
  y += boardH + 28;

  ctx.font = `18px ${MONO}`;
  rows.forEach((wrapped, i) => {
    const prefix = `${lines[i]!.label}: `;
    wrapped.forEach((text, j) => {
      if (j === 0) {
        ctx.fillStyle = "#6c7a94";
        ctx.fillText(prefix, pad, y);
        ctx.fillStyle = "#e8edf7";
        ctx.fillText(text.slice(prefix.length), pad + ctx.measureText(prefix).width, y);
      } else {
        ctx.fillStyle = "#e8edf7";
        ctx.fillText(text, pad, y);
      }
      y += 28;
    });
    y += 8;
  });

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
  );
}

export async function downloadAnalysisPng(input: AnalysisImage): Promise<void> {
  const blob = await renderAnalysisPng(input);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = input.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
