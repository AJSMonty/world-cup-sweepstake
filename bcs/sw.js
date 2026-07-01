/* BCS sweepstake PWA service worker (scope: /bcs/).
   Same strategy as the main site: network-first for the shared data.json and
   page navigations (freshest results), cache-first for the shell/assets.
   Bump CACHE_VERSION to force clients onto a new shell. */
var CACHE_VERSION = 'bcs-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  '../trophy.png',
  '../icon-192.png',
  '../icon-512.png',
  '../apple-touch-icon.png'
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
