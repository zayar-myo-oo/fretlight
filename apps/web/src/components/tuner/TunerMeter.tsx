"use client";

import { cn } from "@/lib/ui/cn";

export const IN_TUNE_CENTS = 5;

export interface TunerMeterProps {
  /** Signed cents, or null when nothing is being detected. */
  readonly cents: number | null;
  readonly range?: number;
  readonly className?: string;
}

/**
 * Linear cents meter.
 *
 * A strobe-style horizontal scale rather than a swinging needle: at bass
 * frequencies the value updates a few times a second, and a needle with that
 * little data looks broken. A travelling marker with a fixed centre gate reads
 * as precise at any update rate.
 */
export function TunerMeter({ cents, range = 50, className }: TunerMeterProps) {
  const clamped = cents === null ? 0 : Math.max(-range, Math.min(range, cents));
  const percent = 50 + (clamped / range) * 50;
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;
  const active = cents !== null;

  return (
    <div className={cn("w-full", className)}>
      <div className="relative h-24 overflow-hidden rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-void)]">
        {/* Tick marks every 10 cents, taller at the decade marks. */}
        <div className="absolute inset-0 flex items-end justify-between px-[3%] pb-7">
          {Array.from({ length: 21 }, (_, i) => {
            const value = -range + (i * range * 2) / 20;
            const major = i % 5 === 0;
            return (
              <span
                key={i}
                className={cn(
                  "w-px rounded-full transition-colors",
                  major ? "h-6 bg-[var(--color-hairline-bright)]" : "h-3 bg-[var(--color-hairline)]",
                  Math.abs(value) < 0.01 && "bg-[var(--color-ink-faint)]",
                )}
              />
            );
          })}
        </div>

        {/* Centre gate: the target the marker has to land inside. */}
        <div
          className={cn(
            "absolute top-3 bottom-7 left-1/2 w-[12%] -translate-x-1/2 rounded-lg border transition-all duration-200",
            inTune
              ? "border-[var(--color-correct)] bg-[rgba(57,224,139,0.14)] glow-correct"
              : "border-[var(--color-hairline-bright)] bg-[rgba(255,255,255,0.02)]",
          )}
        />

        {/* Travelling marker. */}
        <div
          className="absolute top-2 bottom-6 w-[3px] -translate-x-1/2 rounded-full transition-[left] duration-100 ease-out"
          style={{
            left: `${percent}%`,
            background: active
              ? inTune
                ? "var(--color-correct)"
                : Math.abs(clamped) > 25
                  ? "var(--color-error)"
                  : "var(--color-warn)"
              : "var(--color-hairline-bright)",
            boxShadow: active
              ? `0 0 16px ${inTune ? "rgba(57,224,139,0.9)" : "rgba(255,194,71,0.8)"}`
              : "none",
            opacity: active ? 1 : 0.4,
          }}
        />

        <div className="absolute inset-x-0 bottom-1.5 flex justify-between px-3">
          <span className="hud-label">♭ −{range}</span>
          <span className={cn("hud-label", inTune && "text-[var(--color-correct)]")}>
            {inTune ? "in tune" : " "}
          </span>
          <span className="hud-label">+{range} ♯</span>
        </div>
      </div>
    </div>
  );
}
