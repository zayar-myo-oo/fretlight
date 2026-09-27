import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export type BadgeTone = "neutral" | "signal" | "theory" | "root" | "correct" | "warn" | "error";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-[var(--color-hairline-bright)] text-[var(--color-ink-dim)] bg-[rgba(255,255,255,0.03)]",
  signal: "border-[rgba(34,224,214,0.4)] text-[var(--color-signal)] bg-[rgba(34,224,214,0.08)]",
  theory: "border-[rgba(139,124,255,0.4)] text-[var(--color-theory-bright)] bg-[rgba(139,124,255,0.08)]",
  root: "border-[rgba(255,92,138,0.4)] text-[var(--color-root-bright)] bg-[rgba(255,92,138,0.08)]",
  correct: "border-[rgba(57,224,139,0.4)] text-[var(--color-correct)] bg-[rgba(57,224,139,0.08)]",
  warn: "border-[rgba(255,194,71,0.4)] text-[var(--color-warn)] bg-[rgba(255,194,71,0.08)]",
  error: "border-[rgba(255,84,112,0.45)] text-[var(--color-error)] bg-[rgba(255,84,112,0.08)]",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "readout inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] tracking-[0.12em] uppercase",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
