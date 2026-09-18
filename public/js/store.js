/**
 * Local storage modules for state management
 */

function safeGet(key, def) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : def;
  } catch (e) {
    return def;
  }
}

function safeSet(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.warn('localStorage error', e);
  }
}

// Migrate legacy theme
try {
  const legacyTheme = localStorage.getItem('cryptolive-theme');
  if (legacyTheme) {
    const current = safeGet('cryptolive:settings', {});
    current.theme = legacyTheme;
    safeSet('cryptolive:settings', current);
    localStorage.removeItem('cryptolive-theme');
  }
} catch (e) {}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export const settings = {
  get() {
    return Object.assign({
      theme: 'dark',
      currency: 'usd',
      perPage: 100
    }, safeGet('cryptolive:settings', {}));
  },
  set(patch) {
    const current = this.get();
    const updated = { ...current, ...patch };
    safeSet('cryptolive:settings', updated);
    window.dispatchEvent(new CustomEvent('settings:change', { detail: updated }));
  }
};

export const watchlist = {
  list() {
    return safeGet('cryptolive:watchlist', []);
  },
  has(id) {
    return this.list().includes(id);
  },
  add(id) {
    const current = this.list();
    if (!current.includes(id)) {
      current.push(id);
      safeSet('cryptolive:watchlist', current);
      window.dispatchEvent(new Event('watchlist:change'));
    }
  },
  remove(id) {
    const current = this.list().filter(x => x !== id);
    safeSet('cryptolive:watchlist', current);
    window.dispatchEvent(new Event('watchlist:change'));
  },
  toggle(id) {
    if (this.has(id)) {
      this.remove(id);
    } else {
      this.add(id);
    }
  }
};

/** Recently viewed coin ids (most recent first, max 8) — feeds the "Recently viewed" strip on Markets. */
export const recentCoins = {
  list() {
    return safeGet('cryptolive:recent-coins', []);
  },
  push(id) {
    if (!id) return;
    const list = [id].concat(this.list().filter((x) => x !== id)).slice(0, 8);
    safeSet('cryptolive:recent-coins', list);
  },
  clear() {
    safeSet('cryptolive:recent-coins', []);
  }
};

export const portfolio = {
  list() {
    return safeGet('cryptolive:portfolio', []);
  },
  add(tx) {
    const current = this.list();
    const newTx = { ...tx, id: uuid(), date: tx.date || Date.now() };
    current.push(newTx);
    safeSet('cryptolive:portfolio', current);
    window.dispatchEvent(new Event('portfolio:change'));
  },
  addMany(txs) {
    const current = this.list();
    for (const tx of txs) {
      current.push({ ...tx, id: uuid(), date: tx.date || Date.now() });
    }
    safeSet('cryptolive:portfolio', current);
    window.dispatchEvent(new Event('portfolio:change'));
  },
  replaceAll(txs) {
    const updated = txs.map(tx => ({
      ...tx,
      id: typeof tx.id === 'string' && tx.id ? tx.id : uuid(),
      date: tx.date || Date.now()
    }));
    safeSet('cryptolive:portfolio', updated);
    window.dispatchEvent(new Event('portfolio:change'));
  },
  update(id, patch) {
    const current = this.list();
    const idx = current.findIndex(x => x.id === id);
    if (idx !== -1) {
      current[idx] = { ...current[idx], ...patch };
      safeSet('cryptolive:portfolio', current);
      window.dispatchEvent(new Event('portfolio:change'));
    }
  },
  remove(id) {
    const current = this.list().filter(x => x.id !== id);
    safeSet('cryptolive:portfolio', current);
    window.dispatchEvent(new Event('portfolio:change'));
  },
  clear() {
    safeSet('cryptolive:portfolio', []);
    window.dispatchEvent(new Event('portfolio:change'));
  },
  realized() {
    const byCoin = Object.create(null);
    const txs = this.list()
      .map((tx, index) => ({ tx, index }))
      .sort((a, b) => (Number(a.tx.date) - Number(b.tx.date)) || (a.index - b.index));

    for (const { tx } of txs) {
      if (!byCoin[tx.coinId]) {
        byCoin[tx.coinId] = { realizedUsd: 0, soldAmount: 0 };
      }
      const result = byCoin[tx.coinId];
      const amt = Number(tx.amount) || 0;
      const price = Number(tx.price) || 0;
      if (tx.type === 'buy') {
        const held = result.held || 0;
        result.avg = ((result.avg || 0) * held + amt * price) / (held + amt);
        result.held = held + amt;
      } else if (tx.type === 'sell') {
        const soldAmount = Math.max(0, Math.min(amt, result.held || 0));
        result.realizedUsd += soldAmount * (price - (result.avg || 0));
        result.soldAmount += soldAmount;
        result.held = (result.held || 0) - amt;
      }
    }

    let totalRealizedUsd = 0;
    const out = {};
    for (const [coinId, result] of Object.entries(byCoin)) {
      totalRealizedUsd += result.realizedUsd;
      out[coinId] = { realizedUsd: result.realizedUsd, soldAmount: result.soldAmount };
    }
    return { totalRealizedUsd, byCoin: out };
  },
  holdings() {
    const txs = this.list();
    const map = new Map();
    for (const tx of txs) {
      if (!map.has(tx.coinId)) {
        map.set(tx.coinId, {
          coinId: tx.coinId,
          symbol: tx.symbol,
          name: tx.name,
          image: tx.image,
          amount: 0,
          totalBuyCost: 0,
          totalBuyAmount: 0
        });
      }
      const h = map.get(tx.coinId);
      const amt = Number(tx.amount) || 0;
      const price = Number(tx.price) || 0;
      if (tx.type === 'buy') {
        h.amount += amt;
        h.totalBuyCost += (amt * price);
        h.totalBuyAmount += amt;
      } else if (tx.type === 'sell') {
        h.amount -= amt;
      }
    }
    
    const avgCosts = Object.create(null);
    const datedTxs = txs
      .map((tx, index) => ({ tx, index }))
      .sort((a, b) => (Number(a.tx.date) - Number(b.tx.date)) || (a.index - b.index));
    for (const { tx } of datedTxs) {
      const current = avgCosts[tx.coinId] || { held: 0, avg: 0 };
      const amt = Number(tx.amount) || 0;
      const price = Number(tx.price) || 0;
      if (tx.type === 'buy') {
        current.avg = (current.avg * current.held + amt * price) / (current.held + amt);
        current.held += amt;
      } else if (tx.type === 'sell') {
        current.held -= amt;
      }
      avgCosts[tx.coinId] = current;
    }

    const result = [];
    for (const h of map.values()) {
      if (h.amount > 0 || h.totalBuyAmount > 0) {
        // Average cost of the position actually held (moving average; sells keep it, later buys blend in).
        const avgCostUsd = avgCosts[h.coinId] ? avgCosts[h.coinId].avg : 0;
        const avgPriceUsd = avgCostUsd;
        const costBasisUsd = avgCostUsd * Math.max(0, h.amount);
        result.push({
          coinId: h.coinId,
          symbol: h.symbol,
          name: h.name,
          image: h.image,
          amount: h.amount,
          costBasisUsd,
          avgPriceUsd,
          avgCostUsd
        });
      }
    }
    return result;
  }
};
