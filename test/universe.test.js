import test from 'node:test';
import assert from 'node:assert';
import { convertRow, marketsFromUniverse, similarFromUniverse, searchUniverse } from '../server/universe.js';

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

test('universe: marketsFromUniverse sorts supported orders with nulls last', () => {
  const rows = [
    { id: 'charlie', market_cap: 30, total_volume: null, price_change_percentage_24h: 1 },
    { id: 'alpha', market_cap: null, total_volume: 20, price_change_percentage_24h: -2 },
    { id: 'bravo', market_cap: 10, total_volume: 40, price_change_percentage_24h: null }
  ];
  const universe = { rows, byId: new Map(rows.map(r => [r.id, r])) };
  const sorted = (order) => marketsFromUniverse({ universe, ratio: 1, page: 1, perPage: 3, order }).map(r => r.id);

  assert.deepStrictEqual(sorted('market_cap_desc'), ['charlie', 'bravo', 'alpha']);
  assert.deepStrictEqual(sorted('market_cap_asc'), ['bravo', 'charlie', 'alpha']);
  assert.deepStrictEqual(sorted('volume_desc'), ['bravo', 'alpha', 'charlie']);
  assert.deepStrictEqual(sorted('volume_asc'), ['alpha', 'bravo', 'charlie']);
  assert.deepStrictEqual(sorted('price_change_percentage_24h_desc'), ['charlie', 'alpha', 'bravo']);
  assert.deepStrictEqual(sorted('price_change_percentage_24h_asc'), ['alpha', 'charlie', 'bravo']);
  assert.deepStrictEqual(sorted('id_asc'), ['alpha', 'bravo', 'charlie']);
  assert.deepStrictEqual(sorted('id_desc'), ['charlie', 'bravo', 'alpha']);
  assert.deepStrictEqual(universe.rows.map(r => r.id), ['charlie', 'alpha', 'bravo'], 'original rows are unmodified');
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

test('universe: searchUniverse ranks exact symbol, then prefix, then substring', () => {
  const rows = [
    { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', image: 'i1', market_cap_rank: 1 },
    { id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'bch', image: 'i2', market_cap_rank: 20 },
    { id: 'wrapped-bitcoin', name: 'Wrapped Bitcoin', symbol: 'wbtc', image: 'i3', market_cap_rank: 15 },
    { id: 'ethereum', name: 'Ethereum', symbol: 'eth', image: 'i4', market_cap_rank: 2 }
  ];
  const universe = { rows, byId: new Map(rows.map(r => [r.id, r])) };
  assert.deepStrictEqual(searchUniverse(universe, 'BTC').map(r => r.id), ['bitcoin']);
  assert.deepStrictEqual(searchUniverse(universe, 'bitcoin').map(r => r.id), ['bitcoin', 'bitcoin-cash', 'wrapped-bitcoin']);
  assert.deepStrictEqual(searchUniverse(universe, 'eth')[0], { id: 'ethereum', name: 'Ethereum', symbol: 'eth', thumb: 'i4', rank: 2 });
  assert.deepStrictEqual(searchUniverse(universe, '  '), []);
  assert.strictEqual(searchUniverse(universe, 'bit', 1).length, 1);
});
