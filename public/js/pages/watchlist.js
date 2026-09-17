import { initLayout, qs, qsa, toast } from '../layout.js';
import { api, normalizeCoin } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { renderCoinTable, emptyState, skeletonRows, sortCoins, changeBadge } from '../components.js';
import { watchlist, settings } from '../store.js';
import { fmtCurrency, fmtPercent, fmtCompact, escapeHtml } from '../format.js';
import { t } from '../i18n.js';

initLayout({ active: 'watchlist' });

const watchSub = qs('#watchSub');
const watchSummary = qs('#watchSummary');
const watchToolbar = qs('#watchToolbar');
const watchTableContainer = qs('#watchTable');

let coinsData = [];
let sortKey = 'marketCap';
let sortDir = 'desc';
let fx = 1;
let unsubLive = null;
let refreshTimer = null;

async function loadData() {
  const ids = watchlist.list();
  
  if (ids.length === 0) {
    watchSub.textContent = '0 coins';
    watchSummary.style.display = 'none';
    watchToolbar.style.display = 'none';
    watchTableContainer.innerHTML = emptyState(
      'Your watchlist is empty',
      'Click the ☆ star next to any coin to track it here'
    ) + `<div style="text-align: center; margin-top: 16px;"><a href="/" class="btn btn-primary">Browse markets</a></div>`;
    if (unsubLive) {
      unsubLive();
      unsubLive = null;
    }
    return;
  }

  watchToolbar.style.display = 'flex';
  
  if (coinsData.length === 0) {
    watchTableContainer.innerHTML = `
      <div class="table-frame">
        <table class="data-table">
          <thead>
            <tr><th></th><th>#</th><th>${t('js.coin')}</th><th>${t('js.price')}</th><th>1h %</th><th>24h %</th><th>7d %</th><th>24h Volume</th><th>${t('js.market_cap')}</th><th>${t('js.last_7_days')}</th></tr>
          </thead>
          <tbody>${skeletonRows(ids.length, 10)}</tbody>
        </table>
      </div>
    `;
  }

  try {
    const [fxRatio, rows] = await Promise.all([
      api.fxRatio(),
      api.markets({ ids: ids.join(','), perPage: 250 })
    ]);
    fx = fxRatio;
    
    // Sort logic
    coinsData = sortCoins(rows.map(normalizeCoin), sortKey, sortDir);
    
    renderCoinTable(watchTableContainer, coinsData, {
      sortKey,
      sortDir,
      fx,
      onSort: (key) => {
        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDir = 'desc';
        }
        coinsData = sortCoins(coinsData, sortKey, sortDir);
        renderData();
      }
    });

    renderSummary();

    if (!unsubLive) {
      unsubLive = live.subscribe((tick) => applyLiveTick(watchTableContainer, tick, fx));
    }
  } catch (err) {
    console.error('Watchlist load error', err);
    watchTableContainer.innerHTML = `
      <div class="card" style="padding: 32px; text-align: center;">
        <p style="color: var(--red); margin-bottom: 16px;">${t('js.failed_to_load_watchlist_data')}</p>
        <button class="btn btn-primary" data-action="retry">Retry</button>
      </div>
    `;
  }
}

function renderData() {
  renderCoinTable(watchTableContainer, coinsData, {
    sortKey,
    sortDir,
    fx,
    onSort: (key) => {
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = 'desc';
      }
      coinsData = sortCoins(coinsData, sortKey, sortDir);
      renderData();
    }
  });
}

function renderSummary() {
  if (coinsData.length === 0) return;
  const cur = settings.get().currency || 'usd';
  
  let totalCap = 0;
  let totalChange = 0;
  
  coinsData.forEach(c => {
    totalCap += (c.marketCap || 0);
    totalChange += (c.change24h || 0);
  });
  
  const avgChange = totalChange / coinsData.length;
  watchSub.textContent = `${coinsData.length} coin${coinsData.length > 1 ? 's' : ''}`;
  
  watchSummary.style.display = 'flex';
  watchSummary.innerHTML = `
    <div class="card" style="padding: 16px; flex: 1; text-align: center;">
      <div style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">Combined Market Cap</div>
      <div style="font-size: 20px; font-weight: 600;">${fmtCompact(totalCap, cur)}</div>
    </div>
    <div class="card" style="padding: 16px; flex: 1; text-align: center;">
      <div style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">Avg 24h Change</div>
      <div style="font-size: 20px; font-weight: 600;">${changeBadge(avgChange)}</div>
    </div>
  `;
}

// Actions
qs('#exportBtn').addEventListener('click', () => {
  const ids = watchlist.list();
  const blob = new Blob([JSON.stringify({ ids })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'watchlist.json';
  a.click();
  URL.revokeObjectURL(url);
});

qs('#importInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (Array.isArray(data.ids)) {
        data.ids.forEach(id => {
          if (!watchlist.has(id)) {
            watchlist.add(id);
          }
        });
        toast(t('js.watchlist_imported_successfully'), { type: 'success' });
      } else {
        throw new Error('Invalid format');
      }
    } catch (err) {
      toast(t('js.failed_to_import_watchlist'), { type: 'error' });
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

qs('#clearBtn').addEventListener('click', () => {
  if (confirm('Are you sure you want to clear your watchlist?')) {
    const ids = watchlist.list();
    ids.forEach(id => watchlist.remove(id));
    toast(t('js.watchlist_cleared'), { type: 'success' });
  }
});

// Events
window.addEventListener('watchlist:change', () => {
  loadData();
});

window.addEventListener('currency:change', async () => {
  coinsData = [];
  await loadData();
});

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      loadData().then(scheduleRefresh);
    } else {
      scheduleRefresh();
    }
  }, 60000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadData();
  }
});

loadData().then(scheduleRefresh);
