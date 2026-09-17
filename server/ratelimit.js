export function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map();
  let nextReset = Date.now() + windowMs;
  
  const interval = setInterval(() => {
    hits.clear();
    nextReset = Date.now() + windowMs;
  }, windowMs);
  
  if (interval.unref) interval.unref();

  return {
    check(ip) {
      const count = (hits.get(ip) || 0) + 1;
      hits.set(ip, count);
      
      return {
        ok: count <= max,
        remaining: Math.max(0, max - count),
        resetMs: Math.max(0, nextReset - Date.now())
      };
    }
  };
}
