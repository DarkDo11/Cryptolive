import { initLayout, qs, qsa, toast, setTitle } from '../layout.js';
import { api, normalizeCoin } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { renderCoinTable, renderPagination, skeletonRows, sortCoins, changeBadge } from '../components.js';
import { settings, watchlist, recentCoins } from '../store.js';
import { fmtCurrency, fmtCompact, escapeHtml, fmtTime, toCsv, downloadCsv } from '../format.js';
import { t } from '../i18n.js';

initLayout({ active: 'markets' });
setTitle('Cryptocurrency Prices by Market Cap');

const urlParams = new URLSearchParams(window.location.search);
let page = parseInt(urlParams.get('page'), 10) || 1;
let perPage = settings.get().perPage || 100;
let tab = 'all'; // all, watchlist, gainers, losers
let sortKey = 'rank';
let sortDir = 'asc';
let filterText = '';
let coins = []; // normalized
let currentDisplayedCoins = [];
let watchlistRows = [];
let fx = 1;
let globalData = null;
let unsubLive = null;
let refreshTimer = null;
let mcapFilter = 'all';
let changeFilter = 'all';
let category = urlParams.get('category') || null;
let columnsState = settings.get().columns || ['change1h','change7d','volume','marketCap','sparkline'];
let topCategories = [];

const compareSelection = new Set();
const coinSymbols = new Map();

const heroSub = qs('#heroSub');
const highlights = qs('#highlights');
const trendingList = qs('#trendingList');
const gainersList = qs('#gainersList');
const losersList = qs('#losersList');
const tableSearch = qs('#tableSearch');
const perPageSelect = qs('#perPage');
const toggleHighlightsBtn = qs('#toggleHighlights');
const updatedAt = qs('#updatedAt');
const marketsTable = qs('#marketsTable');
const marketsPagination = qs('#marketsPagination');

const mcapFilterSelect = qs('#mcapFilter');
const changeFilterSelect = qs('#changeFilter');
const categoryChips = qs('#categoryChips');
const columnsBtn = qs('#columnsBtn');
const columnsPopover = qs('#columnsPopover');
const columnsCheckboxes = qsa('#columnsPopover input[type="checkbox"]');
const resetFiltersBtn = qs('#resetFiltersBtn');
const filterSummary = qs('#filterSummary');

function updateCompareBar() {
  const bar = qs('#compareBar');
  if (!bar) return;
  if (compareSelection.size === 0) {
    bar.hidden = true;
  } else {
    bar.hidden = false;
    const symbols = [...compareSelection].map(id => coinSymbols.get(id) || id);
    qs('#compareBarText').textContent = symbols.join(', ');
    qs('#compareBarLink').textContent = t('markets.compareSelected', { n: compareSelection.size });
    qs('#compareBarLink').href = `/compare?coins=${[...compareSelection].join(',')}`;
  }
}

qs('#compareBarClear')?.addEventListener('click', () => {
  compareSelection.clear();
  renderTable();
  updateCompareBar();
});

function renderCategoryChips() {
  let html = `<button type="button" class="chip-btn ${category === null ? 'is-active' : ''}" data-cat="all">${t('markets.all')}</button>`;
  topCategories.forEach(c => {
    const isActive = category === c.id;
    html += `<button type="button" class="chip-btn ${isActive ? 'is-active' : ''}" data-cat="${escapeHtml(c.id)}">${escapeHtml(c.name)}${isActive ? ' <span style="margin-left:4px;">&times;</span>' : ''}</button>`;
  });
  categoryChips.innerHTML = html;
}

api.categories().then(cats => {
  topCategories = [...cats].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0)).slice(0, 8);
  renderCategoryChips();
}).catch(() => {
  categoryChips.style.display = 'none';
});

categoryChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip-btn');
  if (!btn) return;
  const cat = btn.dataset.cat;
  category = cat === 'all' ? null : cat;
  page = 1;
  updateUrl();
  renderCategoryChips();
  load();
});

columnsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  columnsPopover.style.display = columnsPopover.style.display === 'none' ? 'block' : 'none';
});

document.addEventListener('click', (e) => {
  if (!columnsPopover.contains(e.target) && e.target !== columnsBtn) {
    columnsPopover.style.display = 'none';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    columnsPopover.style.display = 'none';
  }
});

columnsCheckboxes.forEach(cb => {
  cb.checked = columnsState.includes(cb.value);
  cb.addEventListener('change', () => {
    columnsState = Array.from(columnsCheckboxes).filter(c => c.checked).map(c => c.value);
    settings.set({ columns: columnsState });
    renderTable();
  });
});

mcapFilterSelect.value = mcapFilter;
mcapFilterSelect.addEventListener('change', (e) => {
  mcapFilter = e.target.value;
  renderTable();
});

