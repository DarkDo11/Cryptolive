import { initLayout, setTitle, qs } from '../layout.js';
import { api } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { settings, watchlist } from '../store.js';
import { fmtCurrency, fmtCompact, fmtDate, escapeHtml } from '../format.js';
import { gaugeSvg, renderCoinTable, changeBadge, coinChip, normalizeCoin } from '../components.js';
import { t } from '../i18n.js';

let fx = 1;
let charts = {};
let fngData = null;
let globalData = null;
let catData = null;
let breadthData = null;
let wlData = null;
let refreshTimer = null;

async function init() {
  initLayout({ active: 'overview' });
  setTitle('Market Overview');

  fx = await api.fxRatio();
  window.addEventListener('currency:change', async () => {
    fx = await api.fxRatio();
    await loadData();
    renderAll();
  });
  window.addEventListener('settings:change', () => {
    renderCharts();
  });

  live.subscribe(tick => {
    if (wlData && wlData.length > 0) {
      applyLiveTick(qs('#watchlistTable'), tick, fx);
    }
  });

  await loadData();
  renderAll();
  
  startRefresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadData().then(renderAll);
      startRefresh();
    } else {
      stopRefresh();
    }
  });
}

function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(async () => {
    if (document.visibilityState === 'visible') {
      await loadData();
      renderAll();
    }
  }, 120000);
}

function stopRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
}

async function loadData() {
  const wlIds = watchlist.list();
  
  const promises = [
    api.global(),
    api.fng(),
    api.categories(),
    api.markets({ perPage: 100 })
  ];
  
  if (wlIds.length > 0) {
    promises.push(api.markets({ ids: wlIds.join(','), perPage: 250 }));
  } else {
    promises.push(Promise.resolve(null));
  }

  const [resGlobal, resFng, resCat, resBreadth, resWl] = await Promise.allSettled(promises);
  
  globalData = resGlobal.status === 'fulfilled' ? resGlobal.value : { error: true };
  fngData = resFng.status === 'fulfilled' ? resFng.value : { error: true };
  catData = resCat.status === 'fulfilled' ? resCat.value : { error: true };
  breadthData = resBreadth.status === 'fulfilled' ? resBreadth.value : { error: true };
  wlData = resWl.status === 'fulfilled' ? resWl.value : (wlIds.length > 0 ? { error: true } : null);
}

function renderAll() {
  renderKPIs();
  
  waitForChart().then(() => {
    renderFng();
    renderDominance();
    renderCategories();
    renderBreadth();
  });

  renderWatchlist();
}

