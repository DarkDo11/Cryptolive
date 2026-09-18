import { initLayout, qs, debounce } from '../layout.js';
import { api } from '../api.js';
import { escapeHtml, fmtCurrency } from '../format.js';
import { changeBadge } from '../components.js';
import { settings } from '../store.js';
import { t } from '../i18n.js';

initLayout({ active: '' });

const searchInput = qs('#nfSearch');
const searchForm = qs('#nfSearchForm');
const searchResults = qs('#nfResults');
const trendingBlock = qs('#nfTrending');

const path = window.location.pathname;
const parts = path.split('/').filter(Boolean);
if (parts.length >= 2 && parts[0] === 'coin' && searchInput) {
  const segment = parts[parts.length - 1];
  try {
    searchInput.value = decodeURIComponent(segment).replace(/-/g, ' ');
  } catch (e) {}
}

async function loadTrending() {
  try {
    let fx = 1;
    try { fx = await api.fxRatio() || 1; } catch (e) {}
    const cur = settings.get().currency || 'usd';
    const data = await api.trending();
    
    if (data && data.coins && data.coins.length > 0) {
      const top6 = data.coins.slice(0, 6);
      let html = '';
      for (const c of top6) {
        html += `<a class="row" href="/coin/${escapeHtml(c.id)}">`;
        html += `<div class="left"><img src="${escapeHtml(c.thumb)}" width="24" height="24" alt=""><span class="name">${escapeHtml(c.name)}</span><span class="symbol chip">${escapeHtml(String(c.symbol)).toUpperCase()}</span></div>`;
        html += `<div class="right">`;
        if (c.price_usd != null) {
          html += `<span class="price">${fmtCurrency(c.price_usd * fx, cur)}</span>`;
        }
        if (c.change24h != null) {
          html += changeBadge(c.change24h);
        }
        html += `</div></a>`;
      }
      if (trendingBlock) trendingBlock.innerHTML = html;
    } else {
      hideTrending();
    }
  } catch (err) {
    hideTrending();
  }
}

function hideTrending() {
  if (trendingBlock) {
    const section = trendingBlock.closest('section');
    if (section) section.style.display = 'none';
  }
}

if (trendingBlock) loadTrending();

let searchReqId = 0;
let firstResultHref = '';

async function doSearch(query) {
  const reqId = ++searchReqId;
  if (query.length < 2) {
    if (searchResults) searchResults.innerHTML = '';
    firstResultHref = '';
    return;
  }
  
  try {
    let fx = 1;
    try { fx = await api.fxRatio() || 1; } catch (e) {}
    const cur = settings.get().currency || 'usd';
    const data = await api.search(query);
    
    if (reqId !== searchReqId) return;
    
    firstResultHref = '';
    let html = '';
    
    if (data.coins && data.coins.length > 0) {
      const coins = data.coins.slice(0, 5);
      if (!firstResultHref) firstResultHref = `/coin/${escapeHtml(coins[0].id)}`;
      for (const c of coins) {
        html += `<a class="row" href="/coin/${escapeHtml(c.id)}">`;
        html += `<div class="left"><img src="${escapeHtml(c.thumb)}" width="24" height="24" alt=""><span class="name">${escapeHtml(c.name)}</span><span class="symbol chip">${escapeHtml(String(c.symbol)).toUpperCase()}</span></div>`;
        html += `<div class="right">`;
        if (c.price_usd != null) {
          html += `<span class="price">${fmtCurrency(c.price_usd * fx, cur)}</span>`;
        }
        if (c.change24h != null) {
          html += changeBadge(c.change24h);
        }
        html += `</div></a>`;
      }
    }
    
    if (data.categories && data.categories.length > 0) {
      const cats = data.categories.slice(0, 3);
      if (!firstResultHref) firstResultHref = `/categories?c=${escapeHtml(cats[0].id)}`;
      for (const c of cats) {
        html += `<a class="row" href="/categories?c=${escapeHtml(c.id)}">`;
        html += `<div class="left"><span class="name">${escapeHtml(c.name)}</span><span class="symbol chip">${t('search.categories')}</span></div>`;
        html += `</a>`;
      }
    }
    
    if (data.exchanges && data.exchanges.length > 0) {
      const exchs = data.exchanges.slice(0, 3);
      if (!firstResultHref) firstResultHref = `/exchange/${escapeHtml(exchs[0].id)}`;
      for (const e of exchs) {
        html += `<a class="row" href="/exchange/${escapeHtml(e.id)}">`;
        html += `<div class="left"><img src="${escapeHtml(e.thumb)}" width="24" height="24" alt=""><span class="name">${escapeHtml(e.name)}</span><span class="symbol chip">${t('search.exchanges')}</span></div>`;
        html += `</a>`;
      }
    }
    
    if (searchResults) searchResults.innerHTML = html;
  } catch (err) {
    if (reqId === searchReqId) {
      if (searchResults) searchResults.innerHTML = '';
      firstResultHref = '';
    }
  }
}

if (searchInput) {
  searchInput.addEventListener('input', debounce((e) => {
    doSearch(e.target.value.trim());
  }, 250));
  
  if (searchInput.value.trim()) {
    doSearch(searchInput.value.trim());
  }
}

if (searchForm) {
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query.length < 2) return;
    
    // If we already have a result from typing, navigate directly.
    if (firstResultHref) {
      window.location.href = firstResultHref;
      return;
    }
    
    // Otherwise wait for the search to complete
    await doSearch(query);
    if (firstResultHref) {
      window.location.href = firstResultHref;
    }
  });
}
