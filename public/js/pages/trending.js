import { initLayout, qs, qsa } from '../layout.js';
import { api } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { changeBadge, skeletonRows, emptyState } from '../components.js';
import { fmtCurrency, fmtCompact, escapeHtml } from '../format.js';
import { settings, watchlist } from '../store.js';
import { t } from '../i18n.js';

initLayout({ active: 'trending' });

const tabsContainer = qs('#trendingTabs');
const tabCoins = qs('#tabCoins');
const tabCategories = qs('#tabCategories');
const tabNfts = qs('#tabNfts');

const coinsTbody = qs('#coinsTable tbody');
const categoriesTbody = qs('#categoriesTable tbody');
const nftsTbody = qs('#nftsTable tbody');

let fx = 1;
let trendingData = null;
let unsubLive = null;
let refreshTimer = null;
let activeTab = 'coins';

function updateHash() {
  window.location.hash = activeTab;
}

function readHash() {
  const h = window.location.hash.replace('#', '');
  if (['coins', 'categories', 'nfts'].includes(h)) {
    activeTab = h;
  } else {
    activeTab = 'coins';
  }
}

function updateTabsUI() {
  qsa('.tab', tabsContainer).forEach(t => t.classList.remove('is-active'));
  const activeTabEl = qs(`.tab[data-tab="${activeTab}"]`, tabsContainer);
  if (activeTabEl) activeTabEl.classList.add('is-active');

  tabCoins.style.display = activeTab === 'coins' ? '' : 'none';
  tabCategories.style.display = activeTab === 'categories' ? '' : 'none';
  tabNfts.style.display = activeTab === 'nfts' ? '' : 'none';
}

tabsContainer.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  activeTab = tab.dataset.tab;
  updateHash();
  updateTabsUI();
});

function showSkeletons() {
  if (!trendingData) {
    coinsTbody.innerHTML = skeletonRows(15, 8);
    categoriesTbody.innerHTML = skeletonRows(15, 6);
    nftsTbody.innerHTML = skeletonRows(15, 6);
  }
}

function renderError(err) {
  const html = `
    <tr>
      <td colspan="10" style="text-align: center; padding: 48px 24px;">
        <h3 style="color: var(--red); margin-bottom: 8px;">${t('js.error')}</h3>
        <p style="color: var(--muted); margin-bottom: 16px;">${escapeHtml(err.message || 'Unknown error')}</p>
        <button class="btn btn-primary" data-action="retry">${t('js.retry')}</button>
      </td>
    </tr>
  `;
  coinsTbody.innerHTML = html;
  categoriesTbody.innerHTML = html;
  nftsTbody.innerHTML = html;

  qsa('[data-action="retry"]').forEach(btn => {
    btn.addEventListener('click', () => loadData());
  });
}

