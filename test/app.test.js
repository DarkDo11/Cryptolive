import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { TtlCache } from '../server/cache.js';

const rows = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://img/btc.png', current_price: 100, market_cap: 1000, market_cap_rank: 1, price_change_percentage_24h: 1.5 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: 'https://img/eth.png', current_price: 50, market_cap: 500, market_cap_rank: 2, price_change_percentage_24h: 2.5 },
  { id: 'solana', symbol: 'sol', name: 'Solana', image: 'https://img/sol.png', current_price: 25, market_cap: 250, market_cap_rank: 3, price_change_percentage_24h: 3.5 }
];

globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes('/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1')) {
    return new Response(JSON.stringify(rows), { status: 200 });
  }
  if (target.includes('/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2')) {
    return new Response(JSON.stringify([]), { status: 200 });
  }
  if (target.includes('/simple/price?ids=bitcoin')) {
    return new Response(JSON.stringify({
      bitcoin: {
        usd: 100, eur: 90, gbp: 80, rub: 9000, jpy: 15000, cny: 700,
        cad: 130, aud: 150, chf: 90, krw: 130000, inr: 8300, brl: 500,
        try: 3300, uah: 4100, pln: 400, kzt: 48000, btc: 1, eth: 30
      }
    }), { status: 200 });
  }
  if (target.includes('/global')) {
    return new Response(JSON.stringify({ data: { active_cryptocurrencies: 1 } }), { status: 200 });
  }
  return new Response(JSON.stringify({ stub: true }), { status: 200 });
};

const { createApp } = await import('../server/app.js');

const live = {
  subscribe() {},
  unsubscribe() {},
  status() {
    return { connected: false, subscribers: 0, symbols: 0, pricesKnown: 0, lastMessageAt: null, reconnects: 0 };
  }
};

function request(server, requestPath, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

let server;

before(async () => {
  const app = await createApp({
    cache: new TtlCache(),
    live,
    publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
    options: { logLevel: 'silent', publicUrl: 'https://example.test', apiRateLimit: 5 }
  });
  server = app.server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
});

after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

test('serves the home page with security headers', async () => {
  const res = await request(server, '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.body, /<title>/);
  assert.match(res.body, /<div id="marketsTable" data-ssr="1">[\s\S]*\/coin\/bitcoin/);
  assert.match(res.body, /<link rel="canonical" href="https:\/\/example\.test\/">/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('adds a request id to every response', async () => {
  for (const requestPath of ['/', '/healthz', '/api/currencies', '/nope']) {
    const res = await request(server, requestPath);
    assert.equal(typeof res.headers['x-request-id'], 'string');
    assert.ok(res.headers['x-request-id']);
  }
});

test('echoes a valid request id', async () => {
  const res = await request(server, '/', { 'X-Request-Id': 'my-trace-123' });
  assert.equal(res.headers['x-request-id'], 'my-trace-123');
});

test('replaces an invalid request id with a UUID', async () => {
  const res = await request(server, '/', { 'X-Request-Id': 'bad id!!' });
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});

test('supports clean URLs and the 404 page', async () => {
  const page = await request(server, '/watchlist');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);

  const missing = await request(server, '/nope');
  assert.equal(missing.status, 404);
  assert.match(missing.body, /404 — Page not found/);
});

test('decorates known coin pages and canonicals for unknown coins', async () => {
  const known = await request(server, '/coin/bitcoin');
  assert.equal(known.status, 200);
  assert.match(known.body, /<title>Bitcoin \(BTC\) price today/);
  assert.match(known.body, /property="og:title"/);

  const unknown = await request(server, '/coin/unknown-zzz');
  assert.equal(unknown.status, 200);
  assert.match(unknown.body, /<title>Coin · Cryptolive<\/title>/);
  assert.match(unknown.body, /<link rel="canonical" href="https:\/\/example\.test\/coin\/unknown-zzz">/);
});

test('reports health and component status', async () => {
  const res = await request(server, '/healthz');
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, 'string');
  assert.equal(typeof body.cache.entries, 'number');
  assert.equal(typeof body.upstream.throttled, 'boolean');
  assert.equal(body.live.connected, false);
});

test('serves Prometheus metrics', async () => {
  const res = await request(server, '/metrics');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/plain/);
  assert.match(res.body, /cryptolive_uptime_seconds/);
  assert.match(res.body, /cryptolive_http_requests_total\{status="2xx"\}/);
});

test('protects Prometheus metrics with an optional token', async (t) => {
  const app = await createApp({
    cache: new TtlCache(),
    live,
    publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
    options: { logLevel: 'silent', metricsToken: 'secret' }
  });
  const tokenServer = app.server;
  await new Promise((resolve, reject) => {
    tokenServer.once('error', reject);
    tokenServer.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => tokenServer.close(resolve)));

  const unauthorized = await request(tokenServer, '/metrics');
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers['www-authenticate'], 'Bearer');

  const authorized = await request(tokenServer, '/metrics', { Authorization: 'Bearer secret' });
  assert.equal(authorized.status, 200);
});

test('returns API ETags and handles conditional requests', async () => {
  const first = await request(server, '/api/currencies');
  assert.equal(first.status, 200);
  assert.ok(JSON.parse(first.body).some(currency => currency.code === 'usd'));
  assert.ok(first.headers.etag);

  const second = await request(server, '/api/currencies', { 'If-None-Match': first.headers.etag });
  assert.equal(second.status, 304);
});

test('serves converted markets from the universe', async () => {
  const res = await request(server, '/api/markets?vs=eur&per_page=2');
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-cache'], 'universe');
  const body = JSON.parse(res.body);
  assert.equal(body.length, 2);
  assert.equal(body[0].current_price, 90);
});

test('returns JSON validation errors', async () => {
  const res = await request(server, '/api/markets?per_page=999');
  assert.equal(res.status, 400);
  assert.equal(typeof JSON.parse(res.body).error, 'string');
});

test('builds the sitemap with static and coin URLs', async () => {
  const res = await request(server, '/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.body, /https:\/\/example\.test\/coin\/bitcoin/);
  assert.match(res.body, /<loc>https:\/\/example\.test\/watchlist<\/loc>/);
});

test('rate limits repeated API requests by IP', async () => {
  let limited;
  for (let i = 0; i < 10; i++) {
    const res = await request(server, '/api/currencies');
    if (res.status === 429) {
      limited = res;
      break;
    }
  }
  assert.ok(limited, 'expected a 429 response within 10 requests');
  assert.ok(limited.headers['retry-after']);
});

test('rejects unsupported methods', async () => {
  const res = await request(server, '/', {}, 'POST');
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'GET, HEAD');
});

test('serves static assets with caching and conditional requests', async () => {
  const first = await request(server, '/css/style.css');
  assert.equal(first.status, 200);
  assert.match(first.headers['cache-control'], /max-age/);
  assert.ok(first.headers.etag);

  const second = await request(server, '/css/style.css', { 'If-None-Match': first.headers.etag });
  assert.equal(second.status, 304);
});

test('does not expose files through path traversal', async () => {
  for (const requestPath of ['/../package.json', '/%2e%2e/package.json']) {
    const res = await request(server, requestPath);
    assert.ok(res.status === 403 || res.status === 404);
    assert.doesNotMatch(res.body, /"name"\s*:\s*"cryptolive"/);
  }
});

test('serves robots.txt with the sitemap location', async () => {
  const res = await request(server, '/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.body, /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
  assert.match(res.body, /Disallow: \/api\//);
});
