import { initLayout, qs, debounce, setTitle } from '../layout.js';
import { api, normalizeCoin } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { renderCoinTable, skeletonRows, sortCoins, changeBadge, bindSortableTable } from '../components.js';
import { fmtCurrency, escapeHtml, fmtCompact } from '../format.js';
import { settings } from '../store.js';
import { t } from '../i18n.js';

initLayout({ active: 'categories' });

const catListView = qs('#catListView');
const catTable = qs('#catTable');
const catSearch = qs('#catSearch');

const catDetail = qs('#catDetail');
const catBackBtn = qs('#catBackBtn');
const catDetailTitle = qs('#catDetailTitle');
const catCoins = qs('#catCoins');

let categoriesData = [];
let sortKey = 'marketCap';
let sortDir = 'desc';
let fx = 1;
let filterText = '';

let detailUnsubLive = null;
let currentCatId = null;
let detailCoinsData = [];
let detailSortKey = 'marketCap';
let detailSortDir = 'desc';

async function loadCategories() {
  catTable.innerHTML = `
    <div class="table-frame">
      <table class="data-table is-plain">
        <thead><tr><th>#</th><th>${t('js.category')}</th><th>${t('js.top_3_coins')}</th><th>24h %</th><th>${t('js.market_cap')}</th><th>24h Volume</th></tr></thead>
        <tbody>${skeletonRows(20, 6)}</tbody>
      </table>
    </div>
  `;
  
  try {
    const [fxRatio, cats] = await Promise.all([
      api.fxRatio(),
      api.categories()
    ]);
    fx = fxRatio;
    
    // Map to camelCase keys for sortCoins and consistency
    categoriesData = cats.map((c, i) => ({
      id: c.id,
      name: c.name,
      top3: c.top_3_coins || [],
      change24h: c.market_cap_change_24h,
      marketCap: c.market_cap,
      volume: c.volume_24h,
      originalRank: i + 1
    }));
    
    renderCategories();
  } catch (err) {
    console.error('Categories load error', err);
    catTable.innerHTML = `
      <div class="card" style="padding: 32px; text-align: center;">
        <p style="color: var(--red); margin-bottom: 16px;">${t('js.failed_to_load_categories')}</p>
        <button class="btn btn-primary" data-action="retry">Retry</button>
      </div>
    `;
  }
}

