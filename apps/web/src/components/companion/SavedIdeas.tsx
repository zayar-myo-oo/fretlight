"use client";

import { CATEGORY_LABELS, STYLE_PROFILES } from "@fretlight/core";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { type SavedIdea, deleteIdea } from "@/lib/companion/saved-ideas";
import { useTx } from "@/lib/i18n/locale";

export function SavedIdeas({
  ideas,
  onChange,
  onUse,
}: {
  ideas: readonly SavedIdea[];
  onChange: (list: SavedIdea[]) => void;
  onUse: (idea: SavedIdea) => void;
}) {
  const x = useTx();
  if (ideas.length === 0) return null;
  return (
    <Panel title={x("Saved ideas")} meta={<span className="text-[11px] text-[var(--color-ink-faint)]">{x("Kept on this device only")}</span>}>
      <ul className="flex flex-col gap-4">
        {ideas.map((idea) => (
          <li key={idea.id} className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{x(idea.title)}</p>
                <p className="readout text-[11px] text-[var(--color-ink-faint)]">
                  {idea.progression} · {idea.key ?? x("key uncertain")} · {STYLE_PROFILES[idea.style].label} · {x(idea.instrument)} · {x(idea.difficulty)} ·{" "}
                  {x(CATEGORY_LABELS[idea.category])}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => onUse(idea)}>
                  {x("Use this setup")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onChange(deleteIdea(idea.id))}>
                  {x("Delete")}
                </Button>
              </div>
            </div>
            <pre className="readout mt-2 overflow-x-auto text-xs leading-relaxed">{idea.tab.join("\n")}</pre>
            <p className="mt-1 text-xs text-[var(--color-ink-dim)]">{x(idea.description)}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
