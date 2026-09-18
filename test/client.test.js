import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  }
};
globalThis.window = globalThis;
globalThis.window.dispatchEvent = () => true;
globalThis.window.addEventListener = () => {};
globalThis.Event = class Event {
  constructor(type) {
    this.type = type;
  }
};
globalThis.CustomEvent = class CustomEvent extends Event {
  constructor(type, { detail } = {}) {
    super(type);
    this.detail = detail;
  }
};
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'en-US' },
  configurable: true
});
globalThis.document = {
  documentElement: { lang: 'en' },
  querySelectorAll: () => []
};

const moduleUrl = (relativePath) => pathToFileURL(path.resolve(relativePath)).href;
const store = await import(moduleUrl('public/js/store.js'));
const i18n = await import(moduleUrl('public/js/i18n.js'));
const format = await import(moduleUrl('public/js/format.js'));

test('format utilities', () => {
  const usd = format.fmtCurrency(76000.5, 'usd');
  assert.ok(usd.startsWith('$'));
  assert.ok(usd.includes('76,000.5'));
  assert.doesNotMatch(format.fmtCurrency(105704650.58, 'krw'), /\.\d/);
  assert.doesNotMatch(format.fmtCurrency(105704650.58, 'jpy'), /\.\d/);
  assert.ok(format.fmtCurrency(0.00012345, 'usd').includes('0.000123'));
  assert.match(format.fmtCurrency(1.5e9, 'usd', { compact: true }), /1\.50?B/);
  assert.ok(format.fmtCurrency(0.5, 'btc').startsWith('₿'));
  assert.equal(format.fmtCurrency(null), '—');
  assert.equal(format.fmtPercent(1.234), '+1.23%');
  assert.equal(format.fmtPercent(-0.5), '-0.50%');
  assert.equal(format.fmtNumber(1234.5678, { max: 2 }), '1,234.57');
  assert.equal(format.escapeHtml('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('translations and locale selection', () => {
  localStorage.clear();
  assert.equal(i18n.t('nav.markets'), 'Markets');

  store.settings.set({ lang: 'ru' });
  assert.equal(i18n.t('nav.markets'), 'Рынки');
  assert.equal(i18n.dateLocale(), 'ru-RU');
  assert.ok(i18n.t('common.updated', { time: 'X' }).includes('X'));
  assert.equal(i18n.t('unknown.key'), 'unknown.key');
  assert.equal(i18n.fngLabel('Extreme Fear'), 'Крайний страх');
  assert.equal(i18n.fngLabel('Weird'), 'Weird');

  store.settings.set({ lang: 'en' });
});

test('browser stores', () => {
  localStorage.clear();

  store.watchlist.add('bitcoin');
  store.watchlist.add('bitcoin');
  assert.deepEqual(store.watchlist.list(), ['bitcoin']);
  store.watchlist.toggle('bitcoin');
  assert.deepEqual(store.watchlist.list(), []);

  for (let i = 1; i <= 9; i += 1) store.recentCoins.push(`coin-${i}`);
  store.recentCoins.push('coin-5');
  assert.deepEqual(store.recentCoins.list(), [
    'coin-5', 'coin-9', 'coin-8', 'coin-7',
    'coin-6', 'coin-4', 'coin-3', 'coin-2'
  ]);

  const bitcoin = { coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' };
  store.portfolio.add({ ...bitcoin, type: 'buy', amount: 1, price: 60000, date: 1 });
  store.portfolio.add({ ...bitcoin, type: 'buy', amount: 1, price: 70000, date: 2 });
  store.portfolio.add({ ...bitcoin, type: 'sell', amount: 0.5, price: 80000, date: 3 });

  const transactions = store.portfolio.list();
  assert.equal(transactions.length, 3);
  assert.ok(transactions.every((tx) => typeof tx.id === 'string' && tx.id.length > 0));
  assert.deepEqual(store.portfolio.holdings(), [{
    coinId: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    image: undefined,
    amount: 1.5,
    costBasisUsd: 97500,
    avgPriceUsd: 65000,
    avgCostUsd: 65000
  }]);
  assert.equal(store.portfolio.realized().totalRealizedUsd, 0.5 * (80000 - 65000));
  assert.equal(store.portfolio.realized().byCoin.bitcoin.soldAmount, 0.5);
  assert.equal(store.portfolio.holdings()[0].avgCostUsd, 65000);

  const id = transactions[0].id;
  store.portfolio.update(id, { amount: 2 });
  assert.equal(store.portfolio.list().find((tx) => tx.id === id).amount, 2);
  store.portfolio.remove(id);
  assert.equal(store.portfolio.list().some((tx) => tx.id === id), false);
  store.portfolio.clear();
  assert.deepEqual(store.portfolio.list(), []);

  store.settings.set({ theme: 'light', currency: 'eur' });
  store.settings.set({ lang: 'ru' });
  assert.deepEqual(store.settings.get(), {
    theme: 'light',
    currency: 'eur',
    perPage: 100,
    lang: 'ru'
  });
  store.settings.set({ lang: 'en' });
});

test('portfolio cost basis follows the moving average of the current position', () => {
  localStorage.clear();
  const btc = { coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' };
  store.portfolio.add({ ...btc, type: 'buy', amount: 1, price: 60000, date: 1 });
  store.portfolio.add({ ...btc, type: 'sell', amount: 1, price: 80000, date: 2 });
  store.portfolio.add({ ...btc, type: 'buy', amount: 1, price: 50000, date: 3 });
  const [h] = store.portfolio.holdings();
  assert.equal(h.amount, 1);
  assert.equal(h.avgCostUsd, 50000);
  assert.equal(h.costBasisUsd, 50000);
  assert.equal(store.portfolio.realized().totalRealizedUsd, 20000);
  // hostile ids must not touch Object.prototype
  store.portfolio.add({ coinId: '__proto__', symbol: 'X', name: 'X', type: 'buy', amount: 1, price: 1, date: 4 });
  store.portfolio.holdings(); store.portfolio.realized();
  assert.equal(Object.prototype.avg, undefined);
  assert.equal(Object.prototype.held, undefined);
  store.portfolio.clear();
});
