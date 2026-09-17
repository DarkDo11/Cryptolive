import { limit } from './cache.js';

export const COINGECKO_BASE = process.env.UPSTREAM_COINGECKO || 'https://api.coingecko.com/api/v3';
const CG_KEY = process.env.COINGECKO_API_KEY;

// After a 429 the whole upstream is considered throttled until this timestamp: further calls fail fast
// (the cache then serves stale data) instead of burning more quota and hanging requests.
let throttledUntil = 0;
const counters = { requests: 0, ok: 0, rateLimited: 0, errors: 0, lastOkAt: null, lastErrorAt: null, lastRateLimitAt: null };
export function upstreamStatus() {
  return {
    throttled: Date.now() < throttledUntil,
    throttledForMs: Math.max(0, throttledUntil - Date.now()),
    keyConfigured: Boolean(CG_KEY),
    ...counters
  };
}
function throttledError() {
  const e = new Error('Upstream rate limited, retry later');
  e.status = 503;
  e.retryAfter = Math.ceil(Math.max(1000, throttledUntil - Date.now()) / 1000);
  return e;
}

export const fetchUpstream = limit(async (targetUrl, options = {}) => {
  const doFetch = async (retries = 1) => {
    if (Date.now() < throttledUntil) throw throttledError();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const fetchOptions = {
      ...options,
      headers: { ...options.headers },
      signal: controller.signal
    };
    
    if (CG_KEY && targetUrl.startsWith(COINGECKO_BASE)) {
      fetchOptions.headers['x-cg-demo-api-key'] = CG_KEY;
    }

    try {
      counters.requests++;
      const resp = await fetch(targetUrl, fetchOptions);
      clearTimeout(timeout);
      
      if (resp.status === 429) {
        counters.rateLimited++;
        counters.lastRateLimitAt = Date.now();
        const retryAfter = parseInt(resp.headers.get('Retry-After') || '', 10);
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000;
        if (retries > 0 && waitMs <= 5000) {
          // Short back-off: retry once, the cache covers the rest.
          await new Promise(r => setTimeout(r, waitMs));
          return doFetch(retries - 1);
        }
        // Enter cooldown (bounded) so concurrent/following requests fail fast.
        throttledUntil = Date.now() + Math.min(Math.max(waitMs, 10000), 60000);
        throw throttledError();
      }
      
      if (!resp.ok) {
        if (resp.status !== 404) { counters.errors++; counters.lastErrorAt = Date.now(); }
        const err = new Error(`Upstream Error: ${resp.status} ${resp.statusText}`);
        err.status = resp.status === 404 ? 404 : 502;
        throw err;
      }
      
      counters.ok++;
      counters.lastOkAt = Date.now();
      return resp.json();
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        const e = new Error('Upstream Timeout');
        e.status = 504;
        throw e;
      }
      if (!err.status) err.status = 502;
      throw err;
    }
  };
  return doFetch();
});

/** Cache key independent of the configured upstream host, so snapshots survive base URL changes. */
export function cacheKey(url) {
  return url.startsWith(COINGECKO_BASE) ? 'cg:' + url.slice(COINGECKO_BASE.length) : url;
}

export function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  throw e;
}
