import { initLayout, setTitle, toast, qs, qsa, debounce } from '../layout.js';
import { settings, watchlist, recentCoins, portfolio } from '../store.js';
import { api } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { fmtCurrency, fmtCompact, fmtPercent, fmtSupply, fmtDate, fmtDateTime, fmtTime, escapeHtml, fmtNumber } from '../format.js';
import { changeBadge, emptyState, skeletonRows, sparklineSvg } from '../components.js';
import { openAlertModal } from '../alerts.js';
import { t } from '../i18n.js';

const coinId = decodeURIComponent(location.pathname.split('/')[2] || '');

let fx = 1;
let coinData = null;
let chartInstance = null;
let chartState = { days: '7', type: 'line', metric: 'price', log: false };
let tickersPage = 1;
let loadingTickers = false;
let positionState = null;

if (!coinId) {
  qs('#coinHeader').style.display = 'none';
  qs('.coin-layout').style.display = 'none';
  qs('#notFound').hidden = false;
} else {
  initLayout({ active: '' });
  load();

  window.addEventListener('currency:change', async () => {
    chartInstance?.destroy();
    chartInstance = null;
    await load();
  });
  window.addEventListener('settings:change', updateChartTheme);
  window.addEventListener('portfolio:change', () => {
    if (coinData && coinData.market_data) {
      renderPosition(coinData.market_data, settings.get().currency || 'usd');
    }
  });
  
  const unsub = live.subscribe(tick => {
    applyLiveTick(qs('#main'), tick, fx);
    updateLiveChartPoint(tick);
    updateLiveConverter(tick);
    updateLivePosition(tick);
  });
}

async function load() {
  const cur = settings.get().currency || 'usd';
  
  try {
    fx = await api.fxRatio();
    coinData = await api.coin(coinId);
  } catch (err) {
    if (err.status === 404) {
      qs('#coinHeader').style.display = 'none';
      qs('.coin-layout').style.display = 'none';
      qs('#notFound').hidden = false;
      return;
    }
    qs('#coinHeader').innerHTML = '';
    qs('.coin-layout').innerHTML = emptyState(t('js.failed_to_load'), `Could not load coin data (${escapeHtml(err.message || 'network error')})`);
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-primary';
    retryBtn.textContent = 'Retry';
    retryBtn.style.marginTop = '16px';
    retryBtn.addEventListener('click', () => { location.reload(); });
    qs('.empty-state').appendChild(retryBtn);
    return;
  }
  
  const md = coinData.market_data;
  recentCoins.push(coinId);
  setTitle(`${coinData.name} (${coinData.symbol.toUpperCase()}) price today`);
  
  renderHeader(coinData, md, cur);
  renderStats(md, cur);
  renderPosition(md, cur);
  renderConverter(coinData, md, cur);
  renderPerf(md, cur);
  renderAbout(coinData);
  renderPartialNotice(coinData.partial === true);
  renderSimilar();
  
  tickersPage = 1;
  qs('#tickersBody').innerHTML = '';
  qs('#loadMoreTickers').style.display = 'inline-flex';
  if (!coinData.partial) {
    loadTickers();
    loadHistory(qs('#historyRange .range-btn.is-active')?.dataset?.days || 30);
  }
  
  if (!controlsBound) {
    controlsBound = true;
    setupChartControls();
    setupHistoryControls();
  }
  renderChart();
}
let controlsBound = false;

