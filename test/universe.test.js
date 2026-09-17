import test from 'node:test';
import assert from 'node:assert';
import { convertRow, marketsFromUniverse } from '../server/universe.js';

test('universe: convertRow', () => {
  const row = {
    id: 'bitcoin',
    current_price: 1000,
    market_cap: 2000,
    price_change_percentage_24h: 5.5,
    sparkline_in_7d: { price: [100, 200, null] }
  };
  
  const converted = convertRow(row, 2);
  
  assert.strictEqual(converted.current_price, 2000);
  assert.strictEqual(converted.market_cap, 4000);
  assert.strictEqual(converted.price_change_percentage_24h, 5.5, 'percentage untouched');
  assert.deepStrictEqual(converted.sparkline_in_7d.price, [200, 400, null]);
  
  // Original is unmodified
  assert.strictEqual(row.current_price, 1000);
});

test('universe: marketsFromUniverse pagination and ids', () => {
  const rows = [
    { id: 'btc', current_price: 10 },
    { id: 'eth', current_price: 5 },
    { id: 'doge', current_price: 1 }
  ];
  const byId = new Map(rows.map(r => [r.id, r]));
  const universe = { rows, byId };

  // ids
  const resIds = marketsFromUniverse({ universe, ratio: 1, ids: ['btc', 'doge'] });
  assert.strictEqual(resIds.length, 2);
  assert.strictEqual(resIds[0].id, 'btc');
  assert.strictEqual(resIds[1].id, 'doge');
  
  // missing id -> null
  const resMissing = marketsFromUniverse({ universe, ratio: 1, ids: ['btc', 'nope'] });
  assert.strictEqual(resMissing, null);

  // pagination
  const p1 = marketsFromUniverse({ universe, ratio: 2, page: 1, perPage: 2 });
  assert.strictEqual(p1.length, 2);
  assert.strictEqual(p1[0].current_price, 20); // ratio applied
  
  const p2 = marketsFromUniverse({ universe, ratio: 1, page: 2, perPage: 2 });
  assert.strictEqual(p2.length, 1);
  assert.strictEqual(p2[0].id, 'doge');

  const p3 = marketsFromUniverse({ universe, ratio: 1, page: 3, perPage: 2 });
  assert.strictEqual(p3, null); // start >= length
});
