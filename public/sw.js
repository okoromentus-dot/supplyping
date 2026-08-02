// SupplyPing service worker — makes the report form usable in dead zones.
//
// Strategy is deliberately NETWORK-FIRST for everything the app is built from.
// A cache-first worker would serve stale JavaScript after a deploy, which on a
// frequently-updated app causes far more damage than it prevents. Here the
// cache is purely an offline fallback: online users always get fresh code,
// offline users get the last version that loaded successfully.

const CACHE = "supplyping-v1";

// Loaded eagerly so a worker who has visited once can open the form cold.
const SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache API calls or third-party services. These genuinely require a
  // connection (AI analysis, Airtable, Supabase, EmailJS) and a stale response
  // would be worse than an honest failure.
  if (
    url.pathname.startsWith("/api/") ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Navigations (including QR scans landing on /r?...): try the network, fall
  // back to the cached shell so the form still opens with no signal.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match("/index.html").then((r) => r || caches.match("/"))
        )
    );
    return;
  }

  // Static assets (JS, CSS, images): network first, cache as backup.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
