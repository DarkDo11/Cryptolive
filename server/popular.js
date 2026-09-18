const VIEW_RETENTION_MS = 7 * 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

export function createPopular({ halfLifeMs = 24 * 3600 * 1000, maxEntries = 2000 } = {}) {
  const entries = new Map();

  const decayedScore = (entry, now) => entry.score * 0.5 ** ((now - entry.updatedAt) / halfLifeMs);
  const pruneBuckets = (entry, now) => {
    const cutoff = now - VIEW_RETENTION_MS;
    entry.buckets = entry.buckets.filter(([hourTs]) => hourTs >= cutoff);
    return entry.buckets.reduce((sum, bucket) => sum + bucket[1], 0);
  };

  return {
    hit(coinId, now = Date.now()) {
      if (typeof coinId !== 'string' || !coinId) return;
      const previous = entries.get(coinId);
      const entry = previous || { score: 0, updatedAt: now, buckets: [] };
      const score = previous ? decayedScore(previous, now) + 1 : 1;
      pruneBuckets(entry, now);
      const hourTs = Math.floor(now / HOUR_MS) * HOUR_MS;
      const bucket = entry.buckets.find(item => item[0] === hourTs);
      if (bucket) bucket[1]++;
      else entry.buckets.push([hourTs, 1]);
      entry.score = score;
      entry.updatedAt = now;
      entries.set(coinId, entry);

      while (entries.size > maxEntries) {
        let lowestId;
        let lowestScore = Infinity;
        for (const [id, candidate] of entries) {
          const score = decayedScore(candidate, now);
          if (score < lowestScore) {
            lowestId = id;
            lowestScore = score;
          }
        }
        entries.delete(lowestId);
      }
    },

    top(limit = 10, now = Date.now()) {
      return [...entries].map(([id, entry]) => ({
        id,
        score: decayedScore(entry, now),
        views: pruneBuckets(entry, now)
      })).filter(entry => entry.score >= 0.01)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    snapshot() {
      return {
        entries: [...entries].map(([id, entry]) => [id, { ...entry }])
      };
    },

    restore(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.entries)) return 0;
      let restored = 0;
      for (const item of snapshot.entries) {
        if (!Array.isArray(item) || item.length !== 2) continue;
        const [id, entry] = item;
        if (typeof id !== 'string' || !id || !entry || typeof entry !== 'object' ||
            !Number.isFinite(entry.score) || entry.score < 0 ||
            !Number.isFinite(entry.updatedAt)) continue;
        let buckets = entry.buckets;
        if (!Array.isArray(buckets) && Number.isSafeInteger(entry.views) && entry.views >= 0) {
          buckets = entry.views > 0 ? [[entry.updatedAt, entry.views]] : [];
        }
        if (!Array.isArray(buckets) || !buckets.every(bucket => Array.isArray(bucket) && bucket.length === 2 &&
          Number.isFinite(bucket[0]) && Number.isSafeInteger(bucket[1]) && bucket[1] > 0)) continue;
        entries.set(id, { score: entry.score, updatedAt: entry.updatedAt, buckets: buckets.map(bucket => [...bucket]) });
        restored++;
      }
      return restored;
    }
  };
}
