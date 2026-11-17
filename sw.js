/* Airly service worker — keeps the app working offline.
 * Strategy: serve from the cache first, refresh the cache in the background.
 * Bump VERSION whenever files change so users get the new version. */
const VERSION = 'airly-v45';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/lang/base.js',
  './js/core/i18n.js',
  './js/lang/it.js',
  './js/lang/de.js',
  './js/lang/el.js',
  './js/core/store.js',
  './js/model/thermal.js',
  './js/model/recommend.js',
  './js/ui/charts.js',
  './js/ui/furniture.js',
  './js/ui/floorplan.js',
  './js/ui/view3d.js',
  './js/ui/kit.js',
  './js/ui/share.js',
  './js/views/dashboard.js',
  './js/views/designer.js',
  './js/views/rooms.js',
  './js/views/acs.js',
  './js/views/compare.js',
  './js/views/simulator.js',
  './js/views/recommendations.js',
  './js/views/energy.js',
  './js/views/purchase.js',
  './js/views/eco.js',
  './js/views/guide.js',
  './js/views/maintenance.js',
  './js/views/care.js',
  './js/views/settings.js',
  './js/app/state.js',
  './js/app/shell.js',
  './js/app/binding.js',
  './js/app/actions.js',
  './js/app/main.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      })
    )
  );
});

/* clicking a reminder notification opens (or focuses) Airly on the maintenance page */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const url = './index.html#maintenance';
      for (const c of list) if ('focus' in c) { c.navigate(url); return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});
