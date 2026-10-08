"use client";

import { type ReactNode, useState } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * A section that shows one line of summary and opens to reveal its controls.
 * Used to keep a busy screen calm: the current settings stay readable, and the
 * knobs appear only when someone wants to change them.
 */
export function Disclosure({
  title,
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)]", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="hud-label shrink-0">{title}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink-dim)]">{summary}</span>
        <span className="text-xs text-[var(--color-ink-faint)]">{open ? "Close ▴" : "Change ▾"}</span>
      </button>
      {open && <div className="border-t border-[var(--color-hairline)] p-4">{children}</div>}
    </div>
  );
}
