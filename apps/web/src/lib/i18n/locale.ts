"use client";

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useMounted } from "@/hooks/useMounted";
import { MESSAGES, type Locale, type MessageKey } from "./messages";

export type { Locale, MessageKey } from "./messages";

export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "my", label: "မြန်မာ" },
];

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist((set) => ({ locale: "en", setLocale: (locale) => set({ locale }) }), { name: "fretlight.locale", version: 1 }),
);

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/**
 * The active language. Until the page has mounted it is always English, so the
 * server-rendered HTML and the first client render agree; the saved choice is
 * applied straight after.
 */
export function useLocale(): Locale {
  const mounted = useMounted();
  const locale = useLocaleStore((s) => s.locale);
  return mounted ? locale : "en";
}

export function useT(): Translate {
  const locale = useLocale();
  return useCallback<Translate>((key, vars) => translate(locale, key, vars), [locale]);
}

/** Keeps `<html lang>` in step with the chosen language (screen readers and font fallback use it). */
export function useHtmlLang() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}
