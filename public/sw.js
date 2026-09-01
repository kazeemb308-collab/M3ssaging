const CACHE = 'me-and-you-shell-v1';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      // Return the app immediately; refresh the cache quietly in the background.
      event.waitUntil(fetch(request).then(response => {
        if (response.ok) return caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      }).catch(() => {}));
      return cached;
    }

    try {
      const response = await fetch(request);
      if (response.ok && new URL(request.url).origin === location.origin) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch (_) {
      return caches.match('/index.html');
    }
  })());
});
