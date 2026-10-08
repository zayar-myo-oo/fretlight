"use client";

import { LOCALES, useLocale, useLocaleStore, useT } from "@/lib/i18n/locale";
import { cn } from "@/lib/ui/cn";

/** English / မြန်မာ toggle. The choice is saved on this device. */
export function LanguageSwitch() {
  const locale = useLocale();
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useT();
  return (
    <div role="group" aria-label={t("shell.language")} className="flex rounded-lg border border-[var(--color-hairline)] p-0.5">
      {LOCALES.map((option) => (
        <button
          key={option.id}
          onClick={() => setLocale(option.id)}
          aria-pressed={locale === option.id}
          lang={option.id}
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] transition-colors",
            locale === option.id ? "bg-[rgba(34,224,214,0.14)] text-[var(--color-signal)]" : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
