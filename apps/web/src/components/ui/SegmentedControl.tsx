"use client";

import { cn } from "@/lib/ui/cn";

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly className?: string;
  readonly size?: "sm" | "md";
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex rounded-xl border border-[var(--color-hairline)] bg-[var(--color-chassis)] p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-lg transition-all duration-150",
              size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs",
              active
                ? "bg-[var(--color-panel-raised)] text-[var(--color-ink)] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
                : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
