import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarketsTable } from '../server/ssr.js';

const rows = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bit<b>coin', image: 'https://img/btc.png', current_price: 76437, market_cap_rank: 1, total_volume: 24.07e9, market_cap: 1.51e12, price_change_percentage_24h: 1.234 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: 'https://img/eth.png', current_price: 1923.5, market_cap_rank: 2, total_volume: 12e9, market_cap: 232e9, price_change_percentage_24h: -2.345 },
  { id: 'solana', symbol: 'sol', name: 'Solana', image: 'https://img/sol.png', current_price: 145, market_cap_rank: 3, total_volume: 4e9, market_cap: 68e9, price_change_percentage_24h: 0.5 }
];

test('renders escaped market rows with formatted values and badges', () => {
  const html = renderMarketsTable(rows);
  assert.equal((html.match(/<tr data-coin-id=/g) || []).length, 3);
  assert.match(html, /Bit&lt;b&gt;coin/);
  assert.match(html, /\$76,437\.00/);
  assert.match(html, /\$24\.07B/);
  assert.match(html, /change-badge is-up">\+1\.23%/);
  assert.match(html, /change-badge is-down">-2\.35%/);
});

test('respects the row limit', () => {
  const html = renderMarketsTable(rows, { limit: 2 });
  assert.equal((html.match(/<tr data-coin-id=/g) || []).length, 2);
  assert.doesNotMatch(html, /data-coin-id="solana"/);
});
