import { initLayout, qs, qsa } from '../layout.js';
import { api, normalizeCoin } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { renderCoinTable, skeletonRows, changeBadge } from '../components.js';
import { t } from '../i18n.js';
import { fmtCurrency, fmtPercent, escapeHtml } from '../format.js';
import { settings } from '../store.js';

initLayout({ active: 'gainers-losers' });

const gainersTable = qs('#gainersTable');
const losersTable = qs('#losersTable');
const volumeTable = qs('#volumeTable');
const volatileTable = qs('#volatileTable');
const tabs = qs('#tfTabs');

let allCoins = [];
let currentTf = 'change24h';
let fx = 1;
let unsubLive = null;
let refreshTimer = null;

async function loadData() {
  if (allCoins.length === 0) {
    const skel = `
      <div class="table-frame">
        <table class="data-table">
          <thead><tr><th>#</th><th>${t('js.coin')}</th><th>${t('js.price')}</th><th>${t('js.change')}</th><th>${t('js.24h_volume')}</th><th>${t('js.market_cap')}</th></tr></thead>
          <tbody>${skeletonRows(20, 6)}</tbody>
        </table>
      </div>
    `;
    gainersTable.innerHTML = skel;
    losersTable.innerHTML = skel;
    volumeTable.innerHTML = skel;
    volatileTable.innerHTML = skel;
  }

  try {
    const [fxRatio, p1, p2] = await Promise.allSettled([
      api.fxRatio(),
      api.markets({ page: 1, perPage: 250 }),
      api.markets({ page: 2, perPage: 250 })
    ]);

    fx = p1.status === 'fulfilled' ? p1.value : (fxRatio.status === 'fulfilled' ? fxRatio.value : 1);
    
    // Wait, fxRatio is the first promise. So index 0.
    fx = fxRatio.status === 'fulfilled' ? fxRatio.value : 1;

    let rows = [];
    if (p1.status === 'fulfilled') rows = rows.concat(p1.value);
    if (p2.status === 'fulfilled') rows = rows.concat(p2.value);

    allCoins = rows.map(normalizeCoin);
    
    renderData();

    if (!unsubLive) {
      unsubLive = live.subscribe((tick) => {
        applyLiveTick(gainersTable, tick, fx);
        applyLiveTick(losersTable, tick, fx);
        applyLiveTick(volumeTable, tick, fx);
        applyLiveTick(volatileTable, tick, fx);
      });
    }
  } catch (err) {
    console.error('Gainers/Losers load error', err);
  }
}

function renderData() {
  if (allCoins.length === 0) return;

  const validCoins = allCoins.filter(c => (c.volume / (Number.isFinite(fx) && fx > 0 ? fx : 1)) >= 50000 && typeof c[currentTf] === 'number' && isFinite(c[currentTf]));
  
  validCoins.sort((a, b) => b[currentTf] - a[currentTf]);
  
  const gainers = validCoins.slice(0, 20);
  const losers = validCoins.slice(-20).reverse();

  const cols = ['rank', 'coin', 'price', currentTf, 'volume', 'marketCap'];
  
  renderCoinTable(gainersTable, gainers, { columns: cols, sortable: false, fx });
  renderCoinTable(losersTable, losers, { columns: cols, sortable: false, fx });

  const volumeCoins = [...allCoins].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 20);
  renderCoinTable(volumeTable, volumeCoins, { columns: ['rank', 'coin', 'price', 'change24h', 'volume', 'marketCap'], sortable: false, fx });

  const volatileCoins = allCoins.filter(c => isFinite(c.high24h) && isFinite(c.low24h) && c.low24h > 0 && (c.volume / (Number.isFinite(fx) && fx > 0 ? fx : 1)) >= 50000);
  volatileCoins.sort((a, b) => ((b.high24h - b.low24h) / b.low24h) - ((a.high24h - a.low24h) / a.low24h));
  
  const cur = settings.get().currency || 'usd';
  let volatileHtml = `<div class="table-frame"><table class="data-table is-plain"><thead><tr><th>#</th><th>${t('table.coin')}</th><th>${t('table.price')}</th><th>${t('gl.range')}</th><th>${t('table.change24h')}</th></tr></thead><tbody>`;
  
  volatileCoins.slice(0, 20).forEach(c => {
    const rangePct = (c.high24h - c.low24h) / c.low24h;
    volatileHtml += `<tr data-coin-id="${escapeHtml(c.id)}" style="cursor:pointer"><td>${c.rank ?? '-'}</td><td><a class="asset-cell" href="/coin/${encodeURIComponent(c.id)}"><img class="asset-logo" src="${escapeHtml(c.image||'')}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="asset-copy"><span class="asset-name">${escapeHtml(c.name)}</span><span class="asset-symbol">${escapeHtml(String(c.symbol||'').toUpperCase())}</span></span></a></td><td class="price-cell" data-live-price="${escapeHtml(c.id)}" data-price-usd="${c.price / fx}">${fmtCurrency(c.price, cur)}</td><td><span class="range-pct">${fmtPercent(rangePct * 100).replace('+','')}</span><span class="muted small" style="margin-left:6px">${fmtCurrency(c.low24h, cur)} – ${fmtCurrency(c.high24h, cur)}</span></td><td>${changeBadge(c.change24h, `data-live-change="${escapeHtml(c.id)}"`)}</td></tr>`;
  });
  volatileHtml += `</tbody></table></div>`;
  volatileTable.innerHTML = volatileHtml;

  volatileTable.onclick = (e) => {
    if (e.target.closest('a')) return;
    const row = e.target.closest('tr[data-coin-id]');
    if (row && volatileTable.contains(row)) {
      location.href = `/coin/${row.dataset.coinId}`;
    }
  };
}

tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  
  qsa('.tab', tabs).forEach(t => t.classList.remove('is-active'));
  btn.classList.add('is-active');
  
  currentTf = btn.dataset.tf;
  renderData();
});

window.addEventListener('currency:change', async () => {
  allCoins = [];
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
  }, 120000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadData();
  }
});

loadData().then(scheduleRefresh);