changeFilterSelect.value = changeFilter;
changeFilterSelect.addEventListener('change', (e) => {
  changeFilter = e.target.value;
  renderTable();
});

resetFiltersBtn.addEventListener('click', () => {
  const wasCategory = !!category;
  mcapFilter = 'all';
  changeFilter = 'all';
  category = null;
  filterText = '';
  
  mcapFilterSelect.value = mcapFilter;
  changeFilterSelect.value = changeFilter;
  tableSearch.value = '';
  
  updateUrl();
  renderCategoryChips();
  
  if (wasCategory) {
    load();
  } else {
    renderTable();
  }
});

// Setup UI State
let hideHighlights = settings.get().hideHighlights || false;
function applyHighlightsState() {
  if (hideHighlights) {
    highlights.classList.add('is-hidden');
    toggleHighlightsBtn.textContent = t('markets.showHighlights');
  } else {
    highlights.classList.remove('is-hidden');
    toggleHighlightsBtn.textContent = t('markets.hideHighlights');
  }
}
applyHighlightsState();

toggleHighlightsBtn.addEventListener('click', () => {
  hideHighlights = !hideHighlights;
  settings.set({ hideHighlights });
  applyHighlightsState();
});

perPageSelect.value = perPage;
perPageSelect.addEventListener('change', (e) => {
  perPage = parseInt(e.target.value, 10);
  settings.set({ perPage });
  page = 1;
  updateUrl();
  load();
});

tableSearch.addEventListener('input', (e) => {
  filterText = e.target.value.trim().toLowerCase();
  renderTable();
});

async function loadWatchlistRows() {
  const ids = watchlist.list();
  if (ids.length > 0) {
    try {
      const rows = await api.markets({ ids: ids.join(','), perPage: 250 });
      watchlistRows = rows.map(normalizeCoin);
    } catch (e) {
      // ignore
    }
    if (tab === 'watchlist') renderTable();
  } else {
    watchlistRows = [];
    if (tab === 'watchlist') renderTable();
  }
}

qsa('.tab').forEach(t => {
  t.addEventListener('click', (e) => {
    qsa('.tab').forEach(el => el.classList.remove('is-active'));
    t.classList.add('is-active');
    tab = t.dataset.tab;
    
    // Reset sort when switching tabs if appropriate, but keeping it simple for now
    if (tab === 'gainers') { sortKey = 'change24h'; sortDir = 'desc'; }
    else if (tab === 'losers') { sortKey = 'change24h'; sortDir = 'asc'; }
    else if (tab === 'watchlist' || tab === 'all') { sortKey = 'rank'; sortDir = 'asc'; }
    
    if (tab === 'watchlist') {
      loadWatchlistRows();
      return; // wait for fetch
    }
    
    renderTable();
  });
});

function updateUrl() {
  const url = new URL(window.location);
  if (category) {
    url.searchParams.set('category', category);
    url.searchParams.delete('page');
  } else {
    url.searchParams.delete('category');
    if (page > 1) {
      url.searchParams.set('page', page);
    } else {
      url.searchParams.delete('page');
    }
  }
  window.history.replaceState(null, '', url.toString());
}

/** "Recently viewed" chips above the table (ids from localStorage, prices from the universe). */
async function renderRecent() {
  const strip = qs('#recentStrip');
  const box = qs('#recentChips');
  if (!strip || !box) return;
  const ids = recentCoins.list();
  if (ids.length === 0) { strip.hidden = true; box.innerHTML = ''; return; }
  const cur = settings.get().currency || 'usd';
  let rows = [];
  try { rows = await api.markets({ ids: ids.join(','), perPage: 50 }); } catch { rows = []; }
  const byId = new Map(rows.map(r => [r.id, r]));
  const chips = ids.map(id => byId.get(id)).filter(Boolean);
  if (chips.length === 0) { strip.hidden = true; return; }
  const ratio = Number.isFinite(fx) && fx > 0 ? fx : 1;
  box.innerHTML = chips.map(c => `
    <a class="recent-chip" href="/coin/${encodeURIComponent(c.id)}">
      <img src="${escapeHtml(c.image || '')}" alt="" width="18" height="18" loading="lazy">
      <span class="recent-sym">${escapeHtml(String(c.symbol || '').toUpperCase())}</span>
      <span class="recent-price" data-live-price="${escapeHtml(c.id)}" data-price-usd="${c.current_price / ratio}">${fmtCurrency(c.current_price, cur)}</span>
      ${changeBadge(c.price_change_percentage_24h, `data-live-change="${escapeHtml(c.id)}"`)}
    </a>`).join('');
  strip.hidden = false;
}

qs('#recentClear')?.addEventListener('click', () => { recentCoins.clear(); renderRecent(); });

