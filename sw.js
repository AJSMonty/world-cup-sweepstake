/* Berks Footy PWA service worker.
   Strategy:
   - data.json + page navigations: network-first (always try for the latest
     results), fall back to cache when offline.
   - static assets (icons, trophy, manifest): cache-first for instant loads.
   Bump CACHE_VERSION to force clients onto a new shell. */
var CACHE_VERSION = 'berks-footy-v1';
var SHELL = [
  './',
  './index.html',
  './trophy.png',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function (c) { return c.addAll(SHELL); })
           .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var isData = sameOrigin && url.pathname.endsWith('/data.json');
  var isNav = req.mode === 'navigate';

  if (isData || isNav) {
    // Network-first: freshest results/page, cache as offline fallback.
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Cache-first for everything else (static assets).
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (sameOrigin && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
