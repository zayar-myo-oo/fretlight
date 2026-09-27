/**
 * Fretlight service worker.
 *
 * The app is under active development, so this is deliberately conservative
 * rather than a typical "cache everything, serve stale" PWA worker:
 *
 *   - HTML and JS/CSS: network-first. A fresh page load always tries the
 *     latest deploy before falling back to whatever was last cached. A more
 *     aggressive cache-first strategy would mean installing this on a phone
 *     once and then silently never seeing new builds — exactly wrong while
 *     the app is still changing daily.
 *   - Icons and the manifest: cache-first. These almost never change and
 *     there is no harm in serving them instantly.
 *   - Everything else (camera/mic streams, any future API calls): left
 *     alone, untouched by this worker.
 *
 * The offline fallback this buys is real but modest: if you lose signal
 * mid-session, the last page you had open keeps working rather than going
 * blank, which matches the app's own "offline capable" claim for its local
 * DSP/theory engine. It is not an offline-first cache of the whole app.
 */

const VERSION = "v1";
const CACHE_NAME = `fretlight-${VERSION}`;

const PRECACHE = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Static, near-never-changing assets: cache first, network as a fallback.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
    return;
  }

  // Everything navigable or scripted: network first, cache only as an
  // offline fallback, and only ever updated from a *successful* network
  // response so a failed deploy can never overwrite a good cached copy.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});
