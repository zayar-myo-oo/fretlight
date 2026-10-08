"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { useT, type MessageKey } from "@/lib/i18n/locale";
import { cn } from "@/lib/ui/cn";

export type GuideTarget = string;

interface Step {
  readonly view: GuideTarget;
  readonly title: MessageKey;
  readonly learn: MessageKey;
  readonly cta: MessageKey;
}

const step = (view: string, key = view, overrides: Partial<Omit<Step, "view">> = {}): Step => ({
  view,
  title: `guide.${key}.title` as MessageKey,
  learn: `guide.${key}.learn` as MessageKey,
  cta: `guide.${key}.cta` as MessageKey,
  ...overrides,
});

const GUITAR_STEPS: readonly Step[] = ["cowboy", "triads", "tones", "fills", "lead", "practice", "looper"].map((view) => step(view));

const BASS_STEPS: readonly Step[] = [
  ...["bass-root", "bass-rootfifth", "bass-passing", "bass-approach", "bass-walking"].map((view) => step(view)),
  step("practice", "practice", { learn: "guide.bass-practice.learn" }),
  step("looper", "looper", { title: "guide.bass-looper.title", learn: "guide.bass-looper.learn" }),
];

const KEY = "fretlight.companion.guideHidden";

/**
 * A step-by-step route through the Companion, for people who are not sure where
 * to start. It follows the idea the whole screen is built on: chords, then the
 * triad inside, then the target note, then a fill, then a melody.
 */
export function LearningGuide({
  instrument,
  active,
  visited,
  onGo,
}: {
  instrument: "guitar" | "bass";
  active: string;
  visited: ReadonlySet<string>;
  onGo: (view: GuideTarget) => void;
}) {
  const [open, setOpen] = useState(true);
  const t = useT();
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "1") setOpen(false);
    } catch {
      // keep it open when storage is unavailable
    }
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      if (next) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, "1");
    } catch {
      // not persisted in private mode
    }
  };

  const steps = instrument === "bass" ? BASS_STEPS : GUITAR_STEPS;

  if (!open) {
    return (
      <div>
        <Button size="sm" variant="ghost" onClick={() => toggle(true)}>
          {t("guide.show")}
        </Button>
      </div>
    );
  }

  return (
    <Panel
      title={t("guide.title")}
      meta={
        <Button size="sm" variant="ghost" onClick={() => toggle(false)}>
          {t("guide.hide")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-3xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          {t("guide.intro")}
        </p>
        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => {
            const done = visited.has(step.view);
            const current = step.view === active;
            return (
              <li
                key={step.view + i}
                className={cn(
                  "flex flex-wrap items-start gap-3 rounded-xl border p-3 transition-colors",
                  current ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.06)]" : "border-[var(--color-hairline)] bg-[var(--color-void)]",
                )}
              >
                <span
                  className={cn(
                    "readout flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
                    done ? "border-[var(--color-correct,#39e08b)] text-[var(--color-correct,#39e08b)]" : "border-[var(--color-hairline-bright)] text-[var(--color-ink-faint)]",
                  )}
                  aria-label={done ? t("guide.visited") : t("guide.step", { n: i + 1 })}
                >
                  {done ? "✓" : i + 1}
                </span>
                <div className="min-w-[220px] flex-1">
                  <p className="text-sm font-medium">{t(step.title)}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-dim)]">{t(step.learn)}</p>
                </div>
                <Button size="sm" variant={current ? "primary" : "secondary"} onClick={() => onGo(step.view)}>
                  {t(step.cta)}
                </Button>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}
