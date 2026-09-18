import test from 'node:test';
import assert from 'node:assert';
import { TtlCache } from '../server/cache.js';

const universeRows = (page) => Array.from({ length: 250 }, (_, i) => {
  const n = (page - 1) * 250 + i + 1;
  return { id: 'coin' + n, symbol: 's' + n, name: 'Coin ' + n, image: 'img' + n, current_price: n, market_cap: 1000 - n, market_cap_rank: n };
});

globalThis.fetch = async (url) => {
  if (url.includes('/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1')) {
    return new Response(JSON.stringify(universeRows(1)), { status: 200 });
  }
  if (url.includes('/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2')) {
    return new Response(JSON.stringify(universeRows(2)), { status: 200 });
  }
  if (url.includes('/simple/price')) {
    return new Response(JSON.stringify({ bitcoin: { usd: 100, eur: 50, gbp: 40, rub: 5000, jpy: 15000, cny: 700, btc: 1, eth: 30 } }), { status: 200 });
  }
  if (url.includes('/exchanges/binance/volume_chart')) {
    return new Response(JSON.stringify([[1, "12.5"], [2, "13"]]), { status: 200 });
  }
  if (url.includes('/exchanges/binance')) {
    return new Response(JSON.stringify({
      name: 'Binance', year_established: 2017, country: 'X', trust_score: 10, trade_volume_24h_btc: 1000,
      tickers: [{ base: 'BTC', target: 'USDT', coin_id: 'bitcoin', converted_last: { usd: 1 }, converted_volume: { usd: 2 }, trust_score: 'green', bid_ask_spread_percentage: 0.1, trade_url: 'u' }]
    }), { status: 200 });
  }
  if (url.includes('/search?query=coin%2012')) {
    return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: { 'Retry-After': '30' } });
  }
  if (url.includes('/search?query=seven')) {
    return new Response(JSON.stringify({
      coins: [
        { id: 'coin7', name: 'Coin 7', symbol: 's7', thumb: 't7', market_cap_rank: 7 },
        { id: 'unknown-coin', name: 'Unknown', symbol: 'unk', thumb: 't', market_cap_rank: null }
      ],
      categories: [],
      exchanges: []
    }), { status: 200 });
  }
  if (url.includes('/search?query=')) {
    return new Response(JSON.stringify({ coins: [], categories: [], exchanges: [] }), { status: 200 });
  }
  if (url.includes('/fng/')) {
    return new Response(JSON.stringify({
      data: [{ value: "45", value_classification: "Fear", timestamp: "1600000000" }]
    }), { status: 200 });
  }
  return new Response(JSON.stringify({ stub: true }), { status: 200 });
};

const { handleApi } = await import('../server/routes.js');

test('routes: handleApi /api/currencies', async () => {
  const req = { method: 'GET' };
  const url = new URL('http://localhost/api/currencies');
  const cache = new TtlCache();
  
  const res = await handleApi(req, {}, url, { cache });
  
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.cache, 'hit');
  assert.ok(res.body.includes('US Dollar'));
});

test('routes: handleApi 400 on /api/markets?per_page=999', async () => {
  const req = { method: 'GET' };
  const url = new URL('http://localhost/api/markets?per_page=999');
  const cache = new TtlCache();
  
  try {
    await handleApi(req, {}, url, { cache });
    assert.fail('Should throw');
  } catch (err) {
    assert.strictEqual(err.status, 400);
  }
});

test('routes: handleApi /api/fng mapping', async () => {
  const req = { method: 'GET' };
  const url = new URL('http://localhost/api/fng');
  const cache = new TtlCache();
  
  const res = await handleApi(req, {}, url, { cache });
  assert.strictEqual(res.status, 200);
  
  const body = JSON.parse(res.body);
  assert.strictEqual(body.value, 45);
  assert.strictEqual(body.classification, 'Fear');
  assert.strictEqual(body.timestamp, 1600000000000);
});

test('routes: /api/coin/:id/similar is served from the universe in the requested currency', async () => {
  const cache = new TtlCache();
  const res = await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/coin/coin10/similar?vs=eur'), { cache });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['X-Cache'], 'universe');
  const rows = JSON.parse(res.body);
  assert.strictEqual(rows.length, 8);
  assert.ok(!rows.some(r => r.id === 'coin10'));
  assert.strictEqual(rows[0].current_price, rows[0].market_cap_rank * 0.5); // eur ratio = 50 / 100

  const none = await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/coin/unknown/similar'), { cache });
  assert.deepStrictEqual(JSON.parse(none.body), []);
});

test('routes: /api/exchange/:id shapes the payload and validates ids', async () => {
  const cache = new TtlCache();
  const res = await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/exchange/binance'), { cache });
  const body = JSON.parse(res.body);
  assert.strictEqual(body.name, 'Binance');
  assert.strictEqual(body.tickers[0].last_usd, 1);
  assert.strictEqual(body.tickers[0].trust_score, 'green');

  const vol = await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/exchange/binance/volume?days=7'), { cache });
  assert.deepStrictEqual(JSON.parse(vol.body), [[1, 12.5], [2, 13]]);

  await assert.rejects(handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/exchange/Bad%20Id'), { cache }), (e) => e.status === 400);
  await assert.rejects(handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/exchange/binance/volume?days=3'), { cache }), (e) => e.status === 400);
});

test('routes: /api/search enriches upstream coins from the universe', async () => {
  const cache = new TtlCache();
  await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/coin/coin1/similar'), { cache });
  const res = await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/search?q=seven'), { cache });
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.coins[0].price_usd, 7);
  assert.ok(Object.hasOwn(body.coins[0], 'change24h'));
  assert.strictEqual(body.coins[0].market_cap_usd, 993);
  assert.strictEqual(body.coins[1].price_usd, null);
});

test('routes: pagination parameters are validated strictly', async () => {
  const cache = new TtlCache();
  for (const q of ['page=-1', 'page=abc', 'per_page=0', 'per_page=12abc', 'page=0']) {
    await assert.rejects(handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/markets?' + q), { cache }), (e) => e.status === 400);
  }
  const ok = await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/markets?page=2&per_page=2'), { cache });
  assert.deepStrictEqual(JSON.parse(ok.body).map(r => r.id), ['coin3', 'coin4']);
});

test('routes: /api/search falls back to the universe when upstream is rate limited', async () => {
  const cache = new TtlCache();
  // Warm the universe first (as the server does at boot); the 429 then only affects /search.
  await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/coin/coin1/similar'), { cache });
  const res = await handleApi({ method: 'GET' }, {}, new URL('http://localhost/api/search?q=coin%2012'), { cache });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['X-Cache'], 'fallback');
  const body = JSON.parse(res.body);
  assert.strictEqual(body.partial, true);
  assert.strictEqual(body.coins[0].id, 'coin12');
  assert.strictEqual(body.coins[0].price_usd, 12);
});
