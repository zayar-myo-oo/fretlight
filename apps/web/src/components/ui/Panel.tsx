import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface PanelProps {
  readonly children: ReactNode;
  readonly title?: string;
  readonly meta?: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly tight?: boolean;
}

/** The standard container. Titles use the hardware-silkscreen label style. */
export function Panel({ children, title, meta, className, bodyClassName, tight }: PanelProps) {
  return (
    <section className={cn("surface stack", className)}>
      {(title || meta) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--color-hairline)] px-5 py-3.5">
          {title && <h2 className="hud-label whitespace-nowrap">{title}</h2>}
          {meta && <div className="flex flex-wrap items-center gap-2">{meta}</div>}
        </header>
      )}
      <div className={cn(tight ? "p-3" : "p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
