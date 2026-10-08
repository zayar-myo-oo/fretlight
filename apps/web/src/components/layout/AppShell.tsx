"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getInstrument } from "@fretlight/core";
import { useSession } from "@/store/session";
import { useCalibration } from "@/hooks/useCalibration";
import { useDetection } from "@/hooks/useDetection";
import { useMounted } from "@/hooks/useMounted";
import { resolveTuning } from "@/lib/tuning/resolve-tuning";
import { cn } from "@/lib/ui/cn";
import { useHtmlLang, useT, type MessageKey } from "@/lib/i18n/locale";
import { LanguageSwitch } from "./LanguageSwitch";
import { NAV_ITEMS, type NavItem } from "./nav";

const label = (item: NavItem) => `nav.${item.href}` as MessageKey;
const hint = (item: NavItem) => `nav.${item.href}.hint` as MessageKey;

/**
 * Application chrome: an icon rail on desktop, a tab bar on phones.
 * Kept deliberately thin — the practice surface is the product, not the nav.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Applies calibration (gain/noise gate/smoothing) to detectionHub wherever
  // the player left the settings, regardless of which page opened the input.
  useCalibration();
  useHtmlLang();

  return (
    <div className="stack flex min-h-dvh flex-col md:flex-row">
      {/* Desktop rail */}
      <nav className="sticky top-0 z-30 hidden h-dvh w-[76px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-hairline)] bg-[rgba(8,12,20,0.72)] py-5 backdrop-blur-xl md:flex">
        <Link href="/" className="mb-5 flex flex-col items-center gap-1.5" aria-label="Fretlight home">
          <Mark />
        </Link>
        {NAV_ITEMS.map((item) => (
          <RailLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
        <div className="mt-auto">
          <ListeningDot />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10">
          {children}
        </main>
      </div>

      <MobileTabBar pathname={pathname} />
    </div>
  );
}

/**
 * Eight destinations do not fit a phone-width bottom bar as flat, equal-width
 * tabs — each one shrinks past the point of being reliably tappable. So only
 * `mobilePrimary` items (see nav.ts) get a permanent slot; everything else
 * sits behind a "More" tab that opens a small sheet above the bar. The
 * desktop rail is unaffected — it always lists every item.
 */
function MobileTabBar({ pathname }: { pathname: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const t = useT();
  const primary = NAV_ITEMS.filter((item) => item.mobilePrimary);
  const overflow = NAV_ITEMS.filter((item) => !item.mobilePrimary);
  const overflowActive = overflow.some((item) => isActive(pathname, item.href));

  // Close the sheet on navigation rather than leaving it open over the new page.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      {moreOpen && (
        <>
          <button
            aria-label={t("nav.closeMenu")}
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-[rgba(4,6,11,0.6)] backdrop-blur-sm md:hidden"
          />
          <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] p-2 shadow-[0_-8px_30px_rgba(0,0,0,0.4)] md:hidden">
            <div className="grid grid-cols-2 gap-1.5">
              {overflow.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors",
                      active
                        ? "bg-[rgba(34,224,214,0.12)] text-[var(--color-signal)]"
                        : "text-[var(--color-ink-dim)] hover:bg-[rgba(255,255,255,0.04)]",
                    )}
                  >
                    <Icon path={item.icon} />
                    <span className="text-xs font-medium">{t(label(item))}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-[var(--color-hairline)] bg-[rgba(8,12,20,0.92)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors",
                active ? "text-[var(--color-signal)]" : "text-[var(--color-ink-faint)]",
              )}
            >
              <Icon path={item.icon} />
              <span className="text-[9px] tracking-wider uppercase">{t(label(item))}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-label={t("nav.more")}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors",
            moreOpen || overflowActive ? "text-[var(--color-signal)]" : "text-[var(--color-ink-faint)]",
          )}
        >
          <Icon path="M5 12h.01M12 12h.01M19 12h.01M5 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
          <span className="text-[9px] tracking-wider uppercase">{t("nav.more")}</span>
        </button>
      </nav>
    </>
  );
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  const t = useT();
  return (
    <Link
      href={item.href}
      title={t(hint(item))}
      className={cn(
        "group relative flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200",
        active
          ? "bg-[rgba(34,224,214,0.12)] text-[var(--color-signal)]"
          : "text-[var(--color-ink-faint)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--color-ink-dim)]",
      )}
    >
      {active && (
        <span className="absolute left-[-13px] h-6 w-[3px] rounded-r-full bg-[var(--color-signal)] shadow-[0_0_10px_var(--color-signal)]" />
      )}
      <Icon path={item.icon} />
      <span className="pointer-events-none absolute left-[60px] z-50 hidden whitespace-nowrap rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2.5 py-1.5 text-xs text-[var(--color-ink)] group-hover:block">
        {t(label(item))}
      </span>
    </Link>
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
