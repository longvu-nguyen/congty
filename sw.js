// Service Worker cho PWA Kho Hàng Pro
const CACHE_NAME = 'kho-pro-cache-v18';
const ASSETS = [
  './index.html',
  './style.css?v=18.0',
  './data.js?v=18.0',
  './app.js?v=18.0',
  './manifest.json',
  './app_logo.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).then((response) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if (e.request.url.startsWith('http')) {
            cache.put(e.request, response.clone());
          }
          return response;
        });
      }).catch(() => cached);
    })
  );
});
