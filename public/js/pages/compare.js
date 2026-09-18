import { initLayout, setTitle, qs, qsa, debounce } from '../layout.js';
import { api } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { settings } from '../store.js';
import { fmtCurrency, fmtPercent, fmtSupply, fmtDate, escapeHtml } from '../format.js';
import { changeBadge, emptyState, normalizeCoin } from '../components.js';
import { t } from '../i18n.js';

let ids = [];
let loadSeq = 0;
let coinsData = [];
let chartInstance = null;
let chartDays = '7';
let fx = 1;

const PALETTE = ['#4ea1ff', '#20c997', '#f5b451', '#ff5c73'];

async function init() {
  initLayout({ active: 'compare' });
  setTitle('Compare Cryptocurrencies');
  
  const params = new URLSearchParams(location.search);
  const qCoins = params.get('coins');
  if (qCoins) {
    ids = qCoins.split(',').filter(Boolean).slice(0, 4);
  } else {
    ids = ['bitcoin', 'ethereum'];
  }
  updateUrl();
  
  setupListeners();
  
  fx = await api.fxRatio();
  window.addEventListener('currency:change', async () => {
    fx = await api.fxRatio();
    await load();
  });
  window.addEventListener('settings:change', () => {
    if (chartInstance) loadChart();
  });
  
  live.subscribe(tick => {
    applyLiveTick(qs('#statsTable'), tick, fx);
  });
  
  await load();
}

function updateUrl() {
  const url = new URL(location);
  url.searchParams.set('coins', ids.join(','));
  history.replaceState(null, '', url);
}

function renderPicker() {
  const cont = qs('#chipsContainer');
  cont.innerHTML = coinsData.map(c => `
    <div class="compare-chip">
      <img src="${escapeHtml(c.image)}" width="18" height="18" style="border-radius:50%">
      <span>${escapeHtml(c.symbol.toUpperCase())}</span>
      <button class="chip-remove" data-id="${escapeHtml(c.id)}">&times;</button>
    </div>
  `).join('');
  
  const inp = qs('#compareSearch');
  if (ids.length >= 4) {
    inp.disabled = true;
    inp.placeholder = 'Max 4 coins';
  } else {
    inp.disabled = false;
    inp.placeholder = 'Add a coin…';
  }
}

