import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface StatProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string;
  readonly tone?: "default" | "signal" | "correct" | "warn" | "error";
  readonly className?: string;
}

const TONES = {
  default: "text-[var(--color-ink)]",
  signal: "text-[var(--color-signal)]",
  correct: "text-[var(--color-correct)]",
  warn: "text-[var(--color-warn)]",
  error: "text-[var(--color-error)]",
} as const;

export function Stat({ label, value, unit, tone = "default", className }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="hud-label">{label}</span>
      <span className={cn("readout text-2xl leading-none font-semibold", TONES[tone])}>
        {value}
        {unit && <span className="ml-1 text-xs text-[var(--color-ink-faint)]">{unit}</span>}
      </span>
    </div>
  );
}
