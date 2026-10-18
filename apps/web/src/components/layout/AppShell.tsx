"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { getInstrument } from "@fretlight/core";
import { useSession } from "@/store/session";
import { useCalibration } from "@/hooks/useCalibration";
import { useDetection } from "@/hooks/useDetection";
import { useMounted } from "@/hooks/useMounted";
import { resolveTuning } from "@/lib/tuning/resolve-tuning";
import { cn } from "@/lib/ui/cn";
import { useHtmlLang, useT, useTx } from "@/lib/i18n/locale";
import { LanguageSwitch } from "./LanguageSwitch";
import { NAV_ITEMS } from "./nav";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const x = useTx();
  useCalibration();
  useHtmlLang();
  const links = NAV_ITEMS.map(item => (
    <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}
      className={cn("flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm md:flex-none md:justify-start",
        pathname === item.href ? "bg-[rgba(34,224,214,0.12)] text-[var(--color-signal)]" : "text-[var(--color-ink-dim)] hover:bg-[rgba(255,255,255,0.04)]")}>
      <Icon path={item.icon} /><span>{x(item.label)}</span>
    </Link>
  ));
  return (
    <div className="stack flex min-h-dvh flex-col md:flex-row">
      <nav aria-label={x("Main navigation")} className="sticky top-0 hidden h-dvh w-44 shrink-0 flex-col gap-2 border-r border-[var(--color-hairline)] bg-[rgba(8,12,20,0.72)] px-3 py-5 md:flex">
        <Link href="/fretboard" aria-label="Fretlight" className="mb-5 px-2"><Mark compact /></Link>
        {links}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10">{children}</main>
      </div>
      <nav aria-label={x("Mobile navigation")} className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--color-hairline)] bg-[rgba(8,12,20,0.96)] px-2 pb-[env(safe-area-inset-bottom)] md:hidden">{links}</nav>
    </div>
  );
}

function TopBar() {
  const instrumentId = useSession((s) => s.instrumentId);
  const tuningId = useSession((s) => s.tuningId);
  const customTunings = useSession((s) => s.customTunings);
  const mounted = useMounted();
  const t = useT();

  const instrument = getInstrument(instrumentId);
  const tuning = resolveTuning(instrumentId, tuningId, customTunings);

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] bg-[rgba(4,6,11,0.72)] px-4 py-3 backdrop-blur-xl md:px-8">
      <div className="flex items-center gap-3">
        <div className="md:hidden">
          <Mark compact />
        </div>
        {mounted && instrument && tuning && (
          <div className="flex items-baseline gap-2.5">
            <span className="text-sm font-semibold">{instrument.name}</span>
            <span className="readout text-[11px] text-[var(--color-ink-faint)]">
              {tuning.strings.join(" ")}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="hud-label hidden sm:inline">{t("shell.offline")}</span>
        <LanguageSwitch />
        <ListeningDot />
      </div>
    </header>
  );
}

function ListeningDot() {
  const { listening, sourceLabel, rms } = useDetection();
  const t = useT();
  return (
    <span
      className="flex items-center gap-2"
      title={listening ? `Listening — ${sourceLabel}` : "Not listening"}
    >
      <span className="relative flex h-2.5 w-2.5">
        {listening && (
          <span
            className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-signal)] opacity-60 animate-pulse-ring"
            style={{ animationDuration: rms > 0.02 ? "0.7s" : "1.6s" }}
          />
        )}
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full",
            listening ? "bg-[var(--color-signal)]" : "bg-[var(--color-hairline-bright)]",
          )}
        />
      </span>
      <span className="hud-label hidden md:inline">{listening ? t("shell.live") : t("shell.idle")}</span>
    </span>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function Mark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width={compact ? 20 : 26} height={compact ? 20 : 26} viewBox="0 0 26 26" fill="none">
        <rect x="1" y="1" width="24" height="24" rx="7" stroke="var(--color-signal)" strokeWidth="1.3" opacity="0.5" />
        <path d="M7 18.5 19 7.5" stroke="var(--color-signal)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="9.5" cy="16" r="2.2" fill="var(--color-root)" />
        <circle cx="16.5" cy="10" r="2.2" fill="var(--color-signal)" />
      </svg>
      {compact && <span className="text-sm font-semibold tracking-tight">Fretlight</span>}
    </span>
  );
}