async function load() {
  const seq = ++loadSeq;
  const requested = [...ids];
  renderPicker();
  
  if (requested.length === 0) {
    qs('#statsTable').innerHTML = emptyState(t('js.no_coins_selected'), t('js.add_coins_to_compare'));
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    return;
  }
  
  qs('#statsTable').innerHTML = `<div class="skeleton" style="height:300px; width:100%"></div>`;
  
  try {
    const rawMarkets = await api.markets({ ids: requested.join(','), perPage: 250 });
    if (seq !== loadSeq) return;
    
    coinsData = requested.map(id => rawMarkets.find(m => m.id === id)).filter(Boolean).map(normalizeCoin);
    
    if (coinsData.length !== requested.length) {
      ids = coinsData.map(c => c.id);
      updateUrl();
    }
    renderPicker();
    
    renderStatsTable();
    await loadChart();
    if (seq !== loadSeq) return;
  } catch (e) {
    console.error(e);
    qs('#statsTable').innerHTML = `
      <div class="card" style="text-align:center; padding: 24px;">
        <div style="color:var(--red); margin-bottom: 16px;">${t('js.failed_to_load_data')}</div>
        <button class="btn btn-primary" data-action="retry">${t('js.retry')}</button>
      </div>
    `;
    qs('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderStatsTable() {
  const cur = settings.get().currency || 'usd';
  const table = document.createElement('table');
  table.className = 'data-table is-plain';
  
  let thead = `<tr><th>${t('js.metric')}</th>`;
  coinsData.forEach(c => {
    thead += `
      <th style="text-align:center;">
        <a class="asset-cell" href="/coin/${escapeHtml(c.id)}" style="display:inline-flex; flex-direction:column; align-items:center; gap:8px;">
          <img src="${escapeHtml(c.image)}" width="32" height="32" style="border-radius:50%">
          <span class="asset-name" style="font-size:0.9rem">${escapeHtml(c.symbol.toUpperCase())}</span>
        </a>
      </th>
    `;
  });
  thead += '</tr>';
  table.innerHTML = `<thead>${thead}</thead><tbody></tbody>`;
  
  const tbody = table.querySelector('tbody');
  
  const rows = [
    { key: 'price', label: 'Price' },
    { key: 'change1h', label: '1h %', isChange: true },
    { key: 'change24h', label: t('js.24h'), isChange: true, isLiveChange: true },
    { key: 'change7d', label: '7d %', isChange: true },
    { key: 'marketCap', label: t('js.market_cap'), isValue: true },
    { key: 'rank', label: t('js.rank'), isValue: true },
    { key: 'fdv', label: t('js.fdv'), isValue: true },
    { key: 'volume', label: t('js.24h_volume'), isValue: true },
    { key: 'volMcap', label: t('js.vol_mcap') },
    { key: 'circulating', label: t('js.circulating_supply'), isSupply: true },
    { key: 'max', label: t('js.max_supply'), isSupply: true },
    { key: 'ath', label: t('js.ath'), isValue: true },
    { key: 'fromAth', label: t('js.from_ath') },
    { key: 'lowHigh', label: t('js.24h_low_high') }
  ];
  
  rows.forEach(r => {
    const tr = document.createElement('tr');
    let html = `<td style="color:var(--muted); font-weight:500; white-space:nowrap;">${r.label}</td>`;
    
    let bestIdx = -1;
    if (r.isChange || r.key === 'volMcap' || r.key === 'fromAth') {
      let bestVal = -Infinity;
      coinsData.forEach((c, i) => {
        let val;
        if (r.key === 'volMcap') {
          val = (c.volume && c.marketCap) ? c.volume / c.marketCap : -Infinity;
        } else if (r.key === 'fromAth') {
          val = (c.price && c.ath) ? ((c.price - c.ath) / c.ath) * 100 : -Infinity;
        } else {
          val = c[r.key] ?? -Infinity;
        }
        if (val !== -Infinity && val > bestVal) {
          bestVal = val;
          bestIdx = i;
        }
      });
    }
    
    coinsData.forEach((c, i) => {
      const isBest = i === bestIdx;
      const tdCls = isBest ? 'class="is-best"' : '';
      let tdContent = '—';
      
      if (r.key === 'price') {
        tdContent = `<span class="price-cell" data-live-price="${escapeHtml(c.id)}" data-price-usd="${c.price / fx}">${fmtCurrency(c.price, cur)}</span>`;
      } else if (r.isChange) {
        tdContent = c[r.key] != null ? changeBadge(c[r.key], r.isLiveChange ? `data-live-change="${escapeHtml(c.id)}"` : '') : '—';
      } else if (r.isValue) {
        if (r.key === 'rank') {
          tdContent = c.rank != null ? c.rank : '—';
        } else {
          tdContent = c[r.key] != null ? fmtCurrency(c[r.key], cur, {compact: false}) : '—';
        }
      } else if (r.isSupply) {
        if (r.key === 'max' && c[r.key] === null) tdContent = '∞';
        else tdContent = c[r.key] ? fmtSupply(c[r.key], c.symbol) : '—';
      } else if (r.key === 'volMcap') {
        tdContent = (c.volume && c.marketCap) ? fmtPercent((c.volume / c.marketCap) * 100).replace('+', '') : '—';
      } else if (r.key === 'fromAth') {
        const val = (c.price && c.ath) ? ((c.price - c.ath) / c.ath) * 100 : null;
        tdContent = val != null ? changeBadge(val) : '—';
      } else if (r.key === 'lowHigh') {
        if (c.low24h != null && c.high24h != null) {
          tdContent = `<span style="font-size:0.9rem">${fmtCurrency(c.low24h, cur)}<br><span style="color:var(--muted)">to</span><br>${fmtCurrency(c.high24h, cur)}</span>`;
        }
      }
      
      html += `<td ${tdCls} style="text-align:center;">${tdContent}</td>`;
    });
    
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
  
  const wrap = qs('#statsTable');
  wrap.innerHTML = `<div class="table-frame" style="overflow-x:auto;"></div>`;
  wrap.querySelector('.table-frame').appendChild(table);
}

async function loadChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  qs('#perfError').style.display = 'none';
  
  if (ids.length === 0) return;
  
  try {
    const results = await Promise.allSettled(ids.map(id => api.chart(id, chartDays)));
    
    const series = results.map(r => r.status === 'fulfilled' ? r.value.prices : null);
    
    let minLen = Infinity;
    series.forEach(s => {
      if (s && s.length < minLen) minLen = s.length;
    });
    
    if (minLen === Infinity || minLen === 0) {
      qs('#perfError').textContent = 'No chart data available.';
      qs('#perfError').style.display = 'block';
      return;
    }
    
    const datasets = [];
    let commonLabels = [];
    
    series.forEach((s, i) => {
      if (!s) return;
      const tail = s.slice(-minLen);
      const v0 = tail[0][1];
      const data = tail.map(p => (v0 ? (p[1] / v0 - 1) * 100 : 0));
      if (!commonLabels.length) {
        commonLabels = tail.map(p => fmtDate(p[0]));
      }
      
      const color = PALETTE[i % PALETTE.length];
      const coin = coinsData[i];
      datasets.push({
        label: coin ? coin.symbol.toUpperCase() : ids[i],
        data,
        borderColor: color,
        backgroundColor: color,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.25,
        fill: false
      });
    });
    
    const style = getComputedStyle(document.documentElement);
    const colorLine = style.getPropertyValue('--line').trim() || '#263442';
    const colorMuted = style.getPropertyValue('--muted-strong').trim() || '#a9b5bf';
    
    await new Promise(r => {
      if (window.Chart) r();
      else {
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          if (window.Chart) { clearInterval(iv); r(); }
          else if (tries > 50) { clearInterval(iv); r(); }
        }, 100);
      }
    });
    if (!window.Chart) return;
    
    const ctx = qs('#perfChart').getContext('2d');
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels: commonLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { color: colorMuted, boxWidth: 12, font: { family: 'Inter', size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                return ` ${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%`;
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: colorMuted, maxTicksLimit: 8 }, grid: { display: false } },
          y: { position: 'right', ticks: { color: colorMuted, callback: v => `${v.toFixed(0)}%` }, grid: { color: colorLine } }
        }
      }
    });
    
  } catch (err) {
    console.error(err);
    qs('#perfError').textContent = 'Failed to load chart';
    qs('#perfError').style.display = 'block';
  }
}