function renderHeader(data, md, cur) {
  const price = md.current_price[cur] || 0;
  const priceUsd = md.current_price.usd || 0;
  const change24h = md.price_change_percentage_24h || 0;
  
  const low24 = md.low_24h ? md.low_24h[cur] : null;
  const high24 = md.high_24h ? md.high_24h[cur] : null;
  let rangeHtml = '';
  if (low24 != null && high24 != null && high24 > low24) {
    const pos = Math.max(0, Math.min(100, ((price - low24) / (high24 - low24)) * 100));
    rangeHtml = `
      <div style="display:flex; align-items:center; gap:12px; font-size:0.85rem; color:var(--muted); flex: 1; max-width: 300px; margin-top: 8px;">
        <span>${fmtCurrency(low24, cur)}</span>
        <div class="range-bar"><div class="range-marker" style="left:${pos}%"></div></div>
        <span>${fmtCurrency(high24, cur)}</span>
      </div>
    `;
  }

  const isStar = watchlist.has(data.id);
  
  let catsHtml = (data.categories || []).slice(0, 3).map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');
  
  const headerHtml = `
    <div class="card-body" style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:24px;">
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div class="coin-title">
          <img src="${escapeHtml(data.image.large)}" alt="${escapeHtml(data.name)}" class="logo-img">
          <h1>${escapeHtml(data.name)}</h1>
          <span class="chip" style="color:var(--text); font-weight:600">${escapeHtml(data.symbol.toUpperCase())}</span>
          ${data.market_cap_rank ? `<span class="chip">#${data.market_cap_rank}</span>` : ''}
        </div>
        <div class="chips-row">
          ${catsHtml}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="coin-price" data-live-price="${escapeHtml(data.id)}" data-price-usd="${priceUsd}">${fmtCurrency(price, cur)}</div>
          <div style="font-size:1.2rem">${changeBadge(change24h, `data-live-change="${escapeHtml(data.id)}"`)}</div>
        </div>
        ${rangeHtml}
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-ghost btn-sm star-btn ${isStar ? 'is-active' : ''}" data-id="${escapeHtml(data.id)}" aria-label="Toggle watchlist" aria-pressed="${isStar ? 'true' : 'false'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${isStar ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span style="margin-left:4px; font-size:0.8rem; font-family:Inter">${t('js.watch')}</span>
          </button>
          <button class="btn btn-ghost btn-sm" id="setAlertBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            <span style="margin-left:4px">${t('js.set_alert')}</span>
          </button>
          <a class="btn btn-ghost btn-sm" href="/portfolio?add=${encodeURIComponent(data.id)}" id="addToPortfolioBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span style="margin-left:4px">${t('js.add_to_portfolio')}</span>
          </a>
          <a class="btn btn-ghost btn-sm" href="/compare?coins=${encodeURIComponent(data.id)}" id="compareBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            <span style="margin-left:4px">${t('js.compare')}</span>
          </a>
          <button class="btn btn-ghost btn-sm" id="copyLinkBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            <span style="margin-left:4px">${t('js.copy_link')}</span>
          </button>
        </div>
      </div>
    </div>
  `;
  
  const headerEl = qs('#coinHeader');
  headerEl.innerHTML = headerHtml;

  const logo = qs('.logo-img', headerEl);
  logo?.addEventListener('error', () => {
    const span = document.createElement('span');
    span.className = 'asset-icon';
    span.style.cssText = 'width:40px;height:40px;font-size:20px;';
    span.textContent = data.symbol[0].toUpperCase();
    logo.replaceWith(span);
  }, { once: true });
  
  qs('.star-btn', headerEl).addEventListener('click', function() {
    watchlist.toggle(data.id);
    const active = watchlist.has(data.id);
    this.classList.toggle('is-active', active);
    this.setAttribute('aria-pressed', active ? 'true' : 'false');
    this.querySelector('svg').setAttribute('fill', active ? 'currentColor' : 'none');
  });
  
  qs('#setAlertBtn', headerEl).addEventListener('click', () => {
    openAlertModal({
      coinId: data.id, 
      symbol: data.symbol, 
      name: data.name, 
      image: data.image.large, 
      priceUsd: md.current_price.usd
    });
  });
  
  qs('#copyLinkBtn', headerEl).addEventListener('click', () => {
    navigator.clipboard.writeText(location.href);
    toast(t('js.link_copied_to_clipboard'), { type: 'success' });
  });
}

// Shows/hides the "degraded data" banner and the cards that need the full upstream payload.
function renderPartialNotice(isPartial) {
  let banner = qs('#partialNotice');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'partialNotice';
    banner.className = 'notice';
    banner.innerHTML = `${t('coin.partialNotice')} <button type="button" class="btn btn-ghost btn-sm" data-action="retry">${t('js.reload')}</button>`;
    qs('#coinHeader').before(banner);
  }
  banner.hidden = !isPartial;
  qs('#aboutCard').hidden = isPartial;
  qs('#marketsCard').hidden = isPartial;
  if (qs('#historyCard')) qs('#historyCard').hidden = isPartial;
}

async function renderSimilar() {
  const body = qs('#similarBody');
  if (!body) return;
  body.innerHTML = skeletonRows(4, 3);
  const cur = settings.get().currency || 'usd';
  let rows = [];
  try { rows = await api.similar(coinId); } catch { rows = []; }
  if (!Array.isArray(rows) || rows.length === 0) {
    body.innerHTML = emptyState(t('coin.similarEmpty'), '');
    return;
  }
  const ratio = Number.isFinite(fx) && fx > 0 ? fx : 1;
  body.innerHTML = `<ul class="similar-list">${rows.map(c => `
    <li><a class="similar-row" href="/coin/${encodeURIComponent(c.id)}">
      <img class="coin-img" src="${escapeHtml(c.image || '')}" alt="" loading="lazy" width="24" height="24">
      <span class="similar-name"><strong>${escapeHtml(c.name)}</strong><span class="muted small">${escapeHtml(String(c.symbol || '').toUpperCase())} · #${c.market_cap_rank ?? '—'}</span></span>
      <span class="similar-spark">${sparklineSvg(c.sparkline_in_7d?.price || [], (c.price_change_percentage_7d_in_currency ?? 0) >= 0, { width: 64, height: 24 })}</span>
      <span class="similar-price"><span data-live-price="${c.id}" data-price-usd="${c.current_price / ratio}">${fmtCurrency(c.current_price, cur)}</span>${changeBadge(c.price_change_percentage_24h, `data-live-change="${c.id}"`)}</span>
    </a></li>`).join('')}</ul>`;
}

function renderStats(md, cur) {
  let circHtml = fmtSupply(md.circulating_supply, coinData.symbol);
  if (md.max_supply && md.circulating_supply) {
    const pct = Math.min(100, (md.circulating_supply / md.max_supply) * 100);
    circHtml += `<div class="progress"><div style="width:${pct}%"></div></div>`;
  }

  const volMc = md.total_volume[cur] && md.market_cap[cur] ? fmtPercent((md.total_volume[cur] / md.market_cap[cur]) * 100) : '—';
  
  const html = `
    <div class="stat-list">
      <div class="stat-row"><dt>${t('js.market_cap')}</dt><dd>${md.market_cap[cur] ? fmtCurrency(md.market_cap[cur], cur) : '—'} <div style="font-size:0.8rem; font-weight:normal">${changeBadge(md.market_cap_change_percentage_24h)}</div></dd></div>
      <div class="stat-row"><dt>${t('js.fully_diluted_valuation')}</dt><dd>${md.fully_diluted_valuation && md.fully_diluted_valuation[cur] ? fmtCurrency(md.fully_diluted_valuation[cur], cur) : '—'}</dd></div>
      <div class="stat-row"><dt>${t('js.24h_volume')}</dt><dd>${md.total_volume[cur] ? fmtCurrency(md.total_volume[cur], cur) : '—'}</dd></div>
      <div class="stat-row"><dt>${t('js.volume_market_cap')}</dt><dd>${volMc.replace('+', '')}</dd></div>
      <div class="stat-row"><dt>${t('js.circulating_supply')}</dt><dd>${circHtml}</dd></div>
      <div class="stat-row"><dt>${t('js.total_supply')}</dt><dd>${md.total_supply ? fmtSupply(md.total_supply, coinData.symbol) : '—'}</dd></div>
      <div class="stat-row"><dt>${t('js.max_supply')}</dt><dd>${md.max_supply === null ? '∞' : (md.max_supply ? fmtSupply(md.max_supply, coinData.symbol) : '—')}</dd></div>
      <div class="stat-row"><dt>${t('js.all_time_high')}</dt><dd>${md.ath[cur] ? fmtCurrency(md.ath[cur], cur) : '—'} <div style="font-size:0.8rem; font-weight:normal">${changeBadge(md.ath_change_percentage[cur])} &middot; <span style="color:var(--muted)">${md.ath_date[cur] ? fmtDate(new Date(md.ath_date[cur]).getTime()) : ''}</span></div></dd></div>
      <div class="stat-row"><dt>${t('js.all_time_low')}</dt><dd>${md.atl[cur] ? fmtCurrency(md.atl[cur], cur) : '—'} <div style="font-size:0.8rem; font-weight:normal">${changeBadge(md.atl_change_percentage[cur])} &middot; <span style="color:var(--muted)">${md.atl_date[cur] ? fmtDate(new Date(md.atl_date[cur]).getTime()) : ''}</span></div></dd></div>
    </div>
  `;
  qs('#statsBody').innerHTML = html;
}

function renderPosition(md, cur) {
  const holdings = portfolio.holdings();
  const h = holdings.find(x => x.coinId === coinId && x.amount > 0);
  if (!h) {
    qs('#positionCard').hidden = true;
    positionState = null;
    return;
  }
  qs('#positionCard').hidden = false;

  let priceUsd = md.current_price?.usd;
  if (priceUsd === undefined) {
    priceUsd = md.current_price?.[cur] / fx;
  }
  if (!Number.isFinite(priceUsd)) priceUsd = 0;

  const value = h.amount * priceUsd * fx;
  const cost = h.costBasisUsd * fx;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const avg = h.avgPriceUsd * fx;

  positionState = { amount: h.amount, costUsd: h.costBasisUsd };

  const html = `
    <div class="stat-list">
      <div class="stat-row"><dt>${t('js.holdings')}</dt><dd>${fmtNumber(h.amount, { max: 8 })} ${escapeHtml(String(h.symbol || '').toUpperCase())}</dd></div>
      <div class="stat-row"><dt>${t('coin.positionValue')}</dt><dd><span id="positionValue" data-position-amount="${h.amount}">${fmtCurrency(value, cur)}</span></dd></div>
      <div class="stat-row"><dt>${t('js.avg_buy_price')}</dt><dd>${fmtCurrency(avg, cur)}</dd></div>
      <div class="stat-row"><dt>${t('js.p_l')}</dt><dd><span id="positionPnl" class="${pnl >= 0 ? 'is-up' : 'is-down'}">${fmtCurrency(pnl, cur)} ${changeBadge(pnlPct)}</span></dd></div>
    </div>
  `;
  qs('#positionBody').innerHTML = html;
}

function updateLivePosition(tick) {
  if (!positionState || !tick.prices[coinId]) return;
  const cur = settings.get().currency || 'usd';
  const amount = positionState.amount;
  const costUsd = positionState.costUsd;

  const priceUsd = tick.prices[coinId].p;
  const value = amount * priceUsd * fx;
  const cost = costUsd * fx;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;

  const valEl = qs('#positionValue');
  if (valEl) valEl.textContent = fmtCurrency(value, cur);

  const pnlEl = qs('#positionPnl');
  if (pnlEl) {
    pnlEl.className = pnl >= 0 ? 'is-up' : 'is-down';
    pnlEl.innerHTML = `${fmtCurrency(pnl, cur)} ${changeBadge(pnlPct)}`;
  }
}

function renderConverter(data, md, cur) {
  qs('#convFromLabel').textContent = data.symbol.toUpperCase();
  qs('#convToLabel').textContent = cur.toUpperCase();
  
  const price = md.current_price[cur] || 0;
  const fromInp = qs('#convFrom');
  const toInp = qs('#convTo');
  
  toInp.value = (Number(fromInp.value) * price).toFixed(2);
  fromInp.dataset.livePriceValue = price;
  if (fromInp.dataset.bound) return;
  fromInp.dataset.bound = '1';
  
  fromInp.addEventListener('input', () => {
    const p = Number(fromInp.dataset.livePriceValue || price);
    toInp.value = p ? (Number(fromInp.value) * p).toFixed(2) : '';
  });
  toInp.addEventListener('input', () => {
    const p = Number(fromInp.dataset.livePriceValue || price);
    fromInp.value = p ? (Number(toInp.value) / p).toFixed(6) : '';
  });
  
  fromInp.dataset.livePriceValue = price;
}

function updateLiveConverter(tick) {
  if (!coinData || !tick.prices[coinData.id]) return;
  const cur = settings.get().currency || 'usd';
  const price = tick.prices[coinData.id].p * fx;
  const fromInp = qs('#convFrom');
  const toInp = qs('#convTo');
  
  fromInp.dataset.livePriceValue = price;
  if (document.activeElement !== toInp) {
    toInp.value = (Number(fromInp.value) * price).toFixed(2);
  }
}

function renderPerf(md, cur) {
  const periods = [
    { label: '1h', key: `price_change_percentage_1h_in_currency` },
    { label: '24h', key: `price_change_percentage_24h` },
    { label: '7d', key: `price_change_percentage_7d` },
    { label: '14d', key: `price_change_percentage_14d` },
    { label: '30d', key: `price_change_percentage_30d` },
    { label: '60d', key: `price_change_percentage_60d` },
    { label: '1y', key: `price_change_percentage_1y` }
  ];
  
  let tbody = '';
  periods.forEach(p => {
    let val = md[p.key];
    if (val && typeof val === 'object') val = val[cur];
    if (val != null) {
      tbody += `<tr><td style="color:var(--muted)">${p.label}</td><td style="text-align:right">${changeBadge(val)}</td></tr>`;
    }
  });
  
  if (tbody) {
    qs('#perfBody').innerHTML = `<table class="data-table" style="width:100%"><tbody>${tbody}</tbody></table>`;
  } else {
    qs('#perfBody').innerHTML = emptyState('', t('js.no_data'));
  }
}

function sanitizeHtml(htmlStr) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlStr, 'text/html');
  
  const allowed = new Set(['a', 'p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li']);
  
  function walk(node) {
    if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== 1) return document.createTextNode('');
    
    const tag = node.tagName.toLowerCase();
    if (!allowed.has(tag)) {
      const frag = document.createDocumentFragment();
      for (const child of node.childNodes) frag.appendChild(walk(child));
      return frag;
    }
    
    const el = document.createElement(tag);
    if (tag === 'a') {
      const href = node.getAttribute('href');
      if (href && /^https?:/.test(href)) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener nofollow');
      }
    }
    
    for (const child of node.childNodes) {
      el.appendChild(walk(child));
    }
    return el;
  }
  
  const clean = document.createElement('div');
  for (const child of doc.body.childNodes) {
    clean.appendChild(walk(child));
  }
  return clean.innerHTML;
}

function renderAbout(data) {
  const l = data.links || {};
  let chips = '';
  
  const mkLink = (url, label) => {
    if (url) chips += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">${escapeHtml(label)}</a>`;
  };
  
  if (l.homepage && l.homepage[0]) mkLink(l.homepage[0], 'Homepage');
  if (l.blockchain_site && l.blockchain_site[0]) mkLink(l.blockchain_site[0], 'Explorer');
  if (l.repos_url && l.repos_url.github && l.repos_url.github[0]) mkLink(l.repos_url.github[0], 'GitHub');
  if (l.twitter_screen_name) mkLink(`https://x.com/${l.twitter_screen_name}`, 'X (Twitter)');
  if (l.subreddit_url) mkLink(l.subreddit_url, 'Reddit');
  if (l.whitepaper) mkLink(l.whitepaper, 'Whitepaper');
  
  let metaHtml = '';
  if (data.genesis_date) metaHtml += `<div class="stat-row"><dt>${t('js.genesis_date')}</dt><dd>${escapeHtml(data.genesis_date)}</dd></div>`;
  if (data.hashing_algorithm) metaHtml += `<div class="stat-row"><dt>${t('js.hashing_algorithm')}</dt><dd>${escapeHtml(data.hashing_algorithm)}</dd></div>`;
  
  let descHtml = '';
  if (data.description && data.description.en) {
    descHtml = `<div class="about-desc" style="color:var(--muted-strong); line-height:1.6">${sanitizeHtml(data.description.en)}</div>`;
  }
  
  let finalHtml = '';
  if (descHtml) finalHtml += descHtml;
  if (chips) finalHtml += `<div class="chips-row" style="margin-top:16px;">${chips}</div>`;
  if (metaHtml) finalHtml += `<div class="stat-list" style="margin-top:16px;">${metaHtml}</div>`;
  
  const body = qs('#aboutBody');
  body.innerHTML = finalHtml || emptyState('', t('js.no_information_available'));
  
  const descEl = qs('.about-desc', body);
  if (descEl && descEl.textContent.length > 600) {
    descEl.classList.add('is-clamped');
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.style.marginTop = '8px';
    toggleBtn.textContent = 'Read more';
    toggleBtn.addEventListener('click', () => {
      descEl.classList.toggle('is-clamped');
      toggleBtn.textContent = descEl.classList.contains('is-clamped') ? 'Read more' : 'Show less';
    });
    descEl.parentNode.insertBefore(toggleBtn, descEl.nextSibling);
  }
}

async function loadTickers() {
  if (loadingTickers) return;
  loadingTickers = true;
  
  const cur = settings.get().currency || 'usd';
  const tbody = qs('#tickersBody');
  
  if (tickersPage === 1) {
    tbody.innerHTML = `<div class="table-frame"><table class="data-table is-plain"><thead><tr><th>#</th><th>${t('js.exchange')}</th><th>${t('js.pair')}</th><th>${t('js.price')}</th><th>${t('js.24h_volume')}</th><th>${t('js.trust')}</th><th>${t('js.spread')}</th><th>${t('js.action')}</th></tr></thead><tbody id="tickersTbody">${skeletonRows(5, 8)}</tbody></table></div>`;
  } else {
    qs('#loadMoreTickers').textContent = t('js.loading');
  }
  
  try {
    const res = await api.tickers(coinId, tickersPage);
    const tickers = res.tickers || [];
    
    let html = '';
    tickers.forEach((tk, i) => {
      const num = (tickersPage - 1) * 100 + i + 1;
      const logo = tk.exchange_logo ? `<img src="${escapeHtml(tk.exchange_logo)}" width="16" height="16" style="border-radius:50%">` : `<span class="asset-icon" style="width:16px;height:16px;font-size:8px;">${escapeHtml(tk.exchange.charAt(0))}</span>`;
      
      const price = fmtCurrency(tk.last_usd * fx, cur);
      const vol = fmtCurrency(tk.volume_usd * fx, cur);
      const trustClass = tk.trust_score === 'green' ? 'is-green' : (tk.trust_score === 'yellow' ? 'is-yellow' : (tk.trust_score === 'red' ? 'is-red' : 'is-grey'));
      const spread = tk.spread != null ? fmtPercent(tk.spread).replace('+', '') : '—';
      const tradeLink = tk.trade_url ? `<a href="${escapeHtml(tk.trade_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">${t('js.trade')}</a>` : '—';
      
      html += `
        <tr data-search="${escapeHtml(`${tk.exchange} ${tk.base}/${tk.target}`.toLowerCase())}">
          <td>${num}</td>
          <td><div style="display:flex; align-items:center; gap:8px">${logo}<span>${escapeHtml(tk.exchange)}</span></div></td>
          <td style="color:var(--blue)">${escapeHtml(tk.base)}/${escapeHtml(tk.target)}</td>
          <td>${price}</td>
          <td>${vol}</td>
          <td style="text-align:center"><span class="trust-dot ${trustClass}" title="${escapeHtml(tk.trust_score || 'unknown')}"></span></td>
          <td>${spread}</td>
          <td>${tradeLink}</td>
        </tr>
      `;
    });
    
    const tBodyEl = qs('#tickersTbody');
    if (tickersPage === 1) {
      tBodyEl.innerHTML = html;
      applyTickerFilter();
      if (tickers.length === 0) {
        tbody.innerHTML = emptyState(t('js.no_markets_found'));
        qs('#loadMoreTickers').style.display = 'none';
      }
    } else {
      tBodyEl.insertAdjacentHTML('beforeend', html);
      applyTickerFilter();
    }
    
    if (tickers.length < 100) {
      qs('#loadMoreTickers').style.display = 'none';
    } else {
      qs('#loadMoreTickers').textContent = t('common.loadMore');
    }
    
    tickersPage++;
  } catch (err) {
    console.error('Tickers load error', err);
    if (tickersPage === 1) tbody.innerHTML = emptyState(t('js.failed_to_load_markets'));
    qs('#loadMoreTickers').textContent = t('common.loadMore');
  }
  loadingTickers = false;
}

qs('#loadMoreTickers').addEventListener('click', loadTickers);

function applyTickerFilter() {
  const q = (qs('#tickerFilter')?.value || '').trim().toLowerCase();
  qsa('#tickersTbody tr[data-search]').forEach(tr => { tr.hidden = q !== '' && !tr.dataset.search.includes(q); });
}
qs('#tickerFilter')?.addEventListener('input', debounce(applyTickerFilter, 120));

function setupHistoryControls() {
  qsa('#historyRange .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active')) return;
      qsa('#historyRange .range-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      loadHistory(btn.dataset.days);
    });
  });
}

