import test from 'node:test';
import assert from 'node:assert';
import { createRateLimiter } from '../server/ratelimit.js';

test('ratelimit: basic limits and window expiration', async () => {
  const rl = createRateLimiter({ windowMs: 50, max: 2 });
  
  const ip = '1.2.3.4';
  const c1 = rl.check(ip);
  assert.strictEqual(c1.ok, true);
  assert.strictEqual(c1.remaining, 1);
  
  const c2 = rl.check(ip);
  assert.strictEqual(c2.ok, true);
  assert.strictEqual(c2.remaining, 0);
  
  const c3 = rl.check(ip);
  assert.strictEqual(c3.ok, false);
  assert.strictEqual(c3.remaining, 0);
  
  // Wait for window to clear
  await new Promise(r => setTimeout(r, 60));
  
  const c4 = rl.check(ip);
  assert.strictEqual(c4.ok, true);
  assert.strictEqual(c4.remaining, 1);
});