function setupListeners() {
  qs('#chipsContainer').addEventListener('click', e => {
    const btn = e.target.closest('.chip-remove');
    if (btn) {
      ids = ids.filter(id => id !== btn.dataset.id);
      updateUrl();
      load();
    }
  });
  
  qsa('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      ids = btn.dataset.preset.split(',');
      updateUrl();
      load();
    });
  });
  
  qsa('#perfRangeGroup .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('#perfRangeGroup .range-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      chartDays = btn.dataset.days;
      loadChart();
    });
  });
  
  const searchInp = qs('#compareSearch');
  const dropdown = qs('#compareDropdown');
  let selectedIdx = -1;
  let currentResults = [];
  
  const hideDropdown = () => { dropdown.style.display = 'none'; };
  
  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete')) hideDropdown();
  });
  
  const doSearch = debounce(async (q) => {
    if (!q) { hideDropdown(); return; }
    try {
      const res = await api.search(q);
      currentResults = (res.coins || []).filter(c => !ids.includes(c.id)).slice(0, 10);
      
      if (currentResults.length === 0) {
        dropdown.innerHTML = `<div style="padding:12px; color:var(--muted)">${t('js.no_coins_found')}</div>`;
      } else {
        dropdown.innerHTML = currentResults.map((c, i) => `
          <div class="autocomplete-item" data-idx="${i}">
            <img src="${escapeHtml(c.thumb)}" width="20" height="20" style="border-radius:50%">
            <span style="font-weight:500">${escapeHtml(c.name)}</span>
            <span style="color:var(--muted)">${escapeHtml(c.symbol)}</span>
            ${c.rank ? `<span class="chip" style="margin-left:auto">#${c.rank}</span>` : ''}
          </div>
        `).join('');
      }
      dropdown.style.display = 'block';
      selectedIdx = -1;
    } catch(e) {
      // ignore
    }
  }, 250);
  
  searchInp.addEventListener('input', e => {
    doSearch(e.target.value.trim());
  });
  
  searchInp.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (!items.length || dropdown.style.display === 'none') return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % items.length;
      updateActiveItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + items.length) % items.length;
      updateActiveItem(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentResults.length > 0) {
        const idx = selectedIdx >= 0 ? selectedIdx : 0;
        addCoin(currentResults[idx].id);
      }
    }
  });
  
  dropdown.addEventListener('click', e => {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      addCoin(currentResults[item.dataset.idx].id);
    }
  });
  
  function updateActiveItem(items) {
    items.forEach((item, i) => {
      item.classList.toggle('is-active', i === selectedIdx);
      if (i === selectedIdx) item.scrollIntoView({block: 'nearest'});
    });
  }
  
  function addCoin(id) {
    if (ids.length < 4 && !ids.includes(id)) {
      ids.push(id);
      updateUrl();
      searchInp.value = '';
      hideDropdown();
      load();
    }
  }
}

init();