async function loadHistory(days = 30) {
  const card = qs('#historyCard');
  if (!card) return;
  const cur = settings.get().currency || 'usd';
  const body = qs('#historyBody');
  body.innerHTML = `<div style="padding: 16px;">${skeletonRows(5, 6)}</div>`;
  
  try {
    const raw = await api.ohlc(coinId, days);
    const dailyMap = new Map();
    raw.forEach(row => {
      const d = new Date(row[0]);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      if (!dailyMap.has(key)) {
        dailyMap.set(key, { ts: row[0], o: row[1], h: row[2], l: row[3], c: row[4] });
      } else {
        const item = dailyMap.get(key);
        if (row[2] > item.h) item.h = row[2];
        if (row[3] < item.l) item.l = row[3];
        item.c = row[4];
      }
    });
    const sorted = Array.from(dailyMap.values()).sort((a, b) => b.ts - a.ts);
    
    let html = `<div class="table-frame"><table class="data-table is-plain"><thead><tr><th>${t('js.date')}</th><th>${t('js.open')}</th><th>${t('js.high')}</th><th>${t('js.low')}</th><th>${t('js.close')}</th><th style="text-align:right">${t('js.change')}</th></tr></thead><tbody>`;
    let csvRows = ['Date,Open,High,Low,Close,Change%'];
    
    sorted.forEach((row, i) => {
      const prev = sorted[i + 1];
      let change = null;
      if (prev && prev.c) {
        change = ((row.c - prev.c) / prev.c) * 100;
      }
      html += `<tr>
        <td>${fmtDate(row.ts)}</td>
        <td>${fmtCurrency(row.o, cur)}</td>
        <td>${fmtCurrency(row.h, cur)}</td>
        <td>${fmtCurrency(row.l, cur)}</td>
        <td>${fmtCurrency(row.c, cur)}</td>
        <td style="text-align:right">${change !== null ? changeBadge(change) : '—'}</td>
      </tr>`;
      csvRows.push(`${new Date(row.ts).toISOString().split('T')[0]},${row.o},${row.h},${row.l},${row.c},${change !== null ? change.toFixed(2) : ''}`);
    });
    html += `</tbody></table></div><div class="card-body" style="text-align:center; border-top:1px solid var(--line);"><button type="button" class="btn btn-ghost" id="dlCsvBtn">${t('js.download_csv')}</button></div>`;
    body.innerHTML = html;
    
    qs('#dlCsvBtn').addEventListener('click', () => {
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${escapeHtml(coinData.symbol)}-${escapeHtml(days.toString())}d.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  } catch (err) {
    console.error('History load error', err);
    body.innerHTML = emptyState('', t('js.unavailable_right_now'));
  }
}

// Chart Logic
function setupChartControls() {
  qsa('#rangeGroup .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('#rangeGroup .range-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      chartState.days = btn.dataset.days;
      renderChart();
    });
  });
  qsa('#typeGroup .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('#typeGroup .range-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      chartState.type = btn.dataset.type;
      
      const isCandles = chartState.type === 'candles';
      qsa('#metricGroup .range-btn').forEach(b => {
        b.disabled = isCandles;
        if (isCandles) b.style.opacity = 0.5;
        else b.style.opacity = 1;
      });
      if (isCandles && chartState.metric !== 'price') {
        chartState.metric = 'price';
        qsa('#metricGroup .range-btn').forEach(b => b.classList.remove('is-active'));
        qs('#metricGroup .range-btn[data-metric="price"]').classList.add('is-active');
      }
      
      renderChart();
    });
  });
  qsa('#metricGroup .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (chartState.type === 'candles') return;
      qsa('#metricGroup .range-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      chartState.metric = btn.dataset.metric;
      renderChart();
    });
  });
  qs('#logScale').addEventListener('change', e => {
    chartState.log = e.target.checked;
    renderChart();
  });
}