function renderCategories() {
  const cur = settings.get().currency || 'usd';
  let filtered = categoriesData;
  if (filterText) {
    const lower = filterText.toLowerCase();
    filtered = filtered.filter(c => c.name.toLowerCase().includes(lower));
  }
  
  filtered = sortCoins(filtered, sortKey, sortDir);
  
  const th = (label, key) => {
    let cls = 'is-sortable';
    let aria = 'none';
    if (sortKey === key) {
      cls += sortDir === 'asc' ? ' sort-asc' : ' sort-desc';
      aria = sortDir === 'asc' ? 'ascending' : 'descending';
    }
    return `<th class="${cls}" data-sort="${key}" aria-sort="${aria}">${escapeHtml(label)}</th>`;
  };

  let tbody = '';
  filtered.forEach((c, i) => {
    const thumbs = c.top3.map(url => `<img src="${escapeHtml(url)}" loading="lazy" referrerpolicy="no-referrer" width="20" height="20">`).join('');
    
    tbody += `<tr data-cat-id="${escapeHtml(c.id)}" tabindex="0" style="cursor:pointer">
      <td>${i + 1}</td>
      <td style="font-weight: 500;">${escapeHtml(c.name)}</td>
      <td><div class="thumb-stack" style="display:flex; align-items:center;">${thumbs}</div></td>
      <td>${changeBadge(c.change24h)}</td>
      <td>${fmtCurrency((c.marketCap || 0) * fx, cur, { compact: false })}</td>
      <td>${fmtCurrency((c.volume || 0) * fx, cur, { compact: false })}</td>
    </tr>`;
  });

  catTable.innerHTML = `
    <div class="table-frame">
      <table class="data-table is-plain">
        <thead>
          <tr>
            <th>#</th>
            ${th('Category', 'name')}
            <th>${t('js.top_3_coins')}</th>
            ${th('24h %', 'change24h')}
            ${th('Market Cap', 'marketCap')}
            ${th('24h Volume', 'volume')}
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
  
  bindSortableTable(catTable, (key) => {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'desc';
    }
    renderCategories();
  });
  
  // Delegated events
  if (catTable.__catHandler) {
    catTable.removeEventListener('click', catTable.__catHandler);
    catTable.removeEventListener('keydown', catTable.__catKeyHandler);
  }
  
  catTable.__catHandler = (e) => {
    const row = e.target.closest('tr[data-cat-id]');
    if (row && catTable.contains(row)) {
      openCategory(row.dataset.catId);
    }
  };
  
  catTable.__catKeyHandler = (e) => {
    if (e.key === 'Enter') {
      const row = e.target.closest('tr[data-cat-id]');
      if (row && catTable.contains(row)) {
        e.preventDefault();
        openCategory(row.dataset.catId);
      }
    }
  };
  
  catTable.addEventListener('click', catTable.__catHandler);
  catTable.addEventListener('keydown', catTable.__catKeyHandler);
}

catSearch.addEventListener('input', debounce((e) => {
  filterText = e.target.value;
  renderCategories();
}, 250));

async function openCategory(id, isPopState = false) {
  if (!isPopState) {
    history.pushState({ catId: id }, '', `?c=${encodeURIComponent(id)}`);
  }
  
  currentCatId = id;
  catListView.hidden = true;
  catDetail.hidden = false;
  catCoins.innerHTML = `
    <div class="table-frame">
      <table class="data-table is-plain">
        <thead><tr><th>#</th><th>${t('js.coin')}</th><th>${t('js.price')}</th><th>1h %</th><th>24h %</th><th>7d %</th><th>24h Volume</th><th>${t('js.market_cap')}</th><th>${t('js.last_7_days')}</th></tr></thead>
        <tbody>${skeletonRows(20, 9)}</tbody>
      </table>
    </div>
  `;
  
  const cat = categoriesData.find(c => c.id === id);
  catDetailTitle.textContent = cat ? cat.name : id;
  setTitle(cat ? cat.name : 'Category');
  window.scrollTo(0, 0);

  try {
    if (detailUnsubLive) {
      detailUnsubLive();
      detailUnsubLive = null;
    }

    const [fxRatio, rows] = await Promise.all([
      api.fxRatio(),
      api.markets({ category: id, perPage: 100 })
    ]);
    
    fx = fxRatio;
    detailCoinsData = sortCoins(rows.map(normalizeCoin), detailSortKey, detailSortDir);
    
    renderDetailTable();
    
    detailUnsubLive = live.subscribe((tick) => applyLiveTick(catCoins, tick, fx));
  } catch (err) {
    console.error('Category detail error', err);
    catCoins.innerHTML = `
      <div style="padding: 32px; text-align: center;">
        <p style="color: var(--red); margin-bottom: 16px;">${t('js.failed_to_load_category_coins')}</p>
      </div>
    `;
  }
}

function renderDetailTable() {
  renderCoinTable(catCoins, detailCoinsData, {
    sortKey: detailSortKey,
    sortDir: detailSortDir,
    fx,
    onSort: (key) => {
      if (detailSortKey === key) {
        detailSortDir = detailSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        detailSortKey = key;
        detailSortDir = 'desc';
      }
      detailCoinsData = sortCoins(detailCoinsData, detailSortKey, detailSortDir);
      renderDetailTable();
    }
  });
}

function closeCategory(isPopState = false) {
  if (!isPopState) {
    history.pushState(null, '', location.pathname);
  }
  currentCatId = null;
  catDetail.hidden = true;
  catListView.hidden = false;
  setTitle('Cryptocurrency Categories');
  if (detailUnsubLive) {
    detailUnsubLive();
    detailUnsubLive = null;
  }
}

catBackBtn.addEventListener('click', () => closeCategory(false));

window.addEventListener('popstate', (e) => {
  const urlParams = new URLSearchParams(window.location.search);
  const c = urlParams.get('c');
  if (c) {
    openCategory(c, true);
  } else {
    closeCategory(true);
  }
});

window.addEventListener('currency:change', async () => {
  categoriesData = [];
  if (!currentCatId) {
    await loadCategories();
  } else {
    await Promise.all([loadCategories(), openCategory(currentCatId, true)]);
  }
});

// Init
const urlParams = new URLSearchParams(window.location.search);
const initC = urlParams.get('c');

loadCategories().then(() => {
  if (initC) {
    openCategory(initC, true);
  }
});
