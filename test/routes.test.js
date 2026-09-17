import test from 'node:test';
import assert from 'node:assert';
import { TtlCache } from '../server/cache.js';

globalThis.fetch = async (url) => {
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
