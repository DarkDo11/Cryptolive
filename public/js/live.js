import { settings } from './store.js';
import { fmtCurrency, fmtPercent } from './format.js';

let es = null;
let currentStatus = 'offline';
const subscribers = new Set();

function updateStatus(status) {
  if (currentStatus !== status) {
    currentStatus = status;
    window.dispatchEvent(new CustomEvent('live:status', { detail: status }));
  }
}

export const live = {
  connect() {
    if (es) return;
    
    updateStatus('connecting');
    es = new EventSource('/api/stream');
    
    es.addEventListener('open', () => {
      updateStatus('live');
    });
    
    es.addEventListener('error', () => {
      updateStatus('offline');
      es.close();
      es = null;
      // Auto-reconnect by attempting to connect after a delay
      setTimeout(() => this.connect(), 5000);
    });

    es.addEventListener('hello', (e) => {
      // Just an initial snapshot/info
    });

    es.addEventListener('tick', (e) => {
      try {
        const data = JSON.parse(e.data);
        for (const cb of subscribers) {
          cb(data);
        }
      } catch (err) {
        console.error('Error parsing live tick', err);
      }
    });
  },

  subscribe(cb) {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  },

  status() {
    return currentStatus;
  }
};

export function flashPrice(el, direction) {
  const cls = direction === 'up' ? 'flash-up' : 'flash-down';
  el.classList.remove('flash-up', 'flash-down');
  // force reflow
  void el.offsetWidth;
  el.classList.add(cls);
  
  const onEnd = () => {
    el.classList.remove(cls);
    el.removeEventListener('animationend', onEnd);
  };
  el.addEventListener('animationend', onEnd);
  
  // Fallback if animationend doesn't fire
  setTimeout(() => el.classList.remove(cls), 800);
}

export function applyLiveTick(root, tick, fx = 1) {
  // Without a valid fiat ratio we cannot convert USD ticks: better no update than a wrong one.
  if (!tick || !tick.prices || !root || !Number.isFinite(fx)) return;
  const currency = settings.get().currency || 'usd';

  for (const [coinId, data] of Object.entries(tick.prices)) {
    const priceEls = root.querySelectorAll(`[data-live-price="${coinId}"]`);
    for (const el of priceEls) {
      const oldPrice = Number(el.dataset.priceUsd) || 0;
      const newPrice = data.p;
      
      if (newPrice !== oldPrice) {
        const displayValue = newPrice * fx;
        el.textContent = fmtCurrency(displayValue, currency);
        el.dataset.priceUsd = newPrice;
        
        if (oldPrice > 0) {
          flashPrice(el, newPrice > oldPrice ? 'up' : 'down');
        }
      }
    }

    const changeEls = root.querySelectorAll(`[data-live-change="${coinId}"]`);
    for (const el of changeEls) {
      el.textContent = fmtPercent(data.c);
      el.className = `change-badge ${data.c > 0 ? 'is-up' : data.c < 0 ? 'is-down' : ''}`;
    }
  }
}
