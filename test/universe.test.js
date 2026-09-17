import test from 'node:test';
import assert from 'node:assert';
import { convertRow, marketsFromUniverse, similarFromUniverse } from '../server/universe.js';

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

test('universe: similarFromUniverse picks rank neighbours and excludes the coin', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: 'c' + i, market_cap_rank: i + 1, current_price: i + 1 }));
  const universe = { rows, byId: new Map(rows.map(r => [r.id, r])) };

  const mid = similarFromUniverse({ universe, ratio: 1, id: 'c10', limit: 4 });
  assert.deepStrictEqual(mid.map(r => r.id), ['c8', 'c9', 'c11', 'c12']);

  const top = similarFromUniverse({ universe, ratio: 1, id: 'c0', limit: 4 });
  assert.deepStrictEqual(top.map(r => r.id), ['c1', 'c2', 'c3', 'c4']);

  const bottom = similarFromUniverse({ universe, ratio: 2, id: 'c19', limit: 4 });
  assert.deepStrictEqual(bottom.map(r => r.id), ['c15', 'c16', 'c17', 'c18']);
  assert.strictEqual(bottom[0].current_price, 32);

  assert.deepStrictEqual(similarFromUniverse({ universe, ratio: 1, id: 'nope', limit: 4 }), []);
});
