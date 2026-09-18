import { COINGECKO_BASE, fetchUpstream, badRequest, cacheKey } from './upstream.js';
import { getUniverse, getFx, marketsFromUniverse, similarFromUniverse, searchUniverse, coinFromUniverse, enrichFromUniverse, VS_CURRENCIES } from './universe.js';

const FNG_BASE = process.env.UPSTREAM_FNG || 'https://api.alternative.me/fng/';

const ALLOWED_VS = new Set(VS_CURRENCIES);
const ALLOWED_DAYS_CHART = new Set(['1', '7', '30', '90', '365', 'max']);
const ALLOWED_DAYS_OHLC = new Set(['1', '7', '14', '30', '90', '180', '365']);
const COIN_ID_REGEX = /^[a-z0-9-]+$/;

export const COIN_DETAIL_TTL_MS = 300 * 1000;

export function coinDetailUrl(coinId) {
  return `${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true`;
}

// CoinGecko's trending payload formats money as strings like "$1,234,567.89"; turn them into numbers.
function parseCompactUsd(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const n = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function handleApi(req, res, url, ctx) {
  const path = url.pathname;
  let targetUrl = '';
  let ttlMs = 0;
  let transform = (data) => data;
  // Optional degraded-mode producer used when the upstream call fails and nothing is cached.
  let fallback = null;

  const getVs = () => {
    const vs = url.searchParams.get('vs') || 'usd';
    if (!ALLOWED_VS.has(vs)) badRequest('Invalid vs currency');
    return vs;
  };
  
  const intParam = (name, def, min, max) => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === '') return def;
    if (!/^\d{1,6}$/.test(raw)) badRequest(`Invalid ${name}`);
    const n = parseInt(raw, 10);
    if (n < min || n > max) badRequest(`Invalid ${name}`);
    return n;
  };

  const getPageParams = () => ({
    page: intParam('page', 1, 1, 1000),
    per_page: intParam('per_page', 100, 1, 250)
  });

  const getIds = () => {
    const ids = url.searchParams.get('ids');
    if (ids) {
      const idArr = ids.split(',');
      if (idArr.length > 100) badRequest('Too many ids');
      for (const id of idArr) {
        if (!COIN_ID_REGEX.test(id)) badRequest('Invalid coin id format');
      }
      return ids;
    }
    return '';
  };

  const getCoinId = (id) => {
    if (!id || !COIN_ID_REGEX.test(id)) badRequest('Invalid coin id');
    return id;
  };

  if (path === '/api/global') {
    targetUrl = `${COINGECKO_BASE}/global`;
    ttlMs = 120 * 1000;
  } else if (path === '/api/fng') {
    targetUrl = `${FNG_BASE}?limit=30&format=json`;
    ttlMs = 600 * 1000;
    transform = (data) => {
      if (!data.data || !data.data.length) return data;
      const latest = data.data[0];
      return {
        value: parseInt(latest.value, 10),
        classification: latest.value_classification,
        timestamp: parseInt(latest.timestamp, 10) * 1000,
        history: data.data.map(d => ({
          value: parseInt(d.value, 10),
          timestamp: parseInt(d.timestamp, 10) * 1000
        }))
      };
    };
  } else if (path === '/api/trending') {
    targetUrl = `${COINGECKO_BASE}/search/trending`;
    ttlMs = 300 * 1000;
    transform = (data) => {
      return {
        coins: (data.coins || []).map(item => {
          const coin = item.item;
          return {
            id: coin.id,
            name: coin.name,
            symbol: coin.symbol,
            thumb: coin.thumb,
            rank: coin.market_cap_rank,
            price_usd: coin.data?.price,
            change24h: coin.data?.price_change_percentage_24h?.usd,
            market_cap_usd: parseCompactUsd(coin.data?.market_cap),
            volume_usd: parseCompactUsd(coin.data?.total_volume),
            sparkline_url: coin.data?.sparkline
          };
        }),
        categories: (data.categories || []).map(c => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          coins_count: c.coins_count,
          market_cap_usd: c.data?.market_cap ?? null,
          change24h: c.data?.market_cap_change_percentage_24h?.usd ?? c.market_cap_1h_change ?? null,
          sparkline_url: c.data?.sparkline
        })),
        nfts: (data.nfts || []).map(n => ({
          id: n.id,
          name: n.name,
          symbol: n.symbol,
          thumb: n.thumb,
          floor_price: n.data?.floor_price ?? null,
          floor_native: n.floor_price_in_native_currency ?? null,
          native_symbol: n.native_currency_symbol ?? null,
          change24h: n.floor_price_24h_percentage_change ?? null,
          volume_24h: n.data?.h24_volume ?? null,
          sparkline_url: n.data?.sparkline
        }))
      };
    };
  } else if (path === '/api/markets') {
    const vs = getVs();
    const { page, per_page } = getPageParams();
    const ids = getIds();
    const category = url.searchParams.get('category');
    if (category && !/^[a-z0-9-]+$/.test(category)) badRequest('Invalid category');
    const order = url.searchParams.get('order') || 'market_cap_desc';
    if (!/^(market_cap|volume|id)_(asc|desc)$/.test(order)) badRequest('Invalid order');
    
    if (!category && order === 'market_cap_desc') {
      try {
        const [uni, fx] = await Promise.all([getUniverse(ctx), getFx(ctx)]);
        const rows = marketsFromUniverse({ universe: uni, ratio: fx[vs] ?? null, ids: ids ? ids.split(',') : null, page, perPage: per_page });
        if (rows && typeof fx[vs] === 'number' && Number.isFinite(fx[vs])) {
          return {
            status: 200,
            cache: 'universe',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'X-Cache': 'universe',
              'Cache-Control': 'public, max-age=60'
            },
            body: JSON.stringify(rows)
          };
        }
      } catch (err) {
        // Fall through to existing upstream logic
      }
    }

    const params = new URLSearchParams({
      vs_currency: vs,
      order,
      per_page,
      page,
      sparkline: 'true',
      price_change_percentage: '1h,24h,7d'
    });
    if (ids) params.set('ids', ids);
    if (category) params.set('category', category);
    
    targetUrl = `${COINGECKO_BASE}/coins/markets?${params.toString()}`;
    ttlMs = 60 * 1000;
  } else if (path.startsWith('/api/coin/')) {
    const parts = path.split('/');
    const coinId = getCoinId(parts[3]);
    const subRoute = parts[4];

    if (!subRoute) {
      targetUrl = coinDetailUrl(coinId);
      ttlMs = COIN_DETAIL_TTL_MS;
      fallback = async () => {
        const [uni, fx] = await Promise.all([getUniverse(ctx), getFx(ctx)]);
        const row = uni.byId.get(coinId);
        return row ? coinFromUniverse(row, fx) : null;
      };
    } else if (subRoute === 'similar') {
      // Neighbours by market-cap rank, served from the universe (no upstream call).
      const vs = getVs();
      const [uni, fx] = await Promise.all([getUniverse(ctx), getFx(ctx)]);
      const rows = similarFromUniverse({ universe: uni, ratio: fx[vs] ?? null, id: coinId, limit: 8 });
      return {
        status: 200,
        cache: 'universe',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Cache': 'universe',
          'Cache-Control': 'public, max-age=60'
        },
        body: JSON.stringify(rows)
      };
    } else if (subRoute === 'chart') {
      const vs = getVs();
      const days = url.searchParams.get('days');
      if (!ALLOWED_DAYS_CHART.has(days)) badRequest('Invalid days');
      targetUrl = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=${vs}&days=${days}`;
      ttlMs = days === '1' ? 120 * 1000 : 900 * 1000;
    } else if (subRoute === 'ohlc') {
      const vs = getVs();
      const days = url.searchParams.get('days');
      if (!ALLOWED_DAYS_OHLC.has(days)) badRequest('Invalid days');
      targetUrl = `${COINGECKO_BASE}/coins/${coinId}/ohlc?vs_currency=${vs}&days=${days}`;
      ttlMs = 300 * 1000;
    } else if (subRoute === 'tickers') {
      const page = intParam('page', 1, 1, 100);
      targetUrl = `${COINGECKO_BASE}/coins/${coinId}/tickers?page=${page}&order=volume_desc&depth=false&include_exchange_logo=true`;
      ttlMs = 300 * 1000;
      transform = (data) => ({
        tickers: (data.tickers || []).map(t => ({
          exchange: t.market?.name,
          exchange_id: t.market?.identifier,
          exchange_logo: t.market?.logo,
          base: t.base,
          target: t.target,
          last_usd: t.converted_last?.usd,
          volume_usd: t.converted_volume?.usd,
          trust_score: t.trust_score,
          spread: t.bid_ask_spread_percentage,
          trade_url: t.trade_url
        }))
      });
    } else {
      const e = new Error('Not Found');
      e.status = 404;
      throw e;
    }
  } else if (path === '/api/search') {
    const q = url.searchParams.get('q');
    if (!q) badRequest('Missing query');
    targetUrl = `${COINGECKO_BASE}/search?query=${encodeURIComponent(q)}`;
    ttlMs = 600 * 1000;
    // While CoinGecko is throttled, answer from the universe (top-500 by name/symbol) so ⌘K keeps working.
    fallback = async () => {
      const uni = await getUniverse(ctx);
      return { coins: searchUniverse(uni, q), categories: [], exchanges: [], partial: true };
    };
    const uni = await getUniverse(ctx).catch(() => null);
    transform = (data) => ({
      coins: (data.coins || []).slice(0, 20).map(c => enrichFromUniverse(uni, {
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        thumb: c.thumb,
        rank: c.market_cap_rank
      })),
      categories: (data.categories || []).slice(0, 10).map(c => ({
        id: c.id,
        name: c.name
      })),
      exchanges: (data.exchanges || []).slice(0, 10).map(e => ({
        id: e.id,
        name: e.name,
        thumb: e.thumb
      }))
    });
  } else if (path === '/api/categories') {
    targetUrl = `${COINGECKO_BASE}/coins/categories?order=market_cap_desc`;
    ttlMs = 600 * 1000;
    transform = (data) => {
      return (data || []).map(c => {
        const { content, ...rest } = c;
        return {
          id: rest.id,
          name: rest.name,
          market_cap: rest.market_cap,
          market_cap_change_24h: rest.market_cap_change_24h,
          volume_24h: rest.volume_24h,
          top_3_coins: rest.top_3_coins,
          top_3_coins_id: rest.top_3_coins_id
        };
      });
    };
  } else if (path === '/api/exchanges') {
    const { page, per_page } = getPageParams();
    targetUrl = `${COINGECKO_BASE}/exchanges?per_page=${per_page}&page=${page}`;
    ttlMs = 600 * 1000;
  } else if (path.startsWith('/api/exchange/')) {
    const parts = path.split('/');
    const exId = parts[3];
    if (!exId || !/^[a-z0-9_-]{1,60}$/.test(exId)) badRequest('Invalid exchange id');
    if (!parts[4]) {
      targetUrl = `${COINGECKO_BASE}/exchanges/${exId}`;
      ttlMs = 600 * 1000;
      transform = (d) => ({
        id: exId,
        name: d.name,
        year_established: d.year_established ?? null,
        country: d.country ?? null,
        description: d.description || '',
        url: d.url || null,
        image: d.image || null,
        facebook_url: d.facebook_url || null,
        reddit_url: d.reddit_url || null,
        twitter_handle: d.twitter_handle || null,
        centralized: d.centralized ?? null,
        trust_score: d.trust_score ?? null,
        trust_score_rank: d.trust_score_rank ?? null,
        trade_volume_24h_btc: d.trade_volume_24h_btc ?? null,
        trade_volume_24h_btc_normalized: d.trade_volume_24h_btc_normalized ?? null,
        tickers: (d.tickers || []).slice(0, 100).map(t => ({
          base: t.base,
          target: t.target,
          coin_id: t.coin_id || null,
          target_coin_id: t.target_coin_id || null,
          last_usd: t.converted_last?.usd ?? null,
          volume_usd: t.converted_volume?.usd ?? null,
          trust_score: t.trust_score ?? null,
          spread: t.bid_ask_spread_percentage ?? null,
          trade_url: t.trade_url || null
        }))
      });
    } else if (parts[4] === 'volume') {
      const days = url.searchParams.get('days') || '30';
      if (!new Set(['7', '14', '30', '90']).has(days)) badRequest('Invalid days');
      targetUrl = `${COINGECKO_BASE}/exchanges/${exId}/volume_chart?days=${days}`;
      ttlMs = 900 * 1000;
      transform = (d) => (Array.isArray(d) ? d.map(([ts, v]) => [ts, Number(v)]) : []);
    } else {
      const e = new Error('Not Found');
      e.status = 404;
      throw e;
    }
  } else if (path === '/api/simple-price') {
    const ids = getIds();
    if (!ids) badRequest('Missing ids');
    let vs = url.searchParams.get('vs');
    if (!vs) badRequest('Missing vs');
    for (const v of vs.split(',')) {
      if (!ALLOWED_VS.has(v)) badRequest('Invalid vs currency in list');
    }

    try {
      const [uni, fx] = await Promise.all([getUniverse(ctx), getFx(ctx)]);
      const idArr = ids.split(',');
      const vsArr = vs.split(',');
      
      const allIdsInUniverse = idArr.every(id => uni.byId.has(id));
      const allVsInCurrencies = vsArr.every(v => VS_CURRENCIES.includes(v));

      if (allIdsInUniverse && allVsInCurrencies) {
        const result = {};
        for (const id of idArr) {
          const row = uni.byId.get(id);
          result[id] = {};
          for (const v of vsArr) {
            const ratio = fx[v];
            if (typeof ratio === 'number' && Number.isFinite(ratio)) {
              result[id][v] = row.current_price * ratio;
              result[id][`${v}_24h_change`] = row.price_change_percentage_24h;
            }
          }
        }
        return {
          status: 200,
          cache: 'universe',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Cache': 'universe',
            'Cache-Control': 'public, max-age=60'
          },
          body: JSON.stringify(result)
        };
      }
    } catch (err) {
      // Fall through
    }

    targetUrl = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=${vs}&include_24hr_change=true`;
    ttlMs = 60 * 1000;
  } else if (path === '/api/currencies') {
    const currencies = [
      { code: "usd", symbol: "$", name: "US Dollar" },
      { code: "eur", symbol: "€", name: "Euro" },
      { code: "gbp", symbol: "£", name: "British Pound" },
      { code: "rub", symbol: "₽", name: "Russian Ruble" },
      { code: "jpy", symbol: "¥", name: "Japanese Yen" },
      { code: "cny", symbol: "¥", name: "Chinese Yuan" },
      { code: "cad", symbol: "CA$", name: "Canadian Dollar" },
      { code: "aud", symbol: "A$", name: "Australian Dollar" },
      { code: "chf", symbol: "CHF", name: "Swiss Franc" },
      { code: "krw", symbol: "₩", name: "South Korean Won" },
      { code: "inr", symbol: "₹", name: "Indian Rupee" },
      { code: "brl", symbol: "R$", name: "Brazilian Real" },
      { code: "try", symbol: "₺", name: "Turkish Lira" },
      { code: "uah", symbol: "₴", name: "Ukrainian Hryvnia" },
      { code: "pln", symbol: "zł", name: "Polish Zloty" },
      { code: "kzt", symbol: "₸", name: "Kazakhstani Tenge" },
      { code: "btc", symbol: "₿", name: "Bitcoin" },
      { code: "eth", symbol: "Ξ", name: "Ethereum" }
    ];
    return {
      status: 200,
      cache: 'hit',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Cache': 'hit',
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify(currencies)
    };
  } else {
    const e = new Error('Not Found');
    e.status = 404;
    throw e;
  }

  let value, cacheStatus;
  try {
    ({ value, status: cacheStatus } = await ctx.cache.get(cacheKey(targetUrl), ttlMs, () => fetchUpstream(targetUrl)));
  } catch (err) {
    if (!fallback || err.status === 404) throw err;
    const degraded = await fallback().catch(() => null);
    if (!degraded) throw err;
    value = degraded;
    cacheStatus = 'fallback';
  }
  // Fallback payloads are already in the public shape; transforms only apply to raw upstream data.
  const finalValue = cacheStatus === 'fallback' ? value : transform(value);
  
  return {
    status: 200,
    cache: cacheStatus,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Cache': cacheStatus,
      'Cache-Control': `public, max-age=${Math.floor(ttlMs / 1000)}`
    },
    body: JSON.stringify(finalValue)
  };
}
