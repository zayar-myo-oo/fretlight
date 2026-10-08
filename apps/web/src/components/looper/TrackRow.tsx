"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { type LooperTrack, type TrackKind } from "@/lib/looper/looper-engine";
import { cn } from "@/lib/ui/cn";

export const KIND_LABELS: Record<TrackKind, string> = {
  rhythm: "Rhythm guitar",
  lead: "Lead",
  bass: "Bass",
  melody: "Melody",
  guitar: "Guitar",
  other: "Other",
};

const KIND_ICON: Record<TrackKind, string> = { rhythm: "🎸", lead: "🎸", bass: "🎵", melody: "🎶", guitar: "🎸", other: "🎙" };

interface Props {
  readonly track: LooperTrack;
  readonly bars: number;
  readonly loopSeconds: number;
  readonly busy: boolean;
  readonly recordingThis: boolean;
  readonly onVolume: (v: number) => void;
  readonly onMute: (m: boolean) => void;
  readonly onSolo: (s: boolean) => void;
  readonly onRename: (name: string) => void;
  readonly onKind: (kind: TrackKind) => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onDownload: () => void;
  readonly onRerecord: () => void;
  readonly onPunch: (start: number, end: number) => void;
  readonly onClearSection: (start: number, end: number) => void;
}

/** One line of the looper: controls on the left, its waveform on the right. */
export const TrackRow = memo(function TrackRow(p: Props) {
  const { track } = p;
  const canvas = useRef<HTMLCanvasElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ a: number; b: number } | null>(null);
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const { width, height } = el;
    ctx.clearRect(0, 0, width, height);

    // Bar lines
    ctx.strokeStyle = "rgba(148,176,255,0.14)";
    ctx.lineWidth = 1;
    const barCount = Math.max(1, Math.round(p.bars));
    for (let b = 1; b < barCount; b++) {
      const x = Math.round((b / barCount) * width) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    const peaks = track.peaks;
    const mid = height / 2;
    ctx.fillStyle = track.muted ? "rgba(148,176,255,0.28)" : "rgba(34,224,214,0.85)";
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * width;
      const h = Math.max(1, Math.min(1, peaks[i]! * 2.2) * (height - 4));
      ctx.fillRect(x, mid - h / 2, Math.max(1, width / peaks.length - 0.5), h);
    }
  }, [track.peaks, track.muted, p.bars]);

  const fractionAt = (clientX: number) => {
    const rect = lane.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const range = selection ? { start: Math.min(selection.a, selection.b) * p.loopSeconds, end: Math.max(selection.a, selection.b) * p.loopSeconds } : null;
  const hasRange = range && range.end - range.start > 0.05;
  const audible = !track.muted;

  return (
    <div className="grid gap-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3 md:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden>{KIND_ICON[track.kind]}</span>
          <input
            value={track.name}
            onChange={(e) => p.onRename(e.target.value)}
            aria-label="Line name"
            className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-panel-raised)] px-2 text-sm"
          />
          <select
            value={track.kind}
            onChange={(e) => p.onKind(e.target.value as TrackKind)}
            aria-label="Line type"
            className="h-8 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-panel-raised)] px-1 text-xs"
          >
            {(Object.keys(KIND_LABELS) as TrackKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => p.onMute(!track.muted)}
            aria-pressed={track.muted}
            title="Mute"
            className={cn("h-8 w-8 rounded-lg border text-xs font-semibold", track.muted ? "border-[var(--color-error)] bg-[rgba(255,84,112,0.14)] text-[var(--color-error)]" : "border-[var(--color-hairline)] text-[var(--color-ink-dim)]")}
          >
            M
          </button>
          <button
            onClick={() => p.onSolo(!track.solo)}
            aria-pressed={track.solo}
            title="Solo"
            className={cn("h-8 w-8 rounded-lg border text-xs font-semibold", track.solo ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.14)] text-[var(--color-signal)]" : "border-[var(--color-hairline)] text-[var(--color-ink-dim)]")}
          >
            S
          </button>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={track.volume}
            onChange={(e) => p.onVolume(Number(e.target.value))}
            aria-label="Volume"
            className="min-w-0 flex-1 accent-[var(--color-signal)]"
          />
          <span className="readout w-9 text-right text-[11px] text-[var(--color-ink-faint)]">{Math.round(track.volume * 100)}%</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={p.onRerecord} disabled={p.busy}>
            ● Re-record
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onDuplicate} disabled={p.busy}>
            Duplicate
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onDownload}>
            ↓ WAV
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onDelete} disabled={p.busy}>
            Delete
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div
          ref={lane}
          onPointerDown={(e) => {
            if (p.busy) return;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            const f = fractionAt(e.clientX);
            dragging.current = f;
            setSelection({ a: f, b: f });
          }}
          onPointerMove={(e) => {
            if (dragging.current === null) return;
            setSelection({ a: dragging.current, b: fractionAt(e.clientX) });
          }}
          onPointerUp={() => {
            dragging.current = null;
            setSelection((s) => (s && Math.abs(s.a - s.b) < 0.01 ? null : s));
          }}
          className={cn("relative h-16 cursor-crosshair touch-none overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[rgba(255,255,255,0.02)]", !audible && "opacity-70")}
        >
          <canvas ref={canvas} width={1200} height={64} className="h-full w-full" />
          {selection && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 border-x border-[var(--color-theory)] bg-[rgba(139,124,255,0.22)]"
              style={{ left: `${Math.min(selection.a, selection.b) * 100}%`, width: `${Math.abs(selection.a - selection.b) * 100}%` }}
            />
          )}
          {p.recordingThis && <div className="pointer-events-none absolute inset-0 animate-pulse bg-[rgba(255,84,112,0.12)]" />}
        </div>
        <div className="flex min-h-7 flex-wrap items-center gap-2 text-[11px] text-[var(--color-ink-faint)]">
          {hasRange && range ? (
            <>
              <span className="readout">
                {range.start.toFixed(1)}s – {range.end.toFixed(1)}s
              </span>
              <Button size="sm" onClick={() => p.onPunch(range.start, range.end)} disabled={p.busy}>
                ● Re-record section
              </Button>
              <Button size="sm" variant="ghost" onClick={() => p.onClearSection(range.start, range.end)} disabled={p.busy}>
                Clear section
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>
                Deselect
              </Button>
            </>
          ) : (
            <span>Drag across the waveform to fix just one part.</span>
          )}
        </div>
      </div>
    </div>
  );
});
