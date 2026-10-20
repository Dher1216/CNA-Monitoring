// Keeps the app screens (never the figures) on the phone so the app opens fast, even while the
// server is waking up. Report data is never stored here: it always comes from the server.
var CACHE = 'cna-shell-v1';
var SHELL = ['/', '/app.css', '/app.js', '/report.js', '/pwa.js', '/seal.png', '/favicon.png', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest', '/fonts/ibm-plex-sans-latin-400-normal.woff2', '/fonts/ibm-plex-sans-latin-500-normal.woff2', '/fonts/ibm-plex-sans-latin-600-normal.woff2', '/fonts/spectral-latin-500-normal.woff2', '/fonts/spectral-latin-600-normal.woff2'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/healthz' || url.pathname === '/sw.js') return; // always live
  var key = req.mode === 'navigate' ? '/' : req;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(key, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || fresh;
    });
  }));
});
