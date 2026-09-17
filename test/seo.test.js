import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorateCoinPage } from '../server/seo.js';

const html = '<html><head><title>Coin · Cryptolive</title><meta name="description" content="x"></head><body></body></html>';

function fakeCache(rows) {
  return { get: async () => ({ value: rows, status: 'hit' }) };
}

test('seo: known coin gets title, description and og tags', async () => {
  const rows = [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', current_price: 65000.5, price_change_percentage_24h: -1.234, market_cap: 1.2e12, market_cap_rank: 1, image: 'https://img/btc.png' }];
  const out = await decorateCoinPage(html, 'bitcoin', { cache: fakeCache(rows), publicUrl: 'https://example.com/' });
  assert.match(out, /<title>Bitcoin \(BTC\) price today — \$65,000.50 · Cryptolive<\/title>/);
  assert.match(out, /<meta name="description" content="Live Bitcoin price \$65,000.50, 24h change -1.23%, market cap \$1,200,000,000,000.00, rank #1, charts/);
  assert.match(out, /<link rel="canonical" href="https:\/\/example.com\/coin\/bitcoin">/);
  assert.match(out, /<meta property="og:image" content="https:\/\/img\/btc.png">/);
});

test('seo: unknown coin keeps the template and only adds canonical', async () => {
  const out = await decorateCoinPage(html, 'nope', { cache: fakeCache([]), publicUrl: 'http://localhost:8080' });
  assert.match(out, /<title>Coin · Cryptolive<\/title>/);
  assert.match(out, /canonical" href="http:\/\/localhost:8080\/coin\/nope"/);
  assert.doesNotMatch(out, /og:title/);
});

test('seo: escapes html in names and never throws on upstream failure', async () => {
  const rows = [{ id: 'evil', name: 'A<b>"c', symbol: 'ev', current_price: 0.001234 }];
  const out = await decorateCoinPage(html, 'evil', { cache: fakeCache(rows), publicUrl: 'http://x' });
  assert.match(out, /<title>A&lt;b&gt;&quot;c \(EV\) price today — \$0.001234/);
  const failing = { get: async () => { throw new Error('429'); } };
  const out2 = await decorateCoinPage(html, 'bitcoin', { cache: failing, publicUrl: 'http://x' });
  assert.match(out2, /<title>Coin · Cryptolive<\/title>/);
});