async function waitForChart() {
  return new Promise(r => {
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
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function renderError(containerId) {
  const c = qs(`#${containerId}`);
  if (c) c.innerHTML = `<div style="color:var(--red); text-align:center; padding:24px;">${t('js.unavailable_right_now')}</div>`;
}

function renderKPIs() {
  const kpis = qs('#kpis');
  if (globalData && !globalData.error) {
    const d = globalData.data;
    const cur = settings.get().currency || 'usd';
    
    const tmc = d.total_market_cap[cur] || (d.total_market_cap.usd * fx);
    const tmcChange = d.market_cap_change_percentage_24h_usd;
    
    const vol = d.total_volume[cur] || (d.total_volume.usd * fx);
    const coins = d.active_cryptocurrencies;
    const marketsCount = d.markets;

    kpis.innerHTML = `
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">Total Market Cap</div>
          <div style="display:flex; align-items:center; gap:8px">
            <span style="font-size:1.5rem; font-weight:700">${fmtCompact(tmc, cur)}</span>
            ${changeBadge(tmcChange)}
          </div>
        </div>
      </div>
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">24h Volume</div>
          <div style="font-size:1.5rem; font-weight:700">${fmtCompact(vol, cur)}</div>
        </div>
      </div>
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">Active Coins</div>
          <div style="font-size:1.5rem; font-weight:700">${coins.toLocaleString()}</div>
        </div>
      </div>
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">Exchanges / Markets</div>
          <div style="font-size:1.5rem; font-weight:700">${marketsCount.toLocaleString()}</div>
        </div>
      </div>
    `;
  } else {
    kpis.innerHTML = '<div class="card" style="width:100%"><div class="card-body" style="color:var(--red); text-align:center;">KPIs unavailable right now</div></div>';
  }
}

function getColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    line: style.getPropertyValue('--line').trim() || '#263442',
    muted: style.getPropertyValue('--muted-strong').trim() || '#a9b5bf',
    green: style.getPropertyValue('--green').trim() || '#20c997',
    red: style.getPropertyValue('--red').trim() || '#ff5c73',
    amber: style.getPropertyValue('--amber').trim() || '#f5b451',
    text: style.getPropertyValue('--text').trim() || '#eef4f8'
  };
}

function renderFng() {
  if (fngData && !fngData.error && window.Chart) {
    const card = qs('#fngCard');
    const { value, classification, history } = fngData;
    
    let histHtml = '';
    let canvasHtml = '';
    
    if (history && history.length > 0) {
      canvasHtml = '<div style="height: 120px; position:relative;"><canvas id="fngChart"></canvas></div>';
      
      const yest = history.length > 1 ? history[1].value : '-';
      const lastWk = history.length > 7 ? history[7].value : '-';
      
      histHtml = `
        <div style="display:flex; justify-content:space-between; font-size:0.85rem; color:var(--muted);">
          <span>Now: <b>${escapeHtml(String(value))}</b></span>
          <span>Yesterday: <b>${escapeHtml(String(yest))}</b></span>
          <span>Last week: <b>${escapeHtml(String(lastWk))}</b></span>
        </div>
      `;
    }

    card.innerHTML = `
      <div id="fngGauge"></div>
      ${canvasHtml}
      ${histHtml}
    `;
    
    qs('#fngGauge').innerHTML = gaugeSvg(value, classification);
    
    if (history && history.length > 0) {
      destroyChart('fng');
      const ctx = qs('#fngChart').getContext('2d');
      const colors = getColors();
      
      const revHist = [...history].reverse();
      const labels = revHist.map(h => fmtDate(h.timestamp));
      const data = revHist.map(h => h.value);
      
      const gradient = ctx.createLinearGradient(0, 0, 0, 120);
      gradient.addColorStop(0, colors.amber);
      gradient.addColorStop(1, 'transparent');

      charts['fng'] = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data,
            borderColor: colors.amber,
            backgroundColor: gradient,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
          scales: {
            x: { display: false },
            y: { min: 0, max: 100, ticks: { display: false }, grid: { display: false }, border: { display: false } }
          }
        }
      });
    }
  } else if (fngData && fngData.error) {
    renderError('fngCard');
  }
}

