"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--color-signal)] text-[#022523] hover:bg-[var(--color-signal-bright)] border-transparent font-semibold",
  secondary:
    "bg-[var(--color-panel-raised)] text-[var(--color-ink)] hover:bg-[#1a2334] border-[var(--color-hairline-bright)]",
  ghost:
    "bg-transparent text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[rgba(255,255,255,0.04)] border-transparent",
  danger:
    "bg-[rgba(255,84,112,0.14)] text-[var(--color-error)] hover:bg-[rgba(255,84,112,0.22)] border-[rgba(255,84,112,0.35)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl border transition-all duration-150",
        "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