function renderHighlightRow(id, name, symbol, image, priceUsd, change24h) {
  const cur = settings.get().currency || 'usd';
  const price = priceUsd * fx;
  return `
    <a href="/coin/${escapeHtml(id)}" class="row highlight-row" style="text-decoration:none;">
      <div class="left">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy">
        <span class="name" style="color:var(--text);">${escapeHtml(name)}</span>
        <span class="symbol chip">${escapeHtml(symbol)}</span>
      </div>
      <div class="right">
        <div class="price" style="font-weight:600; color:var(--text);" data-live-price="${escapeHtml(id)}" data-price-usd="${priceUsd}">${fmtCurrency(price, cur)}</div>
        ${changeBadge(change24h, `data-live-change="${escapeHtml(id)}"`)}
      </div>
    </a>
  `;
}

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  // Keep the server-rendered table (data-ssr) visible until real data arrives; skeleton only on later reloads.
  if (!marketsTable.dataset.ssr || marketsTable.dataset.ssrConsumed) marketsTable.innerHTML = `<div class="table-frame"><table class="data-table"><thead><tr><th></th><th>#</th><th>${t('js.coin')}</th><th>${t('js.price')}</th><th>1h %</th><th>${t('js.24h')}</th><th>7d %</th><th>${t('js.24h_volume')}</th><th>${t('js.market_cap')}</th><th>${t('js.last_7_days')}</th></tr></thead><tbody>${skeletonRows(10, 10)}</tbody></table></div>`;
  marketsPagination.innerHTML = '';
  updatedAt.textContent = t('markets.updating');

  try {
    fx = await api.fxRatio();
    if (seq !== loadSeq) return;
    
    const [globalRes, trendingRes, marketsRes] = await Promise.allSettled([
      api.global(),
      api.trending(),
      category ? api.markets({ category, perPage }) : api.markets({ page, perPage })
    ]);
    if (seq !== loadSeq) return;

    if (marketsRes.status === 'rejected') {
      throw marketsRes.reason;
    }

    if (globalRes.status === 'fulfilled' && globalRes.value?.data) {
      globalData = globalRes.value.data;
      const cur = settings.get().currency || 'usd';
      const mcap = globalData.total_market_cap[cur] || globalData.total_market_cap['usd'];
      const change = globalData.market_cap_change_percentage_24h_usd;
      heroSub.innerHTML = t('markets.heroSentence', { mcap: fmtCompact(mcap, cur), change: changeBadge(change) });
    }

    if (trendingRes.status === 'fulfilled' && trendingRes.value?.coins) {
      trendingList.innerHTML = trendingRes.value.coins.slice(0, 6).map(c => 
        renderHighlightRow(c.id, c.name, c.symbol, c.thumb, c.price_usd, c.change24h)
      ).join('');
    }

    coins = marketsRes.value.map(normalizeCoin);
    coins.forEach(c => coinSymbols.set(c.id, (c.symbol || '').toUpperCase()));

    // Compute gainers and losers from loaded coins
    const volFiltered = coins.filter(c => (c.volume || 0) > 50000 && c.change24h != null);
    const sortedByChange = [...volFiltered].sort((a, b) => b.change24h - a.change24h);
    
    gainersList.innerHTML = sortedByChange.slice(0, 6).map(c => 
      renderHighlightRow(c.id, c.name, c.symbol, c.image, (c.price || 0) / fx, c.change24h)
    ).join('');
    
    losersList.innerHTML = sortedByChange.slice(-6).reverse().map(c => 
      renderHighlightRow(c.id, c.name, c.symbol, c.image, (c.price || 0) / fx, c.change24h)
    ).join('');

    renderTable();
    updatedAt.textContent = t('common.updated', { time: fmtTime(Date.now()) });
    renderRecent().catch(() => {});

    if (!unsubLive) {
      unsubLive = live.subscribe(tick => {
        applyLiveTick(qs('#marketsTable'), tick, fx);
        applyLiveTick(qs('#highlights'), tick, fx);
        applyLiveTick(qs('#recentStrip'), tick, fx);
      });
    }

  } catch (err) {
    console.error('Failed to load markets', err);
    marketsTable.innerHTML = `
      <div class="card" style="padding: 32px; text-align: center;">
        <p style="color: var(--red); margin-bottom: 16px;">${t('markets.failedToLoad')}${err && err.message ? ` — ${escapeHtml(err.message)}` : ""}</p>
        <button class="btn btn-primary" id="retryBtn">${t('common.retry')}</button>
      </div>
    `;
    qs('#retryBtn')?.addEventListener('click', load);
    updatedAt.textContent = t('markets.updateFailed');
  }
}