let chartDataRaw = null;
let chartFetchController = null;

async function renderChart() {
  if (chartFetchController) chartFetchController.abort();
  chartFetchController = new AbortController();
  
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  
  const cur = settings.get().currency || 'usd';
  const metaEl = qs('#chartMeta');
  metaEl.innerHTML = '<span class="skeleton" style="display:inline-block; width:150px; height:20px;"></span>';
  
  try {
    if (chartState.type === 'candles') {
      const daysMap = { '1': 1, '7': 7, '30': 30, '90': 90, '365': 365, 'max': 365 };
      const d = daysMap[chartState.days] || 7;
      chartDataRaw = await api.ohlc(coinId, d, { signal: chartFetchController.signal });
    } else {
      chartDataRaw = await api.chart(coinId, chartState.days, { signal: chartFetchController.signal });
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    // Degraded mode: fall back to the 7-day hourly sparkline that ships with the coin payload.
    const spark = coinData?.market_data?.sparkline_7d?.price;
    if (chartState.type === 'line' && chartState.metric === 'price' && Array.isArray(spark) && spark.length > 1) {
      const now = Date.now();
      const step = (7 * 24 * 3600 * 1000) / spark.length;
      chartDataRaw = { prices: spark.map((v, i) => [now - (spark.length - i) * step, v * fx]) };
      chartState.days = '7';
    } else {
      metaEl.textContent = 'Chart unavailable right now (data provider is rate limiting). Try again in a minute.';
      return;
    }
  }

  await new Promise(r => {
    if (window.Chart) r();
    else {
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (window.Chart) { clearInterval(iv); r(); }
        else if (tries > 100) { clearInterval(iv); r(); }
      }, 50);
    }
  });
  if (!window.Chart) return;
  
  const canvas = qs('#priceChart');
  const ctx = canvas.getContext('2d');
  
  const style = getComputedStyle(document.documentElement);
  const colorLine = style.getPropertyValue('--line').trim() || '#263442';
  const colorMuted = style.getPropertyValue('--muted-strong').trim() || '#a9b5bf';
  const colorGreen = style.getPropertyValue('--green').trim() || '#20c997';
  const colorRed = style.getPropertyValue('--red').trim() || '#ff5c73';
  
  let first=0, last=0, min=Infinity, max=-Infinity;
  let config = {};

  if (chartState.type === 'candles') {
    const data = chartDataRaw;
    if (!data || data.length === 0) return;
    
    first = data[0][4];
    last = data[data.length - 1][4];
    const labels = [];
    const wicks = [];
    const bodies = [];
    const colors = [];
    
    data.forEach(p => {
      const ts = p[0], o = p[1], h = p[2], l = p[3], c = p[4];
      if (h > max) max = h;
      if (l < min) min = l;
      labels.push(chartState.days === '1' ? fmtTime(ts) : fmtDate(ts));
      
      const isUp = c >= o;
      colors.push(isUp ? colorGreen : colorRed);
      
      wicks.push([l, h]);
      bodies.push([o, c]);
    });
    
    config = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { data: wicks, backgroundColor: colors.map(c => c.replace(')', ', 0.9)').replace('rgb', 'rgba')), barPercentage: 0.2, categoryPercentage: 1 },
          { data: bodies, backgroundColor: colors, barPercentage: 0.8, categoryPercentage: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: {
          callbacks: {
            title: ctx => {
              const idx = ctx[0].dataIndex;
              return fmtDateTime(data[idx][0]);
            },
            label: ctx => {
              if (ctx.datasetIndex === 0) return null;
              const idx = ctx.dataIndex;
              const d = data[idx];
              return ` O: ${fmtCurrency(d[1], cur)}  H: ${fmtCurrency(d[2], cur)}  L: ${fmtCurrency(d[3], cur)}  C: ${fmtCurrency(d[4], cur)}`;
            }
          }
        }},
        scales: {
          x: { ticks: { color: colorMuted, maxTicksLimit: 8 }, grid: { display: false } },
          y: { position: 'right', type: chartState.log ? 'logarithmic' : 'linear', ticks: { color: colorMuted, callback: v => fmtCompact(v, cur) }, grid: { color: colorLine } }
        }
      }
    };
  } else {
    const arr = chartDataRaw[chartState.metric] || chartDataRaw.prices;
    if (!arr || arr.length === 0) return;
    
    first = arr[0][1];
    last = arr[arr.length - 1][1];
    const isUp = last >= first;
    const strokeColor = isUp ? colorGreen : colorRed;
    
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 300);
    grad.addColorStop(0, isUp ? 'rgba(32, 201, 151, 0.28)' : 'rgba(255, 92, 115, 0.28)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    const labels = [];
    const data = [];
    arr.forEach(p => {
      const v = p[1];
      if (v > max) max = v;
      if (v < min) min = v;
      labels.push(chartState.days === '1' ? fmtTime(p[0]) : fmtDate(p[0]));
      data.push(v);
    });

    const hasVolumes = Array.isArray(chartDataRaw.total_volumes);
    const volumes = hasVolumes ? arr.map((_, i) => chartDataRaw.total_volumes[i]?.[1] ?? null) : [];
    const maxVolume = hasVolumes ? Math.max(0, ...volumes.filter(v => Number.isFinite(v))) : 0;
    const datasets = [{
      data, borderColor: strokeColor, backgroundColor: grad,
      pointRadius: 0, borderWidth: 2, tension: 0.3, fill: true,
      order: 1, label: chartState.metric === 'marketCap' ? t('js.market_cap') : t('js.price')
    }];
    if (hasVolumes) {
      datasets.push({
        type: 'bar', data: volumes, yAxisID: 'yVol',
        backgroundColor: volumes.map((_, i) => (i > 0 && data[i] < data[i - 1]) ? 'rgba(255, 92, 115, 0.5)' : 'rgba(32, 201, 151, 0.5)'),
        borderWidth: 0, barPercentage: 0.9, categoryPercentage: 1,
        order: 2, label: t('coin.volume')
      });
    }

    const scales = {
      x: { ticks: { color: colorMuted, maxTicksLimit: 8 }, grid: { display: false } },
      y: { position: 'right', type: chartState.log ? 'logarithmic' : 'linear', ticks: { color: colorMuted, callback: v => fmtCompact(v, cur) }, grid: { color: colorLine } }
    };
    if (hasVolumes) {
      scales.yVol = { position: 'left', display: false, beginAtZero: true, max: maxVolume * 4, grid: { display: false } };
    }
    
    config = {
      type: 'line',
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => fmtDateTime(arr[ctx[0].dataIndex][0]),
              label: ctx => `${ctx.dataset.label}: ${ctx.datasetIndex === 1 ? fmtCompact(ctx.raw, cur) : fmtCurrency(ctx.raw, cur)}`
            }
          }
        },
        scales
      }
    };
  }

  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
  metaEl.innerHTML = `
    <span style="font-weight:600; font-size:1.1rem">${changeBadge(changePct)}</span>
    <span style="color:var(--muted); font-size:0.85rem; margin-left:8px;">
      &middot; H: ${fmtCurrency(max, cur)} L: ${fmtCurrency(min, cur)}
    </span>
  `;
  
  chartInstance = new Chart(canvas, config);
}

function updateChartTheme() {
  if (chartInstance) renderChart();
}

function updateLiveChartPoint(tick) {
  if (!chartInstance || chartState.type !== 'line' || chartState.metric !== 'price' || chartState.days !== '1') return;
  const t = tick.prices[coinId];
  if (!t) return;
  
  const ds = chartInstance.data.datasets[0];
  const arr = ds.data;
  if (!arr || arr.length === 0) return;
  
  const p = t.p * fx;
  arr[arr.length - 1] = p;
  
  // also update time label slightly if we wanted, but not required
  chartInstance.update('none');
}
