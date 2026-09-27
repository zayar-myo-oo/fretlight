"use client";

import { cn } from "@/lib/ui/cn";

export interface SliderProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
  readonly label?: string;
  readonly className?: string;
  readonly "aria-label"?: string;
}

export function Slider({ value, min, max, step = 1, onChange, label, className, ...rest }: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <label className={cn("block", className)}>
      {label && <span className="hud-label mb-2 block">{label}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={rest["aria-label"] ?? label}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none
          [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-signal)]
          [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(34,224,214,0.7)]
          [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--color-signal)]"
        style={{
          background: `linear-gradient(to right, var(--color-signal) ${percent}%, var(--color-hairline) ${percent}%)`,
        }}
      />
    </label>
  );
}
