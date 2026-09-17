import test from 'node:test';
import assert from 'node:assert';
import { TtlCache } from '../server/cache.js';

test('TtlCache: hit and miss', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const fetcher = async () => { calls++; return 'val'; };

  const res1 = await cache.get('k1', 100, fetcher);
  assert.strictEqual(res1.value, 'val');
  assert.strictEqual(res1.status, 'miss');
  assert.strictEqual(calls, 1);

  const res2 = await cache.get('k1', 100, fetcher);
  assert.strictEqual(res2.value, 'val');
  assert.strictEqual(res2.status, 'hit');
  assert.strictEqual(calls, 1);
});

test('TtlCache: coalescing of concurrent fetchers', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise(r => setTimeout(r, 10));
    return 'concurrent';
  };

  const p1 = cache.get('k2', 100, fetcher);
  const p2 = cache.get('k2', 100, fetcher);
  const [res1, res2] = await Promise.all([p1, p2]);

  assert.strictEqual(res1.value, 'concurrent');
  assert.strictEqual(res2.value, 'concurrent');
  assert.strictEqual(calls, 1); // Only fetched once
});

test('TtlCache: stale-while-revalidate', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return 'v' + calls;
  };

  // 1st fetch
  await cache.get('k3', 60, fetcher);
  
  // wait for expiry
  await new Promise(r => setTimeout(r, 70));

  // 2nd fetch (stale)
  const res2 = await cache.get('k3', 60, fetcher);
  assert.strictEqual(res2.value, 'v1', 'Should return stale value immediately');
  assert.strictEqual(res2.status, 'stale');

  // Wait for background refresh
  await new Promise(r => setTimeout(r, 10));
  
  // 3rd fetch (hit on new value)
  const res3 = await cache.get('k3', 60, fetcher);
  assert.strictEqual(res3.value, 'v2');
  assert.strictEqual(res3.status, 'hit');
  assert.strictEqual(calls, 2);
});

test('TtlCache: stale-on-error', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    if (calls === 2) throw new Error('fail');
    return 'ok';
  };

  await cache.get('k4', 10, fetcher); // v1
  
  // wait for expiry
  await new Promise(r => setTimeout(r, 20));

  // 2nd fetch (trigger revalidate which throws)
  const res2 = await cache.get('k4', 10, fetcher);
  assert.strictEqual(res2.value, 'ok'); // stale
  
  await new Promise(r => setTimeout(r, 10));

  // 3rd fetch (should still be stale, as error was swallowed)
  const res3 = await cache.get('k4', 10, fetcher);
  assert.strictEqual(res3.value, 'ok');
});
