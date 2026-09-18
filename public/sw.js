const CACHE_NAME = 'cryptolive-v6';
const API_CACHE = 'cryptolive-api-v1';

const PRECACHE_URLS = [
  '/',
  '/css/style.css',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/js/alerts.js',
  '/js/api.js',
  '/js/components.js',
  '/js/format.js',
  '/js/i18n.js',
  '/js/i18n/en.js',
  '/js/i18n/ru.js',
  '/js/i18n/es.js',
  '/js/i18n/de.js',
  '/js/layout.js',
  '/js/live.js',
  '/js/store.js',
  '/js/theme-boot.js',
  '/js/pages/alerts.js',
  '/js/pages/categories.js',
  '/js/pages/coin.js',
  '/js/pages/compare.js',
  '/js/pages/converter.js',
  '/js/pages/exchange.js',
  '/js/pages/exchanges.js',
  '/js/pages/gainers-losers.js',
  '/js/pages/heatmap.js',
  '/js/pages/markets.js',
  '/js/pages/not-found.js',
  '/js/pages/overview.js',
  '/js/pages/portfolio.js',
  '/js/pages/trending.js',
  '/js/pages/watchlist.js',
  '/js/pages/settings.js',
  '/js/pages/status.js',
  '/js/pages/api-docs.js'
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
          if (key !== CACHE_NAME && key !== API_CACHE) {
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
  if (url.pathname === '/healthz' || url.pathname === '/sw.js') {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (event.request.method !== 'GET' || url.pathname === '/api/stream') {
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then(async (c) => {
              await c.put(event.request, clone);
              const keys = await c.keys();
              if (keys.length > 150) {
                for (let i = 0; i < keys.length - 150; i++) {
                  await c.delete(keys[i]);
                }
              }
            });
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(event.request, { cacheName: API_CACHE });
          if (cached) {
            const headers = new Headers(cached.headers);
            headers.set('X-Offline', '1');
            return new Response(await cached.arrayBuffer(), {
              status: cached.status,
              statusText: cached.statusText,
              headers
            });
          }
          return new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
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
