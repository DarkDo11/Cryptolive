import { initLayout, qs, qsa } from '../layout.js';
import { api, normalizeCoin } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { renderCoinTable, skeletonRows } from '../components.js';
import { t } from '../i18n.js';

initLayout({ active: 'gainers-losers' });

const gainersTable = qs('#gainersTable');
const losersTable = qs('#losersTable');
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
      });
    }
  } catch (err) {
    console.error('Gainers/Losers load error', err);
  }
}

function renderData() {
  if (allCoins.length === 0) return;

  const validCoins = allCoins.filter(c => c.volume >= 50000 && typeof c[currentTf] === 'number' && isFinite(c[currentTf]));
  
  validCoins.sort((a, b) => b[currentTf] - a[currentTf]);
  
  const gainers = validCoins.slice(0, 20);
  const losers = validCoins.slice(-20).reverse();

  const cols = ['rank', 'coin', 'price', currentTf, 'volume', 'marketCap'];
  
  renderCoinTable(gainersTable, gainers, { columns: cols, sortable: false, fx });
  renderCoinTable(losersTable, losers, { columns: cols, sortable: false, fx });
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