function renderTable() {
  let filtered;
  if (tab === 'watchlist') {
    const ids = watchlist.list();
    const wMap = new Map();
    watchlistRows.forEach(c => {
      if (ids.includes(c.id)) wMap.set(c.id, c);
    });
    coins.forEach(c => {
      if (ids.includes(c.id) && !wMap.has(c.id)) wMap.set(c.id, c);
    });
    filtered = Array.from(wMap.values());
  } else {
    filtered = [...coins];
  }

  if (mcapFilter !== 'all') {
    filtered = filtered.filter(c => {
      const mc = (c.marketCap || 0) / fx;
      if (mcapFilter === 'large') return mc > 1e10;
      if (mcapFilter === 'mid') return mc >= 1e9 && mc <= 1e10;
      if (mcapFilter === 'small') return mc >= 1e8 && mc < 1e9;
      if (mcapFilter === 'micro') return mc < 1e8;
      return true;
    });
  }

  if (changeFilter !== 'all') {
    filtered = filtered.filter(c => {
      const chg = c.change24h || 0;
      if (changeFilter === 'up') return chg > 0;
      if (changeFilter === 'down') return chg < 0;
      if (changeFilter === 'up5') return chg > 5;
      if (changeFilter === 'down5') return chg < -5;
      return true;
    });
  }

  if (tab === 'gainers') {
    filtered = filtered.filter(c => (c.change24h || 0) > 0);
  } else if (tab === 'losers') {
    filtered = filtered.filter(c => (c.change24h || 0) < 0);
  }

  if (filterText) {
    filtered = filtered.filter(c => 
      (c.name || '').toLowerCase().includes(filterText) || 
      (c.symbol || '').toLowerCase().includes(filterText)
    );
  }

  filtered = sortCoins(filtered, sortKey, sortDir);
  currentDisplayedCoins = filtered;

  if (filtered.length < coins.length) {
    filterSummary.textContent = t('markets.showingOf', { shown: filtered.length, total: coins.length });
    filterSummary.style.display = 'inline';
  } else {
    filterSummary.style.display = 'none';
  }

  if (mcapFilter !== 'all' || changeFilter !== 'all' || category || filterText) {
    resetFiltersBtn.style.display = 'inline-block';
  } else {
    resetFiltersBtn.style.display = 'none';
  }

  const canonicalCols = ['rank', 'coin', 'price', 'change1h', 'change24h', 'change7d', 'volume', 'marketCap', 'sparkline'];
  const mandatoryCols = ['rank', 'coin', 'price', 'change24h'];
  const cols = canonicalCols.filter(c => mandatoryCols.includes(c) || columnsState.includes(c));

  marketsTable.dataset.ssrConsumed = '1';
  renderCoinTable(marketsTable, filtered, {
    fx,
    expandable: true,
    sortKey,
    sortDir,
    columns: cols,
    selectable: true,
    selected: compareSelection,
    onSelect: (id, checked) => {
      if (checked) {
        if (compareSelection.size >= 4) {
          toast(t('markets.selectHint'), { type: 'info' });
          renderTable();
          return;
        }
        compareSelection.add(id);
      } else {
        compareSelection.delete(id);
      }
      updateCompareBar();
    },
    onSort: (key) => {
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = key === 'name' || key === 'rank' ? 'asc' : 'desc';
      }
      renderTable();
    }
  });

  if (tab === 'all' && !filterText && !category) {
    const totalCoins = globalData?.active_cryptocurrencies || 10000;
    const totalPagesVal = Math.min(100, Math.ceil(totalCoins / perPage));
    renderPagination(marketsPagination, {
      page,
      totalPages: totalPagesVal,
      onChange: (newPage) => {
        page = newPage;
        updateUrl();
        window.scrollTo({ top: marketsTable.offsetTop - 100, behavior: 'smooth' });
        load();
      }
    });
  } else {
    marketsPagination.innerHTML = '';
  }
}

window.addEventListener('currency:change', () => {
  loadWatchlistRows();
  load();
});

window.addEventListener('watchlist:change', () => {
  if (tab === 'watchlist') {
    loadWatchlistRows();
  } else {
    // Re-render table just to update star icons
    renderTable();
  }
});

qs('#exportCsvBtn')?.addEventListener('click', () => {
  const cur = (settings.get().currency || 'usd').toUpperCase();
  const headers = ['Rank', 'Name', 'Symbol', `Price (${cur})`, '1h %', '24h %', '7d %', `24h Volume (${cur})`, `Market Cap (${cur})`];
  const rows = currentDisplayedCoins.map(c => [
    c.rank,
    c.name,
    (c.symbol || '').toUpperCase(),
    c.price,
    c.change1h,
    c.change24h,
    c.change7d,
    c.volume,
    c.marketCap
  ]);
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadCsv(`cryptolive-markets-${dateStr}.csv`, toCsv(headers, rows));
});

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      load().then(scheduleRefresh);
    } else {
      scheduleRefresh();
    }
  }, 60000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    load();
  }
});

load().then(scheduleRefresh);
