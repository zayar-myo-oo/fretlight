"use client";

import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useMounted } from "@/hooks/useMounted";
import { MESSAGES, type Locale, type MessageKey } from "./messages";
import { PHRASES_MY, RULES_MY } from "./phrases-my";

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

export type Tx = (text: string, vars?: Record<string, string | number>) => string;

const fill = (template: string, vars?: Record<string, string | number>) =>
  vars ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : template;

function sentenceMy(sentence: string): string | null {
  const exact = PHRASES_MY[sentence];
  if (exact !== undefined) return exact;
  for (const [pattern, build] of RULES_MY) {
    const match = sentence.match(pattern);
    if (match) return build(...match);
  }
  return null;
}

/**
 * Translate a phrase written in English, the way the Companion's UI and the
 * core engine's generated explanations are. Whole-text matches win; otherwise
 * the text is split into sentences and the longest run of sentences with a
 * translation is used at each point, so a fixed tip appended to a generated
 * sentence is still translated. Untranslated sentences stay in English.
 */
export function localize(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  if (locale === "en" || !text) return fill(text, vars);
  const whole = sentenceMy(text);
  if (whole !== null) return fill(whole, vars);
  const parts = text.split(/(?<=[.!?])\s+/);
  if (parts.length === 1) return fill(text, vars);
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let done = false;
    for (let j = parts.length; j > i; j--) {
      const translated = sentenceMy(parts.slice(i, j).join(" "));
      if (translated !== null) {
        out.push(translated);
        i = j;
        done = true;
        break;
      }
    }
    if (!done) out.push(parts[i++]!);
  }
  return fill(out.join(" "), vars);
}

export function useTx(): Tx {
  const locale = useLocale();
  return useCallback<Tx>((text, vars) => localize(locale, text, vars), [locale]);
}

/** Keeps `<html lang>` in step with the chosen language (screen readers and font fallback use it). */
export function useHtmlLang() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}
