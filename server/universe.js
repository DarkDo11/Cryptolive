import { fetchUpstream, COINGECKO_BASE, cacheKey } from './upstream.js';

export const VS_CURRENCIES = ['usd', 'eur', 'gbp', 'rub', 'jpy', 'cny', 'btc', 'eth'];

export async function getUniverse(ctx) {
  const url1 = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;
  const url2 = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=2&sparkline=true&price_change_percentage=1h,24h,7d`;

  let page1, page2;
  try {
    const res = await ctx.cache.get(cacheKey(url1), 60_000, () => fetchUpstream(url1));
    page1 = res.value;
  } catch (err) {
    throw err;
  }

  try {
    const res = await ctx.cache.get(cacheKey(url2), 60_000, () => fetchUpstream(url2));
    page2 = res.value;
  } catch (err) {
    page2 = [];
  }

  const rows = page1.concat(page2);
  const byId = new Map();
  for (const row of rows) {
    byId.set(row.id, row);
  }

  return { rows, byId };
}

export async function getFx(ctx) {
  const url = `${COINGECKO_BASE}/simple/price?ids=bitcoin&vs_currencies=usd,eur,gbp,rub,jpy,cny,btc,eth`;
  const res = await ctx.cache.get(cacheKey(url), 300_000, () => fetchUpstream(url));
  const bitcoin = res.value.bitcoin;
  const ratio = {};
  for (const c of VS_CURRENCIES) {
    ratio[c] = bitcoin[c] / bitcoin.usd;
  }
  return ratio;
}

export function convertRow(row, ratio) {
  if (ratio === 1) return row;
  const copy = { ...row };
  const fields = [
    'current_price', 'market_cap', 'fully_diluted_valuation', 'total_volume',
    'high_24h', 'low_24h', 'price_change_24h', 'market_cap_change_24h', 'ath', 'atl'
  ];
  for (const field of fields) {
    if (typeof copy[field] === 'number' && Number.isFinite(copy[field])) {
      copy[field] = copy[field] * ratio;
    }
  }
  if (copy.sparkline_in_7d && Array.isArray(copy.sparkline_in_7d.price)) {
    copy.sparkline_in_7d = {
      ...copy.sparkline_in_7d,
      price: copy.sparkline_in_7d.price.map(p => (typeof p === 'number' && Number.isFinite(p) ? p * ratio : p))
    };
  }
  return copy;
}

export function marketsFromUniverse({ universe, ratio, ids, page, perPage }) {
  if (ids) {
    const rows = ids.map(id => universe.byId.get(id)).filter(Boolean);
    if (rows.length !== ids.length) return null;
    return rows.map(r => convertRow(r, ratio));
  } else {
    const start = (page - 1) * perPage;
    const end = page * perPage;
    if (end > universe.rows.length) {
      if (universe.rows.length >= 500) return null;
      if (start >= universe.rows.length) return null;
    }
    return universe.rows.slice(start, end).map(r => convertRow(r, ratio));
  }
}

/**
 * Coins ranked closest to `id` by market cap (half above, half below), excluding the coin itself.
 * Returns [] when the coin is outside the universe.
 */
export function similarFromUniverse({ universe, ratio, id, limit = 8 }) {
  const rows = universe.rows;
  const idx = rows.findIndex(r => r.id === id);
  if (idx < 0) return [];
  const half = Math.ceil(limit / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(rows.length, start + limit + 1);
  start = Math.max(0, end - limit - 1);
  return rows.slice(start, end).filter(r => r.id !== id).slice(0, limit).map(r => convertRow(r, ratio));
}

/**
 * Case-insensitive search over the universe: exact symbol → prefix matches → substring matches,
 * each group ordered by market cap rank. Returns `/search`-shaped coin rows (max `limit`).
 */
export function searchUniverse(universe, query, limit = 20) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const score = (r) => {
    const name = String(r.name || '').toLowerCase();
    const sym = String(r.symbol || '').toLowerCase();
    if (sym === q || name === q) return 0;
    if (sym.startsWith(q) || name.startsWith(q)) return 1;
    if (name.includes(q) || String(r.id || '').includes(q)) return 2;
    return -1;
  };
  return universe.rows
    .map(r => ({ r, s: score(r) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => a.s - b.s || (a.r.market_cap_rank ?? 1e9) - (b.r.market_cap_rank ?? 1e9))
    .slice(0, limit)
    .map(({ r }) => ({ id: r.id, name: r.name, symbol: r.symbol, thumb: r.image, rank: r.market_cap_rank ?? null }));
}

/**
 * Build a partial `/coins/{id}`-shaped payload from a universe row so the coin page can still render
 * (header, stats, performance) while CoinGecko is throttled. Marked with `partial: true`.
 */
export function coinFromUniverse(row, fx) {
  const perCurrency = (usdValue) => {
    const out = {};
    if (typeof usdValue !== 'number' || !Number.isFinite(usdValue)) return out;
    for (const c of VS_CURRENCIES) if (Number.isFinite(fx[c])) out[c] = usdValue * fx[c];
    return out;
  };
  const sameForAll = (value) => {
    const out = {};
    for (const c of VS_CURRENCIES) out[c] = value ?? null;
    return out;
  };
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    partial: true,
    market_cap_rank: row.market_cap_rank ?? null,
    image: { thumb: row.image, small: row.image, large: row.image },
    categories: [],
    description: { en: '' },
    links: {},
    market_data: {
      current_price: perCurrency(row.current_price),
      market_cap: perCurrency(row.market_cap),
      fully_diluted_valuation: perCurrency(row.fully_diluted_valuation),
      total_volume: perCurrency(row.total_volume),
      high_24h: perCurrency(row.high_24h),
      low_24h: perCurrency(row.low_24h),
      ath: perCurrency(row.ath),
      atl: perCurrency(row.atl),
      ath_change_percentage: sameForAll(row.ath_change_percentage),
      atl_change_percentage: sameForAll(row.atl_change_percentage),
      ath_date: sameForAll(row.ath_date),
      atl_date: sameForAll(row.atl_date),
      price_change_percentage_24h: row.price_change_percentage_24h ?? null,
      price_change_percentage_7d: row.price_change_percentage_7d_in_currency ?? null,
      price_change_percentage_1h_in_currency: sameForAll(row.price_change_percentage_1h_in_currency),
      market_cap_change_percentage_24h: row.market_cap_change_percentage_24h ?? null,
      circulating_supply: row.circulating_supply ?? null,
      total_supply: row.total_supply ?? null,
      max_supply: row.max_supply ?? null,
      sparkline_7d: row.sparkline_in_7d || { price: [] }
    }
  };
}
