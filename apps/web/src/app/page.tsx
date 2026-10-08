"use client";

import Link from "next/link";
import { INSTRUMENTS, getInstrument, recommendations, tuningsFor } from "@fretlight/core";
import { useMemo } from "react";
import { Panel } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { NAV_ITEMS } from "@/components/layout/nav";
import { useMounted } from "@/hooks/useMounted";
import { cn } from "@/lib/ui/cn";
import { summarise, useProgress } from "@/store/progress";
import { useSession } from "@/store/session";
import { useWeakAreas } from "@/store/weak-areas";
import { useT, type MessageKey } from "@/lib/i18n/locale";

/** The six things people come to Fretlight to do, each pointing at the one place that does it. */
const INTENTS = [
  { href: "/tuner", icon: "🎚", key: "tune" },
  { href: "/practice", icon: "🎯", key: "practice" },
  { href: "/companion?tab=ideas", icon: "💡", key: "ideas" },
  { href: "/companion?tab=loop", icon: "🔁", key: "loop" },
  { href: "/analyzer", icon: "🎵", key: "song" },
  { href: "/fretboard", icon: "🧭", key: "fretboard" },
] as const;

export default function HomePage() {
  const mounted = useMounted();
  const t = useT();
  const instrumentId = useSession((s) => s.instrumentId);
  const tuningId = useSession((s) => s.tuningId);
  const setInstrument = useSession((s) => s.setInstrument);
  const setTuning = useSession((s) => s.setTuning);
  const records = useProgress((s) => s.records);
  const notes = useWeakAreas((s) => s.notes);

  const instrument = getInstrument(instrumentId);
  const tunings = instrument ? tuningsFor(instrument.kind, instrument.stringCount) : [];
  const summary = summarise(records);
  const next = useMemo(() => (mounted ? recommendations(records, notes)[0] ?? null : null), [mounted, records, notes]);

  return (
    <div className="flex flex-col gap-6">
      <section className="animate-rise">
        <h1 className="text-gradient max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight md:text-5xl">
          {t("home.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-dim)] md:text-base">
          {t("home.intro")}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INTENTS.map((intent) => (
          <Link
            key={intent.href}
            href={intent.href}
            className="group flex items-start gap-3 rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-panel)] p-4 transition-all hover:border-[var(--color-signal)] hover:bg-[var(--color-panel-raised)] focus-visible:outline-2 focus-visible:outline-[var(--color-signal)]"
          >
            <span aria-hidden className="text-2xl leading-none">{intent.icon}</span>
            <span className="flex flex-col gap-0.5">
              <span className="text-base font-semibold">{t(`home.intent.${intent.key}` as MessageKey)} <span className="text-[var(--color-ink-faint)] group-hover:text-[var(--color-signal)]">→</span></span>
              <span className="text-xs leading-relaxed text-[var(--color-ink-faint)]">{t(`home.intent.${intent.key}.text` as MessageKey)}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Panel title={t("home.instrument")} meta={<span className="text-[11px] text-[var(--color-ink-faint)]">{t("home.instrument.meta")}</span>}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {INSTRUMENTS.map((option) => {
              const active = mounted && option.id === instrumentId;
              return (
                <button
                  key={option.id}
                  onClick={() => setInstrument(option.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-all",
                    active
                      ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.08)]"
                      : "border-[var(--color-hairline)] bg-[var(--color-void)] hover:border-[var(--color-hairline-bright)]",
                  )}
                >
                  <span className="text-sm font-medium">{option.name}</span>
                  <span className="readout text-[10px] text-[var(--color-ink-faint)]">{t("home.strings", { n: option.stringCount })}</span>
                </button>
              );
            })}
          </div>

          {mounted && tunings.length > 0 && (
            <div className="mt-4 border-t border-[var(--color-hairline)] pt-4">
              <h3 className="hud-label mb-2.5">{t("home.tuning")}</h3>
              <div className="flex flex-wrap gap-2">
                {tunings.map((tuning) => {
                  const active = tuning.id === tuningId;
                  return (
                    <button
                      key={tuning.id}
                      onClick={() => setTuning(tuning.id)}
                      aria-pressed={active}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-1.5 transition-all",
                        active ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]" : "border-[var(--color-hairline)] hover:border-[var(--color-hairline-bright)]",
                      )}
                    >
                      <span className="text-xs font-medium">{tuning.name}</span>
                      <span className="readout text-[10px] text-[var(--color-ink-faint)]">{tuning.strings.join(" ")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title={t("home.progress")}
          meta={
            <Link href="/progress" className="hud-label text-[var(--color-signal)] hover:underline">
              {t("home.seeAll")}
            </Link>
          }
        >
          {!mounted ? (
            <div className="h-24" />
          ) : summary.sessions === 0 ? (
            <p className="text-sm leading-relaxed text-[var(--color-ink-faint)]">
              {t("home.noProgress")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-5">
              <Stat label={t("home.sessions")} value={summary.sessions} />
              <Stat label={t("home.time")} value={summary.totalMinutes} unit={t("home.min")} />
              <Stat label={t("home.accuracy")} value={`${Math.round(summary.averageAccuracy * 100)}%`} tone="signal" />
              <Stat label={t("home.streak")} value={summary.streakDays} unit={t("home.days")} tone="correct" />
            </div>
          )}
          {next && (
            <Link href={next.href} className="mt-4 block rounded-xl border border-[var(--color-signal)] bg-[rgba(34,224,214,0.06)] p-3 hover:bg-[rgba(34,224,214,0.12)]">
              <span className="hud-label block">{t("home.nextStep")}</span>
              <span className="text-sm font-semibold">{next.title} →</span>
              <span className="mt-0.5 block text-xs text-[var(--color-ink-dim)]">{next.detail}</span>
            </Link>
          )}
        </Panel>
      </div>

      <Panel title={t("home.allTools")}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {NAV_ITEMS.filter((item) => item.href !== "/").map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group flex min-w-0 items-center gap-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] px-3 py-2.5 transition-all hover:border-[var(--color-hairline-bright)] hover:bg-[var(--color-panel-raised)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-signal)]" aria-hidden>
                <path d={item.icon} />
              </svg>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{t(`nav.${item.href}` as MessageKey)}</span>
                <span className="truncate text-[11px] text-[var(--color-ink-faint)]">{t(`nav.${item.href}.hint` as MessageKey)}</span>
              </span>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