function renderDominance() {
  if (globalData && !globalData.error && window.Chart) {
    destroyChart('dom');
    qs('#domCard').innerHTML = '<canvas id="domChart"></canvas>';
    const ctx = qs('#domChart').getContext('2d');
    
    const colors = ['#f7931a', '#627eea', '#26a17b', '#f0b90b', '#00d18c', '#4ea1ff', '#8795a4'];
    
    const pctMap = globalData.data.market_cap_percentage;
    const entries = Object.entries(pctMap).sort((a,b) => b[1] - a[1]);
    const top6 = entries.slice(0, 6);
    
    const labels = top6.map(e => e[0].toUpperCase());
    const data = top6.map(e => e[1]);
    
    const sum = data.reduce((a, b) => a + b, 0);
    if (sum < 100) {
      labels.push('Others');
      data.push(100 - sum);
    }
    
    const c = getColors();
    
    charts['dom'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'right', labels: { color: c.text, padding: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${ctx.raw.toFixed(1)}%`
            }
          }
        }
      }
    });
  } else if (globalData && globalData.error) {
    renderError('domCard');
  }
}

function renderCategories() {
  if (catData && !catData.error && window.Chart) {
    destroyChart('cat');
    qs('#sectorsCard').innerHTML = '<canvas id="catChart"></canvas>';
    const ctx = qs('#catChart').getContext('2d');
    
    const top10 = catData.slice(0, 10);
    const labels = top10.map(c => c.name);
    const data = top10.map(c => c.market_cap * fx);
    
    const c = getColors();
    const bgColors = top10.map(cat => (cat.market_cap_change_24h || 0) >= 0 ? c.green : c.red);
    const cur = settings.get().currency || 'usd';
    
    charts['cat'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const cat = top10[ctx.dataIndex];
                const change = cat.market_cap_change_24h || 0;
                const sign = change >= 0 ? '+' : '';
                return ` ${fmtCompact(ctx.raw, cur)} (${sign}${change.toFixed(1)}%)`;
              }
            }
          }
        },
        scales: {
          x: { display: false },
          y: { ticks: { color: c.muted, font: { size: 11 } }, grid: { display: false }, border: { display: false } }
        }
      }
    });
  } else if (catData && catData.error) {
    renderError('sectorsCard');
  }
}

function renderBreadth() {
  if (breadthData && !breadthData.error && window.Chart) {
    const card = qs('#breadthCard');
    const coins = breadthData;
    let up = 0;
    let down = 0;
    let sumChange = 0;
    
    const volCoins = [...coins].sort((a,b) => (b.total_volume||0) - (a.total_volume||0)).slice(0, 5);
    
    coins.forEach(c => {
      const change = c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? 0;
      if (change >= 0) up++; else down++;
      sumChange += change;
    });
    const avgChange = coins.length ? sumChange / coins.length : 0;
    
    card.innerHTML = `
      <div class="breadth-text">
        <span style="color:var(--green)">${up} up</span> &middot; 
        <span style="color:var(--red)">${down} down</span>
      </div>
      <div style="height: 40px; position:relative; margin: 8px 0;">
        <canvas id="breadthChart"></canvas>
      </div>
      <div style="text-align:center; color:var(--muted); font-size:0.9rem; margin-bottom: 16px;">
        Average 24h change: ${changeBadge(avgChange)}
      </div>
      <div style="font-size:0.85rem; color:var(--muted); margin-bottom:8px;">Highest 24h Volume</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${volCoins.map(c => {
          const cur = settings.get().currency || 'usd';
          const vol = c.total_volume;
          return `<div class="chip" style="padding-right:12px">${coinChip(c)} <span style="margin-left:4px">${fmtCompact(vol, cur)}</span></div>`;
        }).join('')}
      </div>
    `;

    destroyChart('breadth');
    const ctx = qs('#breadthChart').getContext('2d');
    const c = getColors();
    
    charts['breadth'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Breadth'],
        datasets: [
          { data: [up], backgroundColor: c.green, barPercentage: 1, categoryPercentage: 1 },
          { data: [down], backgroundColor: c.red, barPercentage: 1, categoryPercentage: 1 }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: {
          x: { stacked: true, display: false, max: coins.length },
          y: { stacked: true, display: false }
        },
        layout: { padding: 0 }
      }
    });
  } else if (breadthData && breadthData.error) {
    renderError('breadthCard');
  }
}

function renderWatchlist() {
  const wlCard = qs('#watchlistCard');
  if (wlData && !wlData.error && wlData.length > 0) {
    wlCard.style.display = 'block';
    const normalized = wlData.map(normalizeCoin);
    renderCoinTable(qs('#watchlistTable'), normalized, {
      columns: ['coin', 'price', 'change24h', 'change7d', 'marketCap'],
      fx
    });
  } else if (wlData && wlData.error) {
    wlCard.style.display = 'block';
    renderError('watchlistTable');
  } else {
    wlCard.style.display = 'none';
  }
}

function renderCharts() {
  if (charts['fng']) renderFng();
  if (charts['dom']) renderDominance();
  if (charts['cat']) renderCategories();
  if (charts['breadth']) renderBreadth();
}

init();
