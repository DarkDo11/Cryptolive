export function limit(fn, maxConcurrent = 3) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active < maxConcurrent && queue.length > 0) {
      active++;
      const { resolve, reject, args } = queue.shift();
      fn(...args)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          active--;
          next();
        });
    }
  };

  return (...args) => {
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject, args });
      next();
    });
  };
}

// How long (in multiples of the TTL) an expired entry may still be served while revalidating.
const MAX_STALE_FACTOR = 10;

export class TtlCache {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    this.cache = new Map(); // key -> { value, expiresAt }
    this.inFlight = new Map(); // key -> Promise<{value, status}>
    this.counters = { hit: 0, stale: 0, miss: 0, error: 0 };
  }

  /**
   * Resolve a value for `key`.
   *  - fresh entry            -> return it (hit)
   *  - expired but not older than MAX_STALE_FACTOR * ttl -> return it immediately and
   *    revalidate in the background (stale-while-revalidate)
   *  - otherwise              -> fetch (coalesced); on failure fall back to any stale copy
   */
  async get(key, ttlMs, fetcher) {
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > now) {
      // Map keeps insertion order; re-insert to mark as most recently used.
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.counters.hit++;
      return { value: cached.value, status: 'hit' };
    }

    if (cached && cached.expiresAt + ttlMs * MAX_STALE_FACTOR > now) {
      // Serve stale right away, refresh in the background (errors are swallowed: stale stays).
      this.revalidate(key, ttlMs, fetcher).catch(() => {});
      this.counters.stale++;
      return { value: cached.value, status: 'stale' };
    }

    try {
      const value = await this.revalidate(key, ttlMs, fetcher);
      this.counters.miss++;
      return { value, status: 'miss' };
    } catch (err) {
      if (cached) { this.counters.stale++; return { value: cached.value, status: 'stale' }; }
      this.counters.error++;
      throw err;
    }
  }

  /** Fetch `key` (coalescing concurrent callers) and store the result. */
  revalidate(key, ttlMs, fetcher) {
    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const promise = (async () => {
      try {
        const value = await fetcher();
        if (!this.cache.has(key) && this.cache.size >= this.maxEntries) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
        this.cache.delete(key);
        this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  stats() {
    const total = this.counters.hit + this.counters.stale + this.counters.miss + this.counters.error;
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
      inFlight: this.inFlight.size,
      ...this.counters,
      hitRatio: total ? Number(((this.counters.hit + this.counters.stale) / total).toFixed(3)) : null
    };
  }

  /** Serialisable snapshot of all entries (fresh and stale) for persistence across restarts. */
  snapshot() {
    const entries = [];
    for (const [key, entry] of this.cache) entries.push([key, entry.value, entry.expiresAt]);
    return { savedAt: Date.now(), entries };
  }

  /** Restore entries from snapshot(); entries older than maxAgeMs are skipped. */
  restore(snapshot, maxAgeMs = 6 * 60 * 60 * 1000) {
    if (!snapshot || !Array.isArray(snapshot.entries)) return 0;
    const now = Date.now();
    let restored = 0;
    for (const [key, value, expiresAt] of snapshot.entries) {
      if (typeof key !== 'string' || !Number.isFinite(expiresAt)) continue;
      if (now - expiresAt > maxAgeMs) continue;
      this.cache.set(key, { value, expiresAt });
      restored++;
    }
    return restored;
  }
}
