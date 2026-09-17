/*
 * RAW Radio — self-destruct service worker.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * The previous listener site (`web/`, Vite + vite-plugin-pwa) registered a
 * Workbox service worker at this exact URL (`/sw.js`, scope `/`,
 * `registerType: 'autoUpdate'`). Visitors who ever loaded that site still have
 * it installed on their machine.
 *
 * The current site (`app/`, Expo web export) is a static SPA and ships no
 * service worker. Without one, the browser's update check for `/sw.js` would
 * 404 — and a 404 does not unregister anything: the legacy worker stays active
 * and keeps serving its own precached app shell, so those visitors never see
 * the new site.
 *
 * So this file is not a cache. It is a tombstone: it takes over the legacy
 * registration, unregisters itself and steps aside, leaving the origin with no
 * service worker at all. It must stay tiny and must never precache anything —
 * it exists only to get out of the way.
 *
 * ── Lifecycle ─────────────────────────────────────────────────────────────
 *   install  → skipWaiting(): do not queue behind the legacy worker.
 *   activate → unregister this registration, then reload every window it
 *              controls once, so each tab drops out of the legacy worker's
 *              control and loads the real site straight from the network.
 *
 * Deliberately NOT used: fetch/install caches, `clients.claim()`, precaching.
 * Served with `Cache-Control: no-cache, no-store, must-revalidate` and
 * `Content-Type: application/javascript` — see
 * `docker/web/nginx.static.conf` (`location = /sw.js`). Without that, a cached
 * copy could delay the eviction for as long as the browser keeps it, which is
 * exactly the problem this file solves.
 */

self.addEventListener('install', (event) => {
  // Activate immediately instead of waiting for existing clients to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop the registration (this one). After this resolves the origin has
      // no service worker: neither the legacy one nor this tombstone.
      await self.registration.unregister();

      // Reload controlled windows once so they stop being served by the
      // legacy worker's cached shell. `navigate` is a no-op on clients that
      // are not controlled, and the reload cannot loop: the registration is
      // already gone, so the next load is uncontrolled.
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) {
        client.navigate(client.url).catch(() => {});
      }
    })(),
  );
});
