"use client";

import { useEffect, useState } from "react";

/**
 * True only after hydration.
 *
 * Anything reading persisted state or `performance.now()` must wait for this,
 * or the server-rendered markup and the first client render disagree.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
