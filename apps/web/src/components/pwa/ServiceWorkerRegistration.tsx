"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once the app has mounted.
 *
 * Deferred to a client-side effect rather than a blocking script tag, so it
 * never delays first paint — registration racing the page render buys
 * nothing, since the worker only helps on the *next* load.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Service workers require a secure context; localhost is exempted, so
    // this is a no-op in most local dev setups and active once actually
    // deployed over HTTPS.
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: the app works identically without a service worker, it
      // just loses the offline-reload fallback and the "Add to Home Screen"
      // install prompt on browsers that require one.
    });
  }, []);

  return null;
}
