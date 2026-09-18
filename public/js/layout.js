import { settings, watchlist } from './store.js';
import { api } from './api.js';
import { live } from './live.js';
import { fmtCurrency, fmtCompact, fmtNumber, escapeHtml, fmtPercent } from './format.js';
import { changeBadge } from './components.js';
import { startAlertEngine, alerts } from './alerts.js';
import { t, getLang, setLang, LANGS, applyTranslations, fngLabel } from './i18n.js';

export const qs = (s, ctx = document) => ctx.querySelector(s);
export const qsa = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));

export function debounce(fn, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function setTitle(text) {
  document.title = `${text} · Cryptolive`;
}

let toastStack;
export function toast(message, { type = 'info' } = {}) {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    toastStack.setAttribute('role', 'status');
    toastStack.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastStack);
  }
  
  const el = document.createElement('div');
  el.className = `toast is-${type}`;
  el.textContent = message;
  toastStack.appendChild(el);
  
  if (toastStack.children.length > 3) {
    toastStack.removeChild(toastStack.firstChild);
  }
  
  setTimeout(() => {
    if (el.parentNode === toastStack) {
      el.remove();
    }
  }, 3500);
}

function renderHeader(active) {
  let theme = settings.get().theme;
  if (!theme && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
  
  return `
    <div class="header-inner">
      <a href="/" class="logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--blue)">
          <rect width="24" height="24" rx="6"/>
          <path d="M16 12a4 4 0 11-8 0 4 4 0 018 0z" fill="#fff"/>
        </svg>
        <span>Cryptolive</span>
      </a>
      <nav class="nav" id="mainNav">
        <a href="/" class="${active === 'markets' ? 'is-active' : ''}">${t('nav.markets')}</a>
        <a href="/overview" class="${active === 'overview' ? 'is-active' : ''}">${t('nav.overview')}</a>
        <a href="/trending" class="${active === 'trending' ? 'is-active' : ''}">${t('nav.trending')}</a>
        <a href="/heatmap" class="${active === 'heatmap' ? 'is-active' : ''}">${t('nav.heatmap')}</a>
        <a href="/watchlist" class="${active === 'watchlist' ? 'is-active' : ''}">
          ${t('nav.watchlist')} <span id="navWatchlistBadge" class="chip">0</span>
        </a>
        <a href="/portfolio" class="${active === 'portfolio' ? 'is-active' : ''}">${t('nav.portfolio')}</a>
        <div class="nav-more" id="navMore">
          <button type="button" class="nav-more-btn ${['gainers-losers','categories','exchanges','converter','compare','alerts'].includes(active) ? 'is-active' : ''}" id="navMoreBtn" aria-haspopup="true" aria-expanded="false">${t('nav.more')} <span class="caret" aria-hidden="true">▾</span></button>
          <div class="nav-more-menu" id="navMoreMenu" role="menu">
            <a href="/gainers-losers" class="${active === 'gainers-losers' ? 'is-active' : ''}">${t('nav.gainersLosers')}</a>
            <a href="/categories" class="${active === 'categories' ? 'is-active' : ''}">${t('nav.categories')}</a>
            <a href="/exchanges" class="${active === 'exchanges' ? 'is-active' : ''}">${t('nav.exchanges')}</a>
            <a href="/converter" class="${active === 'converter' ? 'is-active' : ''}">${t('nav.converter')}</a>
            <a href="/compare" class="${active === 'compare' ? 'is-active' : ''}">${t('nav.compare')}</a>
            <a href="/alerts" class="${active === 'alerts' ? 'is-active' : ''}">
              ${t('nav.alerts')} <span id="navAlertsBadge" class="chip">0</span>
            </a>
          </div>
        </div>
      </nav>
      <div class="header-actions">
        <button class="search-trigger" id="searchTrigger">
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>
          <span>${t('common.search')} ⌘K</span>
        </button>
        <select class="currency-select" id="currencySelect" aria-label="${t('nav.currency')}"></select>
        <select class="currency-select" id="langSelect" aria-label="${t('nav.language')}">
          ${LANGS.map(l => `<option value="${l.code}" title="${escapeHtml(l.label)}">${l.code.toUpperCase()}</option>`).join('')}
        </select>
        <a href="/settings" class="theme-toggle" aria-label="${t('nav.settings')}" style="margin-right:-4px;">
          <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.376l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/></svg>
        </a>
        <button class="theme-toggle" id="themeToggle" aria-label="${t('nav.toggleTheme')}">
          ${theme === 'light' ? '🌙' : '☀️'}
        </button>
        <div class="live-pill is-offline" id="liveStatus">
          <div class="dot"></div> Live
        </div>
        <button class="nav-burger" id="navBurger" aria-label="${t('nav.menu')}">☰</button>
      </div>
    </div>
  `;
}

function renderFooter() {
  return `
    <footer class="site-footer shell">
      <p>${t('footer.data')}</p>
      <p class="footer-links">
        <a href="/">${t('nav.markets')}</a> <a href="/overview">${t('nav.overview')}</a> <a href="/gainers-losers">${t('nav.gainersLosers')}</a>
        <a href="/heatmap">${t('nav.heatmap')}</a> <a href="/categories">${t('nav.categories')}</a> <a href="/exchanges">${t('nav.exchanges')}</a>
        <a href="/watchlist">${t('nav.watchlist')}</a> <a href="/portfolio">${t('nav.portfolio')}</a> <a href="/converter">${t('nav.converter')}</a>
        <a href="/compare">${t('nav.compare')}</a> <a href="/alerts">${t('nav.alerts')}</a>
      </p>
      <p>&copy; ${new Date().getFullYear()} Cryptolive &middot; <a href="/status">${t('footer.status')}</a> &middot; <a href="/api-docs">${t('footer.api')}</a></p>
    </footer>
  `;
}

async function loadTickerBar() {
  const bar = qs('.ticker-bar');
  if (!bar) return;

  bar.innerHTML = `
    <div class="ticker-item"><span class="ticker-label">${t('ticker.coins')}:</span><span class="ticker-value skeleton" style="width:40px"></span></div>
    <div class="ticker-item"><span class="ticker-label">${t('ticker.exchanges')}:</span><span class="ticker-value skeleton" style="width:40px"></span></div>
    <div class="ticker-item"><span class="ticker-label">${t('ticker.marketCap')}:</span><span class="ticker-value skeleton" style="width:80px"></span></div>
    <div class="ticker-item"><span class="ticker-label">${t('ticker.volume')}:</span><span class="ticker-value skeleton" style="width:80px"></span></div>
    <div class="ticker-item"><span class="ticker-label">${t('ticker.dominance')}:</span><span class="ticker-value skeleton" style="width:80px"></span></div>
    <div class="ticker-item"><span class="ticker-label">${t('ticker.fng')}:</span><span class="ticker-value skeleton" style="width:80px"></span></div>
  `;

  try {
    const [g, fng] = await Promise.all([
      api.global().catch(() => null),
      api.fng().catch(() => null)
    ]);
    
    if (g && g.data) {
      const d = g.data;
      const cur = settings.get().currency || 'usd';
      const mcap = d.total_market_cap[cur] || d.total_market_cap['usd'];
      const vol = d.total_volume[cur] || d.total_volume['usd'];
      const mcapChange = d.market_cap_change_percentage_24h_usd;
      const fngText = fng && Number.isFinite(fng.value) ? `${fng.value} &middot; ${escapeHtml(fngLabel(fng.classification))}` : '—';
      const fngClass = !fng || !Number.isFinite(fng.value) ? '' : fng.value >= 55 ? 'is-up' : fng.value <= 45 ? 'is-down' : '';
      
      bar.innerHTML = `
        <a href="/" class="ticker-item"><span class="ticker-label">${t('ticker.coins')}:</span> <span class="ticker-value">${fmtNumber(d.active_cryptocurrencies, { max: 0 })}</span></a>
        <a href="/exchanges" class="ticker-item"><span class="ticker-label">${t('ticker.exchanges')}:</span> <span class="ticker-value">${fmtNumber(d.markets, { max: 0 })}</span></a>
        <a href="/" class="ticker-item">
          <span class="ticker-label">${t('ticker.marketCap')}:</span> 
          <span class="ticker-value">${fmtCompact(mcap, cur)}</span>
          <span class="change-badge ${mcapChange >= 0 ? 'is-up' : 'is-down'}">${fmtPercent(mcapChange)}</span>
        </a>
        <a href="/" class="ticker-item"><span class="ticker-label">${t('ticker.volume')}:</span> <span class="ticker-value">${fmtCompact(vol, cur)}</span></a>
        <a href="/" class="ticker-item">
          <span class="ticker-label">${t('ticker.dominance')}:</span> 
          <span class="ticker-value">BTC ${fmtNumber(d.market_cap_percentage.btc, { max: 1 })}% &middot; ETH ${fmtNumber(d.market_cap_percentage.eth, { max: 1 })}%</span>
        </a>
        <a href="/" class="ticker-item"><span class="ticker-label">${t('ticker.fng')}:</span> <span class="ticker-value ${fngClass}">${fngText}</span></a>
      `;
    }
    if (!g || !g.data) {
      // Upstream unavailable: keep the strip compact instead of leaving skeletons forever.
      bar.innerHTML = `<span class="ticker-item"><span class="ticker-label">${t('ticker.unavailable')}</span></span>`;
    }
  } catch (e) {
    console.error('Ticker failed', e);
    bar.innerHTML = `<span class="ticker-item"><span class="ticker-label">${t('ticker.unavailable')}</span></span>`;
  }
}

async function populateCurrencies(selectEl) {
  try {
    const list = await api.currencies();
    selectEl.innerHTML = list.map(c => 
      `<option value="${escapeHtml(c.code)}" title="${escapeHtml(c.name)}">${escapeHtml(c.symbol)} ${escapeHtml(c.code.toUpperCase())}</option>`
    ).join('');
  } catch (e) {
    selectEl.innerHTML = `<option value="usd">USD</option><option value="eur">EUR</option>`;
  }
  selectEl.value = settings.get().currency || 'usd';
}

  const initSearchModal = () => {
    const modalHtml = `
      <div class="modal-backdrop" id="searchBackdrop" style="display:none">
        <div class="modal search-palette">
          <input type="text" id="searchInput" placeholder="${t('common.searchPlaceholder')}" autocomplete="off">
          <div class="search-results" id="searchResults"></div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    const backdrop = qs('#searchBackdrop');
    const input = qs('#searchInput');
    const results = qs('#searchResults');
    
    let activeIndex = -1;
    let items = [];
  
    const getRecent = () => { try { return JSON.parse(localStorage.getItem('cryptolive:recent-searches')) || []; } catch(e) { return []; } };
    const addRecent = (coin) => {
      let list = getRecent().filter(c => c.id !== coin.id);
      list.unshift(coin);
      if (list.length > 8) list = list.slice(0, 8);
      try { localStorage.setItem('cryptolive:recent-searches', JSON.stringify(list)); } catch(e){}
    };
    const clearRecent = (e) => {
      e.stopPropagation();
      e.preventDefault();
      try { localStorage.removeItem('cryptolive:recent-searches'); } catch(e){}
      doSearch('');
    };
  
    const renderItems = (sections) => {
      let html = '';
      items = [];
      let idx = 0;
      
      for (const [title, arr, renderFn, titleHtml] of sections) {
        if (!arr || arr.length === 0) continue;
        html += `<div class="search-section" style="display:flex; align-items:center;">${titleHtml || escapeHtml(title)}</div>`;
        for (const item of arr) {
          html += renderFn(item, idx);
          items.push({ elId: `si-${idx}`, url: item.url, rawItem: item });
          idx++;
        }
      }
      
      if (items.length === 0) {
        html = `<div class="empty-state">${t('search.noResults')}</div>`;
      }
      results.innerHTML = html;
      activeIndex = items.length ? 0 : -1;
      updateActive();
    };
  
    const doSearch = debounce(async (q) => {
      if (!q) {
        try {
          const sections = [];
          const recent = getRecent();
          if (recent.length > 0) {
            sections.push([
              t('search.recent'),
              recent.map(c => ({...c, url: `/coin/${encodeURIComponent(c.id)}`, isCoin: true})),
              (m, i) => `
                <a href="${m.url}" class="search-item" id="si-${i}">
                  <img src="${escapeHtml(m.thumb)}" width="24" height="24" style="border-radius:50%">
                  <span>${escapeHtml(m.name)}</span>
                  <span class="chip">${escapeHtml(m.symbol)}</span>
                </a>
              `,
              `${t('search.recent')} <span class="btn btn-ghost btn-sm" id="clearRecentBtn" style="margin-left:auto; font-size:0.7rem; padding:2px 4px; cursor:pointer">${t('search.clear')}</span>`
            ]);
          }
  
          const tr = await api.trending();
          if (tr && tr.coins) {
            const mapped = tr.coins.map(c => ({
              name: c.name,
              symbol: c.symbol,
              thumb: c.thumb,
              url: `/coin/${encodeURIComponent(c.id)}`,
              isCoin: true,
              id: c.id
            }));
            sections.push([t('search.trending'), mapped, (m, i) => `
              <a href="${m.url}" class="search-item" id="si-${i}">
                <img src="${escapeHtml(m.thumb)}" width="24" height="24" style="border-radius:50%">
                <span>${escapeHtml(m.name)}</span>
                <span class="chip">${escapeHtml(m.symbol)}</span>
              </a>
            `]);
          }
          renderItems(sections);
          const clearBtn = qs('#clearRecentBtn', results);
          if (clearBtn) clearBtn.addEventListener('click', clearRecent);
        } catch (e) {}
        return;
      }
  
      try {
        const searchCur = settings.get().currency || 'usd';
        const searchFx = await api.fxRatio().catch(() => 1);
        const res = await api.search(q);
        const sCoins = (res.coins || []).slice(0, 8).map(c => ({...c, url: `/coin/${c.id}`, isCoin: true}));
        const sCats = (res.categories || []).slice(0, 4).map(c => ({...c, url: `/categories?c=${c.id}`}));
        const sExchs = (res.exchanges || []).slice(0, 4).map(c => ({...c, url: `/exchange/${encodeURIComponent(c.id)}`}));
        
        renderItems([
          [t('search.coins'), sCoins, (m, i) => `
            <a href="${m.url}" class="search-item" id="si-${i}">
              <img src="${escapeHtml(m.thumb)}" width="24" height="24" style="border-radius:50%">
              <span>${escapeHtml(m.name)}</span>
              <span class="chip">${escapeHtml(m.symbol)}</span>
              <span class="search-meta">
                ${typeof m.price_usd === 'number' ? `<span class="search-price">${fmtCurrency(m.price_usd * searchFx, searchCur)}</span>` : ''}
                ${typeof m.change24h === 'number' ? changeBadge(m.change24h) : ''}
                <span class="search-rank">#${m.rank || '-'}</span>
              </span>
            </a>
          `],
          [t('search.categories'), sCats, (m, i) => `
            <a href="${m.url}" class="search-item" id="si-${i}">
              <span>${escapeHtml(m.name)}</span>
            </a>
          `],
          [t('search.exchanges'), sExchs, (m, i) => `
            <a href="${m.url}" class="search-item" id="si-${i}">
              <img src="${escapeHtml(m.thumb)}" width="24" height="24" style="border-radius:50%">
              <span>${escapeHtml(m.name)}</span>
            </a>
          `]
        ]);
      } catch (e) {
        console.error(e);
      }
    }, 250);

  const open = () => {
    backdrop.style.display = 'flex';
    input.value = '';
    doSearch('');
    setTimeout(() => input.focus(), 50);
  };
  
  const close = () => { backdrop.style.display = 'none'; };
  
  qs('#searchTrigger').addEventListener('click', open);
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close();
  });
  
  results.addEventListener('click', e => {
    const itemEl = e.target.closest('.search-item');
    if (itemEl) {
      const it = items.find(i => i.elId === itemEl.id);
      if (it && it.rawItem && it.rawItem.isCoin) {
        addRecent({
          id: it.rawItem.id,
          name: it.rawItem.name,
          symbol: it.rawItem.symbol,
          thumb: it.rawItem.thumb
        });
      }
    }
  });

  input.addEventListener('input', e => doSearch(e.target.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        const it = items[activeIndex];
        if (it.rawItem && it.rawItem.isCoin) {
          addRecent({
            id: it.rawItem.id,
            name: it.rawItem.name,
            symbol: it.rawItem.symbol,
            thumb: it.rawItem.thumb
          });
        }
        window.location.href = it.url;
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  
  function updateActive() {
    qsa('.search-item', results).forEach(el => el.classList.remove('is-active'));
    if (activeIndex >= 0 && items[activeIndex]) {
      const el = qs(`#${items[activeIndex].elId}`);
      if (el) {
        el.classList.add('is-active');
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      open();
    } else if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && backdrop.style.display === 'flex') {
      close();
    }
  });
}

