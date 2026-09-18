import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './routes.js';
import { getUniverse } from './universe.js';
import { send, weakEtag, etagMatches } from './compress.js';
import { createRateLimiter } from './ratelimit.js';
import { upstreamStatus } from './upstream.js';
import { decorateCoinPage, decorateExchangePage, getExchangeList } from './seo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.resolve(__dirname, '../public');

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
  '/status': '/status.html',
  '/api-docs': '/api-docs.html'
};

const CSP = "default-src 'self'; img-src 'self' https: data:; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for']?.split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress;
}

export async function createApp({ cache, live, popular, publicDir, options = {} }) {
  const logLevel = options.logLevel ?? (process.env.LOG_LEVEL || 'info');
  const logFormat = options.logFormat ?? (process.env.LOG_FORMAT || 'text');
  const publicUrl = options.publicUrl ?? (process.env.PUBLIC_URL || 'http://localhost:8080');
  const apiRateLimit = options.apiRateLimit ?? parseInt(process.env.API_RATE_LIMIT || '120', 10);
  const hsts = options.hsts ?? (process.env.ENABLE_HSTS === '1' || process.env.ENABLE_HSTS === 'true');
  // Only honour X-Forwarded-For behind a reverse proxy we control; otherwise clients could spoof their IP.
  const trustProxy = options.trustProxy ?? (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true');
  const maxSseClients = options.maxSseClients ?? (parseInt(process.env.MAX_SSE_CLIENTS || '500', 10) || 500);
  const startTime = options.startTime ?? Date.now();
  const version = options.version === undefined
    ? await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf8')
      .then((raw) => JSON.parse(raw).version).catch(() => 'unknown')
    : options.version;
  const resolvedPublicDir = path.resolve(publicDir ?? DEFAULT_PUBLIC_DIR);
  const rateLimiter = createRateLimiter({ windowMs: 60_000, max: apiRateLimit });

  function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const handler = async (req, res) => {
    const startMs = Date.now();
    let cacheStatus = '-';
    let statusCode = 200;
    let pathname = req.url || '/';
    let query = '';
    const incomingId = req.headers['x-request-id'];
    const id = typeof incomingId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(incomingId)
      ? incomingId : randomUUID();

    try {
      res.setHeader('X-Request-Id', id);

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        statusCode = 405;
        res.writeHead(405, { 'Allow': 'GET, HEAD' });
        res.end('Method Not Allowed');
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      pathname = url.pathname;
      query = url.search;

      setSecurityHeaders(res);

      if (pathname === '/healthz') {
        const mem = process.memoryUsage();
        const body = JSON.stringify({
          ok: true,
          version,
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
        if (live.status().subscribers >= maxSseClients) {
          statusCode = 503;
          send(req, res, 503, { 'Content-Type': 'application/json', 'Retry-After': '30' }, JSON.stringify({ error: 'Too many live connections' }));
          return;
        }
        live.subscribe(res);
        req.on('close', () => live.unsubscribe(res));
        return;
      }

      if (pathname === '/sitemap.xml') {
        const urls = Object.keys(STATIC_ROUTES);
        const uni = await Promise.race([getUniverse({ cache }).catch(() => null), new Promise(r => setTimeout(() => r(null), 1500))]);
        for (const row of uni?.rows || []) urls.push(`/coin/${encodeURIComponent(row.id)}`);
        const exchanges = await getExchangeList({ cache }).catch(() => null);
        for (const ex of exchanges || []) if (ex?.id) urls.push(`/exchange/${encodeURIComponent(ex.id)}`);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${publicUrl}${u === '/' ? '' : u}</loc></url>`).join('\n')}\n</urlset>`;
        send(req, res, 200, { 'Content-Type': 'application/xml; charset=utf-8' }, xml);
        return;
      }

      if (pathname.startsWith('/api/')) {
        const ip = clientIp(req, trustProxy);
        const rl = rateLimiter.check(ip);
        res.setHeader('X-RateLimit-Remaining', rl.remaining);

        if (!rl.ok) {
          const resetSecs = Math.ceil(rl.resetMs / 1000);
          res.setHeader('Retry-After', resetSecs);
          send(req, res, 429, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Too many requests' }));
          return;
        }

        try {
          const result = await handleApi(req, res, url, { cache, popular });
          statusCode = result.status;
          cacheStatus = result.cache;
          if (req.method === 'HEAD') {
            send(req, res, result.status, result.headers, '');
            return;
          }
          if (result.status === 200 &&
              ((typeof result.body === 'string' && result.body.length > 0) ||
               (Buffer.isBuffer(result.body) && result.body.length > 0))) {
            const etag = weakEtag(result.body);
            result.headers = { ...result.headers, 'ETag': etag };
            if (etagMatches(req.headers['if-none-match'], etag)) {
              statusCode = 304;
              send(req, res, 304, {
                'ETag': etag,
                'Cache-Control': result.headers['Cache-Control'] || 'no-cache',
                'X-Cache': result.headers['X-Cache'] || result.cache || ''
              }, '');
              return;
            }
          }
          send(req, res, result.status, result.headers, result.body);
        } catch (err) {
          statusCode = err.status || 500;
          const headers = { 'Content-Type': 'application/json' };
          if (err.retryAfter) headers['Retry-After'] = String(err.retryAfter);
          send(req, res, statusCode, headers, req.method === 'HEAD' ? '' : JSON.stringify({ error: err.message || 'Internal Server Error' }));
        }
        return;
      }

      let targetFile = pathname;
      if (STATIC_ROUTES[pathname]) {
        targetFile = STATIC_ROUTES[pathname];
      } else if (pathname.startsWith('/coin/')) {
        targetFile = '/coin.html';
      } else if (pathname.startsWith('/exchange/')) {
        targetFile = '/exchange.html';
      }

      let filePath = path.join(resolvedPublicDir, targetFile);

      if (!filePath.startsWith(resolvedPublicDir)) {
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
        statusCode = 404;
        try {
          const notFoundPath = path.join(resolvedPublicDir, '404.html');
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
          const purpose = String(req.headers['x-purpose'] || '').toLowerCase();
          const secPurpose = String(req.headers['sec-purpose'] || '').toLowerCase();
          const userAgent = String(req.headers['user-agent'] || '');
          const countView = purpose !== 'prefetch' && !secPurpose.includes('prefetch') &&
            !/bot|crawl|spider|slurp|preview/i.test(userAgent);
          const universe = countView ? getUniverse({ cache }).catch(() => null) : null;
          content = await decorateCoinPage(content.toString('utf8'), coinPageId, { cache, publicUrl });
          if ((await universe)?.byId.has(coinPageId)) popular?.hit(coinPageId);
        } else if (exchangePageId && /^[a-z0-9_-]{1,60}$/.test(exchangePageId)) {
          content = await decorateExchangePage(content.toString('utf8'), exchangePageId, { cache, publicUrl });
        }
      }

      send(req, res, 200, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'ETag': etag
      }, content);
    } catch (err) {
      console.error(`Unhandled request error id=${id}`, err);
      statusCode = 500;
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    } finally {
      if (pathname !== '/api/stream' && logLevel !== 'silent') {
        const ms = Date.now() - startMs;
        if (logFormat === 'json') {
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'info',
            msg: 'request',
            id,
            method: req.method,
            path: pathname,
            query,
            status: statusCode,
            ms,
            cache: cacheStatus,
            ip: clientIp(req, trustProxy),
            ua: req.headers['user-agent'] || ''
          }));
        } else {
          console.log(`${req.method} ${req.url} ${statusCode} ${ms}ms ${cacheStatus} id=${id}`);
        }
      }
    }
  };

  return { server: http.createServer(handler), handler };
}
