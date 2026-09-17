import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TtlCache } from './cache.js';
import { handleApi } from './routes.js';
import { createLive } from './live.js';
import { getUniverse, getFx } from './universe.js';
import { send } from './compress.js';
import { createRateLimiter } from './ratelimit.js';
import { upstreamStatus } from './upstream.js';
import { decorateCoinPage, decorateExchangePage, getExchangeList } from './seo.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const APP_VERSION = await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf8')
  .then((raw) => JSON.parse(raw).version).catch(() => 'unknown');

const cache = new TtlCache(500);
const live = createLive();

// Optional on-disk cache snapshot: survives restarts (and CoinGecko cooldowns). Empty CACHE_FILE disables it.
const CACHE_FILE = process.env.CACHE_FILE === undefined
  ? path.resolve(__dirname, '../.cache/cache.json')
  : process.env.CACHE_FILE;

async function restoreCache() {
  if (!CACHE_FILE) return;
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const n = cache.restore(JSON.parse(raw));
    if (n) console.log(`Restored ${n} cache entries from ${CACHE_FILE}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('Cache restore failed:', err.message);
  }
}

let lastSnapshotSize = -1;
async function persistCache() {
  if (!CACHE_FILE) return;
  try {
    const snap = cache.snapshot();
    if (snap.entries.length === lastSnapshotSize && snap.entries.length === 0) return;
    lastSnapshotSize = snap.entries.length;
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snap));
    await fs.rename(tmp, CACHE_FILE);
  } catch (err) {
    console.warn('Cache persist failed:', err.message);
  }
}

const rateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: parseInt(process.env.API_RATE_LIMIT || '120', 10)
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

const STATIC_ROUTES = {
  '/': '/index.html',
  '/watchlist': '/watchlist.html',
  '/portfolio': '/portfolio.html',
  '/converter': '/converter.html',
  '/heatmap': '/heatmap.html',
  '/gainers-losers': '/gainers-losers.html',
  '/categories': '/categories.html',
  '/exchanges': '/exchanges.html',
  '/alerts': '/alerts.html',
  '/compare': '/compare.html',
  '/overview': '/overview.html',
  '/trending': '/trending.html',
  '/settings': '/settings.html',
  '/status': '/status.html'
};

const CSP = "default-src 'self'; img-src 'self' https: data:; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
// HSTS is only meaningful behind TLS; enable it explicitly when the service is served over https.
const HSTS = process.env.ENABLE_HSTS === '1' || process.env.ENABLE_HSTS === 'true';

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (HSTS) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

const startTime = Date.now();

const server = http.createServer(async (req, res) => {
  const startMs = Date.now();
  let cacheStatus = '-';
  let statusCode = 200;
  let pathname = req.url || '/';

  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      statusCode = 405;
      res.writeHead(405, { 'Allow': 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;

    setSecurityHeaders(res);

    if (pathname === '/healthz') {
      const mem = process.memoryUsage();
      const body = JSON.stringify({
        ok: true,
        version: APP_VERSION,
        node: process.version,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        startedAt: startTime,
        now: Date.now(),
        memory: { rss: mem.rss, heapUsed: mem.heapUsed },
        cache: cache.stats(),
        upstream: upstreamStatus(),
        live: live.status()
      });
      send(req, res, 200, { 'Content-Type': 'application/json' }, body);
      return;
    }

    if (pathname === '/api/stream') {
      if (req.method === 'HEAD') {
        res.writeHead(200);
        res.end();
        return;
      }
      live.subscribe(res);
      req.on('close', () => live.unsubscribe(res));
      return; // Connection stays open
    }

    if (pathname === '/sitemap.xml') {
      const baseUrl = process.env.PUBLIC_URL || 'http://localhost:8080';
      const urls = Object.keys(STATIC_ROUTES);
      // Top coins from the universe snapshot (bounded wait; the sitemap must never hang on upstream).
      const uni = await Promise.race([getUniverse({ cache }).catch(() => null), new Promise(r => setTimeout(() => r(null), 1500))]);
      for (const row of uni?.rows || []) urls.push(`/coin/${encodeURIComponent(row.id)}`);
      const exchanges = await getExchangeList({ cache }).catch(() => null);
      for (const ex of exchanges || []) if (ex?.id) urls.push(`/exchange/${encodeURIComponent(ex.id)}`);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${baseUrl}${u === '/' ? '' : u}</loc></url>`).join('\n')}\n</urlset>`;
      send(req, res, 200, { 'Content-Type': 'application/xml; charset=utf-8' }, xml);
      return;
    }

    if (pathname.startsWith('/api/')) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      const rl = rateLimiter.check(ip);
      res.setHeader('X-RateLimit-Remaining', rl.remaining);

      if (!rl.ok) {
        const resetSecs = Math.ceil(rl.resetMs / 1000);
        res.setHeader('Retry-After', resetSecs);
        send(req, res, 429, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Too many requests' }));
        return;
      }

      if (req.method === 'HEAD') {
        send(req, res, 200, {}, '');
        return;
      }
      try {
        const result = await handleApi(req, res, url, { cache });
        statusCode = result.status;
        cacheStatus = result.cache;
        send(req, res, result.status, result.headers, result.body);
      } catch (err) {
        statusCode = err.status || 500;
        const headers = { 'Content-Type': 'application/json' };
        if (err.retryAfter) headers['Retry-After'] = String(err.retryAfter);
        send(req, res, statusCode, headers, JSON.stringify({ error: err.message || 'Internal Server Error' }));
      }
      return;
    }

    // Static routing
    let targetFile = pathname;
    if (STATIC_ROUTES[pathname]) {
      targetFile = STATIC_ROUTES[pathname];
    } else if (pathname.startsWith('/coin/')) {
      targetFile = '/coin.html';
    } else if (pathname.startsWith('/exchange/')) {
      targetFile = '/exchange.html';
    }

    let filePath = path.join(PUBLIC_DIR, targetFile);
    
    // Path traversal protection
    if (!filePath.startsWith(PUBLIC_DIR)) {
      statusCode = 403;
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    let stat;
    try {
      stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
        stat = await fs.stat(filePath);
      }
    } catch (err) {
      // 404
      statusCode = 404;
      try {
        const notFoundPath = path.join(PUBLIC_DIR, '404.html');
        const notFoundHtml = await fs.readFile(notFoundPath);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(notFoundHtml);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    const mtimeHex = stat.mtimeMs.toString(16);
    const coinPageId = targetFile === '/coin.html' && pathname.startsWith('/coin/')
      ? decodeURIComponent(pathname.split('/')[2] || '') : null;
    const exchangePageId = targetFile === '/exchange.html' && pathname.startsWith('/exchange/')
      ? decodeURIComponent(pathname.split('/')[2] || '') : null;
    const dynamicHead = coinPageId || exchangePageId;
    const etag = `W/"${stat.size}-${mtimeHex}${dynamicHead ? '-' + Math.floor(Date.now() / 60000) : ''}"`;

    if (req.headers['if-none-match'] === etag) {
      statusCode = 304;
      send(req, res, 304, { 'Cache-Control': cacheControl, 'ETag': etag }, '');
      return;
    }

    let content = '';
    if (req.method !== 'HEAD') {
      content = await fs.readFile(filePath);
      if (coinPageId && /^[a-z0-9-]{1,100}$/.test(coinPageId)) {
        content = await decorateCoinPage(content.toString('utf8'), coinPageId, {
          cache, publicUrl: process.env.PUBLIC_URL || 'http://localhost:8080'
        });
      } else if (exchangePageId && /^[a-z0-9_-]{1,60}$/.test(exchangePageId)) {
        content = await decorateExchangePage(content.toString('utf8'), exchangePageId, {
          cache, publicUrl: process.env.PUBLIC_URL || 'http://localhost:8080'
        });
      }
    }
    
    send(req, res, 200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'ETag': etag
    }, content);
    
  } catch (err) {
    // Last-resort guard: never let a handler exception kill the process.
    console.error('Unhandled request error', err);
    statusCode = 500;
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  } finally {
    if (pathname !== '/api/stream' && LOG_LEVEL !== 'silent') {
      const ms = Date.now() - startMs;
      console.log(`${req.method} ${req.url} ${statusCode} ${ms}ms ${cacheStatus}`);
    }
  }
});

function shutdown() {
  console.log('Shutting down gracefully...');
  persistCache().finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await restoreCache();
server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
setInterval(persistCache, 30000).unref();

setTimeout(() => {
  getUniverse({cache}).catch(()=>{});
  getFx({cache}).catch(()=>{});
}, 500);

setInterval(() => {
  getUniverse({cache}).catch(()=>{});
}, 60000).unref();