function renderCoins() {
  if (!trendingData || !trendingData.coins || trendingData.coins.length === 0) {
    coinsTbody.innerHTML = `<tr><td colspan="8">${emptyState(t('js.no_trending_coins_found'), '')}</td></tr>`;
    return;
  }

  const cur = settings.get().currency || 'usd';
  let html = '';
  trendingData.coins.forEach((c, index) => {
    const isStar = watchlist.has(c.id);
    const starActive = isStar ? 'is-active' : '';
    const starPressed = isStar ? 'true' : 'false';
    const starFill = isStar ? 'currentColor' : 'none';
    const priceDisplay = (c.price_usd || 0) * fx;
    
    html += `<tr data-coin-id="${escapeHtml(c.id)}" style="cursor:pointer;">`;
    html += `<td class="col-star"><button type="button" class="star-btn ${starActive}" data-id="${escapeHtml(c.id)}" aria-label="Toggle watchlist" aria-pressed="${starPressed}"><svg width="16" height="16" viewBox="0 0 24 24" fill="${starFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button></td>`;
    html += `<td class="col-num">${index + 1}</td>`;
    
    html += `
      <td class="col-coin is-sticky">
        <a class="asset-cell" href="/coin/${escapeHtml(c.id)}">
          <img class="asset-logo" src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.name)}" loading="lazy" referrerpolicy="no-referrer">
          <span class="asset-copy">
            <span class="asset-name" style="display: flex; align-items: center; gap: 6px;">
              ${escapeHtml(c.name)}
              ${c.rank ? `<span class="chip" style="font-size: 0.7rem; padding: 2px 6px; background: var(--panel-raised); border-radius: 4px; color: var(--muted);">#${escapeHtml(String(c.rank))}</span>` : ''}
            </span>
            <span class="asset-symbol">${escapeHtml(c.symbol)}</span>
          </span>
        </a>
      </td>
    `;
    
    html += `<td class="price-cell col-price" data-live-price="${escapeHtml(c.id)}" data-price-usd="${c.price_usd}">${fmtCurrency(priceDisplay, cur)}</td>`;
    html += `<td class="col-change24h">${changeBadge(c.change24h, `data-live-change="${escapeHtml(c.id)}"`)}</td>`;
    html += `<td class="col-volume">${fmtCurrency((c.volume_usd || 0) * fx, cur, { compact: false })}</td>`;
    html += `<td class="col-marketCap">${fmtCurrency((c.market_cap_usd || 0) * fx, cur, { compact: false })}</td>`;
    html += `<td class="col-sparkline">${c.sparkline_url ? `<img class="sparkline-img" src="${escapeHtml(c.sparkline_url)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : '<span class="muted">—</span>'}</td>`;
    
    html += `</tr>`;
  });
  coinsTbody.innerHTML = html;
}

function renderCategories() {
  if (!trendingData || !trendingData.categories || trendingData.categories.length === 0) {
    categoriesTbody.innerHTML = `<tr><td colspan="6">${emptyState(t('js.no_trending_categories_found'), '')}</td></tr>`;
    return;
  }

  const cur = settings.get().currency || 'usd';
  let html = '';
  trendingData.categories.forEach((c, index) => {
    html += `<tr>`;
    html += `<td class="col-num">${index + 1}</td>`;
    html += `
      <td class="col-coin is-sticky">
        <a class="asset-cell" href="/categories?c=${escapeHtml(c.slug)}">
          <span class="asset-copy">
            <span class="asset-name">${escapeHtml(c.name)}</span>
          </span>
        </a>
      </td>
    `;
    html += `<td>${escapeHtml(String(c.coins_count))}</td>`;
    html += `<td class="col-marketCap">${fmtCompact((c.market_cap_usd || 0) * fx, cur)}</td>`;
    html += `<td class="col-change24h">${changeBadge(c.change24h)}</td>`;
    html += `<td class="col-sparkline">${c.sparkline_url ? `<img class="sparkline-img" src="${escapeHtml(c.sparkline_url)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : '<span class="muted">—</span>'}</td>`;
    html += `</tr>`;
  });
  categoriesTbody.innerHTML = html;
}

function renderNfts() {
  if (!trendingData || !trendingData.nfts || trendingData.nfts.length === 0) {
    nftsTbody.innerHTML = `<tr><td colspan="6">${emptyState(t('js.no_trending_nfts_found'), '')}</td></tr>`;
    return;
  }

  let html = '';
  trendingData.nfts.forEach((c, index) => {
    const floorStr = c.floor_price ? String(c.floor_price) : (c.floor_native != null && c.native_symbol ? `${c.floor_native} ${c.native_symbol.toUpperCase()}` : '—');
    html += `<tr>`;
    html += `<td class="col-num">${index + 1}</td>`;
    html += `
      <td class="col-coin is-sticky">
        <div class="asset-cell">
          <img class="asset-logo" src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.name)}" loading="lazy" referrerpolicy="no-referrer">
          <span class="asset-copy">
            <span class="asset-name">${escapeHtml(c.name)}</span>
            <span class="asset-symbol">${escapeHtml(c.symbol)}</span>
          </span>
        </div>
      </td>
    `;
    html += `<td class="price-cell col-price">${escapeHtml(floorStr)}</td>`;
    html += `<td class="col-change24h">${changeBadge(c.change24h)}</td>`;
    html += `<td class="col-volume">${escapeHtml(String(c.volume_24h || '—'))}</td>`;
    html += `<td class="col-sparkline">${c.sparkline_url ? `<img class="sparkline-img" src="${escapeHtml(c.sparkline_url)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : '<span class="muted">—</span>'}</td>`;
    html += `</tr>`;
  });
  nftsTbody.innerHTML = html;
}

function renderData() {
  renderCoins();
  renderCategories();
  renderNfts();
}

async function loadData() {
  showSkeletons();
  try {
    const [fxRatio, data] = await Promise.all([
      api.fxRatio(),
      api.trending()
    ]);
    fx = fxRatio || 1;
    trendingData = data;
    renderData();

    if (!unsubLive) {
      unsubLive = live.subscribe((tick) => {
        applyLiveTick(tabCoins, tick, fx);
      });
    }
  } catch (err) {
    console.error('Trending load error', err);
    renderError(err);
  }
}

// Delegated events for coins table
qs('#coinsTable').addEventListener('click', (e) => {
  const starBtn = e.target.closest('button.star-btn');
  if (starBtn) {
    e.preventDefault();
    e.stopPropagation();
    const id = starBtn.dataset.id;
    if (id) {
      watchlist.toggle(id);
      const isActive = watchlist.has(id);
      starBtn.classList.toggle('is-active', isActive);
      starBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      const svg = starBtn.querySelector('svg');
      if (svg) svg.setAttribute('fill', isActive ? 'currentColor' : 'none');
    }
    return;
  }

  if (e.target.closest('a, button')) return;

  const row = e.target.closest('tr[data-coin-id]');
  if (row) {
    const id = row.dataset.coinId;
    if (id) {
      location.href = `/coin/${id}`;
    }
  }
});

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      loadData().then(scheduleRefresh);
    } else {
      scheduleRefresh();
    }
  }, 300000); // 300s = 5 minutes
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadData();
  }
});

window.addEventListener('currency:change', async () => {
  trendingData = null; // show skeletons while reloading
  await loadData();
});

readHash();
updateTabsUI();
loadData().then(scheduleRefresh);
