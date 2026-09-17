const CACHE_NAME = 'cryptolive-v2';

const PRECACHE_URLS = [
  '/',
  '/css/style.css',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/js/alerts.js',
  '/js/api.js',
  '/js/components.js',
  '/js/format.js',
  '/js/layout.js',
  '/js/live.js',
  '/js/store.js',
  '/js/theme-boot.js',
  '/js/pages/alerts.js',
  '/js/pages/categories.js',
  '/js/pages/coin.js',
  '/js/pages/compare.js',
  '/js/pages/converter.js',
  '/js/pages/exchanges.js',
  '/js/pages/gainers-losers.js',
  '/js/pages/heatmap.js',
  '/js/pages/markets.js',
  '/js/pages/not-found.js',
  '/js/pages/overview.js',
  '/js/pages/portfolio.js',
  '/js/pages/trending.js',
  '/js/pages/watchlist.js',
  '/js/pages/settings.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/sw.js') {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((res) => {
          return res || caches.match('/');
        });
      })
    );
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse.ok) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          }
          return networkResponse;
        });
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Cross-origin requests (fonts, CDN, coin images) are left to the browser: the worker runs under the
  // site's CSP (connect-src 'self'), so fetching them from here would be blocked.
});
