"use client";

import { useEffect, useRef } from "react";

export type KeyHandlerMap = Record<string, (event: KeyboardEvent) => void>;

/**
 * Global keyboard shortcuts.
 *
 * Skips events originating in text inputs so typing a song title never
 * toggles the transport — a mistake that is very annoying exactly once.
 */
export function useKeyboard(handlers: KeyHandlerMap, enabled = true): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      const handler = ref.current[event.key] ?? ref.current[event.code];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
