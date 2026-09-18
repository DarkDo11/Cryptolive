import test from 'node:test';
import assert from 'node:assert';
import { createPopular } from '../server/popular.js';

test('popular: hits accumulate and decay by half after one half-life', () => {
  const popular = createPopular({ halfLifeMs: 1000 });
  popular.hit('bitcoin', 0);
  popular.hit('bitcoin', 0);

  assert.deepStrictEqual(popular.top(10, 0), [{ id: 'bitcoin', score: 2, views: 2 }]);
  assert.deepStrictEqual(popular.top(10, 1000), [{ id: 'bitcoin', score: 1, views: 2 }]);
});

test('popular: top orders by decayed score and excludes scores below cutoff', () => {
  const popular = createPopular({ halfLifeMs: 1000 });
  popular.hit('older', 0);
  popular.hit('newer', 1000);

  assert.deepStrictEqual(popular.top(10, 1000).map(entry => entry.id), ['newer', 'older']);
  assert.deepStrictEqual(popular.top(10, 7000).map(entry => entry.id), ['newer']);
});

test('popular: evicts the lowest decayed score at maxEntries', () => {
  const popular = createPopular({ halfLifeMs: 1000, maxEntries: 2 });
  popular.hit('old', 0);
  popular.hit('strong', 1000);
  popular.hit('strong', 1000);
  popular.hit('new', 2000);

  assert.deepStrictEqual(popular.top(10, 2000).map(entry => entry.id), ['strong', 'new']);
});

test('popular: views use a rolling seven-day window while score keeps decaying', () => {
  const day = 24 * 3600 * 1000;
  const popular = createPopular({ halfLifeMs: 14 * day });
  popular.hit('bitcoin', 0);
  popular.hit('bitcoin', 6 * day);

  assert.deepStrictEqual(popular.top(10, 6 * day), [{
    id: 'bitcoin',
    score: 0.5 ** (6 / 14) + 1,
    views: 2
  }]);
  assert.deepStrictEqual(popular.top(10, 7 * day + 1), [{
    id: 'bitcoin',
    score: (0.5 ** (6 / 14) + 1) * 0.5 ** ((day + 1) / (14 * day)),
    views: 1
  }]);
});

test('popular: snapshot and restore round-trip valid entries and ignore junk', () => {
  const source = createPopular();
  source.hit('bitcoin', 100);
  source.hit('bitcoin', 200);

  const restored = createPopular();
  const snapshot = source.snapshot();
  snapshot.entries.push(
    ['bad-score', { score: 'one', updatedAt: 1, views: 1 }],
    ['bad-views', { score: 1, updatedAt: 1, views: -1 }],
    ['bad-buckets', { score: 1, updatedAt: 1, buckets: [[1, -1]] }],
    ['missing'],
    'junk'
  );

  assert.strictEqual(restored.restore(snapshot), 1);
  assert.deepStrictEqual(restored.snapshot(), source.snapshot());
  assert.strictEqual(restored.restore(null), 0);
  assert.strictEqual(restored.restore({ entries: 'junk' }), 0);
});

test('popular: restores legacy views as a bucket at updatedAt', () => {
  const popular = createPopular();
  assert.strictEqual(popular.restore({ entries: [
    ['bitcoin', { score: 2, updatedAt: 1234, views: 3 }]
  ] }), 1);
  assert.deepStrictEqual(popular.snapshot(), { entries: [
    ['bitcoin', { score: 2, updatedAt: 1234, buckets: [[1234, 3]] }]
  ] });
});
