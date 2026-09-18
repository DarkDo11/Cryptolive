const VIEW_RETENTION_MS = 7 * 24 * 3600 * 1000;

export function createPopular({ halfLifeMs = 24 * 3600 * 1000, maxEntries = 2000 } = {}) {
  const entries = new Map();

  const decayedScore = (entry, now) => entry.score * 0.5 ** ((now - entry.updatedAt) / halfLifeMs);

  return {
    hit(coinId, now = Date.now()) {
      if (typeof coinId !== 'string' || !coinId) return;
      const previous = entries.get(coinId);
      const entry = previous
        ? {
            score: decayedScore(previous, now) + 1,
            updatedAt: now,
            views: (now - previous.updatedAt > VIEW_RETENTION_MS ? 0 : previous.views) + 1
          }
        : { score: 1, updatedAt: now, views: 1 };
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
        views: entry.views
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
            !Number.isFinite(entry.updatedAt) ||
            !Number.isSafeInteger(entry.views) || entry.views < 0) continue;
        entries.set(id, { score: entry.score, updatedAt: entry.updatedAt, views: entry.views });
        restored++;
      }
      return restored;
    }
  };
}
