import { settings } from './store.js';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

const cache = new Map();

// Offline awareness: the service worker marks responses it served from its cache with X-Offline: 1.
let servedOffline = false;
function noteOffline(res) {
  const offline = res.headers.get('X-Offline') === '1';
  if (offline && !servedOffline) window.dispatchEvent(new CustomEvent('api:offline-data'));
  if (!offline && servedOffline && res.ok) window.dispatchEvent(new CustomEvent('api:online-data'));
  servedOffline = offline;
}

export const api = {
  async get(path, params = {}) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        query.set(k, v);
      }
    }
    const qString = query.toString();
    const url = `/api${path}${qString ? '?' + qString : ''}`;
    
    const now = Date.now();
    const cached = cache.get(url);
    if (cached && (now - cached.ts) < 30000) {
      return cached.data;
    }

    let res = await fetch(url);
    noteOffline(res);
    let data = null;
    try { data = await res.json(); } catch { data = null; }

    // Upstream cooldown (503 + Retry-After): wait once, bounded, and retry instead of failing the page.
    // The service worker's synthetic offline 503 ({error:'offline'}) is not worth retrying.
    if (res.status === 503 && !(data && data.error === 'offline')) {
      const wait = Math.min(Math.max(parseInt(res.headers.get('Retry-After') || '5', 10) || 5, 2), 20) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      res = await fetch(url);
      noteOffline(res);
      try { data = await res.json(); } catch { data = null; }
    }
    
    if (!res.ok) {
      throw new ApiError(res.status, (data && data.error) || res.statusText || `HTTP ${res.status}`);
    }
    
    cache.set(url, { ts: now, data });
    return data;
  },

  global() { return this.get('/global'); },
  fng() { return this.get('/fng'); },
  trending() { return this.get('/trending'); },
  
  async markets(opts = {}) {
    const vs = settings.get().currency || 'usd';
    const params = {
      vs,
      page: opts.page || 1,
      per_page: opts.perPage || 100
    };
    if (opts.category) params.category = opts.category;
    if (opts.order) params.order = opts.order;
    
    if (opts.ids) {
      const idsArray = [...new Set(opts.ids.split(',').filter(Boolean))];
      if (idsArray.length > 100) {
        const chunks = [];
        for (let i = 0; i < idsArray.length; i += 100) {
          chunks.push(idsArray.slice(i, i + 100));
        }
        const results = await Promise.all(chunks.map(chunk => 
          this.get('/markets', { ...params, ids: chunk.join(','), per_page: 250 })
        ));
        return results.flat();
      }
      params.ids = opts.ids;
    }
    return this.get('/markets', params);
  },

  coin(id) { return this.get(`/coin/${id}`); },
  similar(id) { return this.get(`/coin/${id}/similar`, { vs: settings.get().currency || 'usd' }); },
  chart(id, days) { 
    return this.get(`/coin/${id}/chart`, { vs: settings.get().currency || 'usd', days }); 
  },
  ohlc(id, days) { 
    return this.get(`/coin/${id}/ohlc`, { vs: settings.get().currency || 'usd', days }); 
  },
  tickers(id, page = 1) { return this.get(`/coin/${id}/tickers`, { page }); },
  
  search(q) { return this.get('/search', { q }); },
  categories() { return this.get('/categories'); },
  exchanges(page = 1, perPage = 100) { return this.get('/exchanges', { page, per_page: perPage }); },
  exchange(id) { return this.get(`/exchange/${id}`); },
  exchangeVolume(id, days = 30) { return this.get(`/exchange/${id}/volume`, { days }); },
  
  simplePrice(ids, vs) { return this.get('/simple-price', { ids, vs }); },
  
  currencies() { return this.get('/currencies'); },

  async fxRatio() {
    const cur = settings.get().currency || 'usd';
    if (cur.toLowerCase() === 'usd') return 1;

    const cacheKey = `fx_${cur}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.ts) < 300000) { // 5 min cache
      return cached.ratio;
    }

    try {
      const data = await this.simplePrice('bitcoin', `${cur},usd`);
      if (data.bitcoin && data.bitcoin.usd && data.bitcoin[cur]) {
        const ratio = data.bitcoin[cur] / data.bitcoin.usd;
        cache.set(cacheKey, { ts: now, ratio });
        return ratio;
      }
    } catch (e) {
      console.warn('Failed to fetch fx ratio', e);
    }
    // Fall back to the last known ratio (even if expired); NaN tells callers to skip conversions.
    return cached ? cached.ratio : NaN;
  }
};

export function normalizeCoin(row) {
  return {
    id: row.id,
    rank: row.market_cap_rank,
    name: row.name,
    symbol: row.symbol,
    image: row.image,
    price: row.current_price,
    change1h: row.price_change_percentage_1h_in_currency,
    change24h: row.price_change_percentage_24h_in_currency ?? row.price_change_percentage_24h,
    change7d: row.price_change_percentage_7d_in_currency,
    volume: row.total_volume,
    marketCap: row.market_cap,
    fdv: row.fully_diluted_valuation,
    sparkline: row.sparkline_in_7d && row.sparkline_in_7d.price ? row.sparkline_in_7d.price : [],
    high24h: row.high_24h,
    low24h: row.low_24h,
    ath: row.ath,
    athDate: row.ath_date,
    atl: row.atl,
    circulating: row.circulating_supply,
    total: row.total_supply,
    max: row.max_supply
  };
}