// Generic "Retry" buttons rendered by pages: reload the page.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="retry"]')) location.reload();
});

// Offline banner: browsers know when the network is gone; show it once the layout is mounted.
function setupOfflineBanner() {
  let banner = null;
  const show = () => {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'offline-banner';
      banner.setAttribute('role', 'status');
      banner.textContent = t('common.offline');
      document.body.prepend(banner);
    }
    banner.hidden = false;
  };
  const hide = (announce) => {
    if (banner) banner.hidden = true;
    if (announce) toast(t('common.backOnline'), { type: 'success' });
  };
  window.addEventListener('offline', show);
  window.addEventListener('online', () => hide(true));
  window.addEventListener('api:offline-data', show);
  window.addEventListener('api:online-data', () => hide(true));
  if (navigator.onLine === false) show();
}
setupOfflineBanner();

// Keyboard shortcuts: "?" opens the cheat sheet, "g <key>" jumps between pages, "t" toggles the theme.
const SHORTCUT_TARGETS = { m: '/', o: '/overview', r: '/trending', h: '/heatmap', w: '/watchlist', p: '/portfolio', a: '/alerts', c: '/compare', e: '/exchanges', s: '/settings' };
let pendingG = 0;
function isTyping(e) {
  const tag = e.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
}
function shortcutsSheet() {
  let el = qs('#shortcutsBackdrop');
  if (el) return el;
  const rows = [
    ['⌘K /', t('shortcuts.search')],
    ['?', t('shortcuts.help')],
    ['t', t('shortcuts.theme')],
    ['g m', t('nav.markets')], ['g o', t('nav.overview')], ['g r', t('nav.trending')], ['g h', t('nav.heatmap')],
    ['g w', t('nav.watchlist')], ['g p', t('nav.portfolio')], ['g a', t('nav.alerts')], ['g c', t('nav.compare')],
    ['g e', t('nav.exchanges')], ['g s', t('nav.settings')],
    ['Esc', t('shortcuts.close')]
  ];
  el = document.createElement('div');
  el.className = 'modal-backdrop';
  el.id = 'shortcutsBackdrop';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="shortcutsTitle" style="max-width:520px">
      <div class="modal-head"><span id="shortcutsTitle">${t('shortcuts.title')}</span><button class="btn btn-ghost btn-sm" id="shortcutsClose" aria-label="${t('shortcuts.close')}">×</button></div>
      <div class="modal-body"><div class="shortcuts-grid">${rows.map(([k, label]) => `<div class="shortcut-row"><span>${escapeHtml(label)}</span><span class="shortcut-keys">${k.split(' ').map(x => `<kbd>${escapeHtml(x)}</kbd>`).join(' ')}</span></div>`).join('')}</div></div>
    </div>`;
  document.body.appendChild(el);
  const close = () => { el.style.display = 'none'; };
  qs('#shortcutsClose', el).addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  return el;
}
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
  const sheet = qs('#shortcutsBackdrop');
  if (e.key === 'Escape' && sheet && sheet.style.display === 'flex') { sheet.style.display = 'none'; return; }
  if (e.key === '?') { e.preventDefault(); const el = shortcutsSheet(); el.style.display = el.style.display === 'flex' ? 'none' : 'flex'; return; }
  if (e.key === 't' && !pendingG) { qs('#themeToggle')?.click(); return; }
  if (e.key === 'g') { pendingG = Date.now(); return; }
  if (pendingG && Date.now() - pendingG < 1500 && SHORTCUT_TARGETS[e.key]) {
    pendingG = 0;
    const target = SHORTCUT_TARGETS[e.key];
    if (location.pathname !== target) location.href = target;
    return;
  }
  pendingG = 0;
});

export function initLayout({ active = '' } = {}) {
  const headerContainer = qs('#app-header');
  if (headerContainer) {
    headerContainer.innerHTML = `
      <a class="skip-link" href="#main">${t('nav.skip')}</a>
      <header class="site-header">
        ${renderHeader(active)}
      </header>
      <div class="ticker-bar"></div>
    `;
    loadTickerBar();
  }
  
  const footerContainer = qs('#app-footer');
  if (footerContainer) {
    footerContainer.innerHTML = renderFooter();
  }

  // Live Status
  const livePill = qs('#liveStatus');
  window.addEventListener('live:status', (e) => {
    if (livePill) {
      livePill.className = `live-pill is-${e.detail === 'live' ? 'live' : 'offline'}`;
    }
  });
  live.connect();

  // Watchlist Badge
  const updateBadge = () => {
    const badge = qs('#navWatchlistBadge');
    if (badge) badge.textContent = watchlist.list().length;
  };
  window.addEventListener('watchlist:change', updateBadge);
  updateBadge();

  // Alerts Badge & Engine
  const updateAlertsBadge = () => {
    const badge = qs('#navAlertsBadge');
    if (badge) badge.textContent = alerts.active().length;
  };
  window.addEventListener('alerts:change', updateAlertsBadge);
  updateAlertsBadge();
  startAlertEngine({ notify: (msg, type) => toast(msg, {type}) });

  // Settings features
  const applySettings = (s) => {
    if (s.reduceFlash) document.documentElement.classList.add('no-flash');
    else document.documentElement.classList.remove('no-flash');
    
    let theme = s.theme;
    if (!theme) {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    const themeBtn = qs('#themeToggle');
    if (themeBtn) themeBtn.textContent = theme === 'light' ? '🌙' : '☀️';
    const curSel = qs('#currencySelect');
    if (curSel && s.currency && curSel.value !== s.currency) curSel.value = s.currency;
  };
  applySettings(settings.get());

  window.addEventListener('settings:change', (e) => {
    applySettings(e.detail);
  });

  // Theme Toggle
  const themeBtn = qs('#themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      // What is actually rendered wins (theme-boot resolves "system"/unset before first paint).
      const cur = document.documentElement.dataset.theme
        || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      const next = cur === 'light' ? 'dark' : 'light';
      settings.set({ theme: next });
      document.documentElement.dataset.theme = next;
    });
  }

  // Currency Select
  const curSelect = qs('#currencySelect');
  if (curSelect) {
    populateCurrencies(curSelect);
    curSelect.addEventListener('change', e => {
      settings.set({ currency: e.target.value });
      window.dispatchEvent(new Event('currency:change'));
    });
  }

  // "More" dropdown
  const more = qs('#navMore');
  const moreBtn = qs('#navMoreBtn');
  if (more && moreBtn) {
    const setOpen = (open) => { more.classList.toggle('is-open', open); moreBtn.setAttribute('aria-expanded', String(open)); };
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!more.classList.contains('is-open')); });
    document.addEventListener('click', (e) => { if (!more.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }

  // Mobile / overflow nav: switch to the burger drawer whenever the inline nav does not fit.
  const burger = qs('#navBurger');
  const nav = qs('#mainNav');
  const header = qs('.site-header');
  if (burger && nav && header) {
    burger.addEventListener('click', () => {
      nav.classList.toggle('is-open');
    });
    const checkNavFit = () => {
      header.classList.remove('nav-compact');
      const inner = qs('.header-inner');
      const overflow = nav.scrollWidth > nav.clientWidth + 1 || inner.scrollWidth > inner.clientWidth + 1;
      if (overflow || window.innerWidth <= 1024) header.classList.add('nav-compact');
      else nav.classList.remove('is-open');
    };
    checkNavFit();
    let resizeTimer = null;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(checkNavFit, 80); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(checkNavFit);
  }
  
  // Language Select
  const langSelect = qs('#langSelect');
  if (langSelect) {
    langSelect.value = getLang();
    langSelect.addEventListener('change', e => {
      setLang(e.target.value);
      location.reload();
    });
  }
  
  initSearchModal();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }
  
  applyTranslations(document);
}

