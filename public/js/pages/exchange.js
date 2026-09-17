import { initLayout, setTitle, qs, qsa, debounce } from '../layout.js';
import { settings } from '../store.js';
import { api } from '../api.js';
import { fmtCurrency, fmtNumber, fmtPercent, fmtDate, escapeHtml } from '../format.js';
import { emptyState, skeletonRows } from '../components.js';
import { t } from '../i18n.js';

const exId = decodeURIComponent(location.pathname.split('/')[2] || '');

if (!exId) {
  qs('#exHeader').style.display = 'none';
  qs('.grid-2').style.display = 'none';
  qs('#notFound').hidden = false;
  initLayout({ active: 'exchanges' });
} else {
  initLayout({ active: 'exchanges' });
  load();

  window.addEventListener('currency:change', load);
}

let fx = 1;
let btcPrice = 0;
let exData = null;
let pairsData = [];
let chartInstance = null;
let chartFetchToken = 0;
let controlsReady = false;

async function load() {
  const cur = settings.get().currency || 'usd';

  try {
    fx = await api.fxRatio();
  } catch (e) {
    fx = 1;
  }

  try {
    const btcPriceData = await api.simplePrice('bitcoin', cur);
    btcPrice = (btcPriceData.bitcoin && btcPriceData.bitcoin[cur]) || 0;
  } catch (e) {
    btcPrice = 0;
  }

  try {
    exData = await api.exchange(exId);
  } catch (err) {
    if (err.status === 404) {
      qs('#exHeader').style.display = 'none';
      qs('.grid-2').style.display = 'none';
      qs('#notFound').hidden = false;
      return;
    }
      qs('#exHeader').innerHTML = emptyState(t('js.failed_to_load'), escapeHtml(err.message || 'network error')) +
      `<div style="text-align:center;padding:0 0 20px"><button class="btn btn-primary" data-action="retry">${t('common.retry')}</button></div>`;
    return;
  }

  setTitle(`${exData.name} — ${t('exchange.titleSuffix')}`);
  renderHeader(exData, cur);
  renderInfo(exData);
  renderAbout(exData);
  
  pairsData = exData.tickers || [];
  renderPairs();
  
  if (!controlsReady) {
    controlsReady = true;
    setupPairsFilter();
    setupChartControls();
  }
  renderChart(qs('#volRange .range-btn.is-active').dataset.days);
}

function renderHeader(data, cur) {
  const score = data.trust_score || 0;
  let scoreClass = 'red';
  if (score >= 8) scoreClass = 'green';
  else if (score >= 5) scoreClass = 'yellow';

  let chips = `<span class="chip trust-${scoreClass}">${t('exchange.trust')} ${score}/10</span>`;
  if (data.trust_score_rank) chips += `<span class="chip">#${data.trust_score_rank}</span>`;
  if (data.centralized !== null) chips += `<span class="chip">${data.centralized ? t('exchange.cex') : t('exchange.dex')}</span>`;
  if (data.country) chips += `<span class="chip">${escapeHtml(data.country)}</span>`;
  if (data.year_established) chips += `<span class="chip">${data.year_established}</span>`;

  const volBtc = data.trade_volume_24h_btc || 0;
  let volHtml = `<div style="font-size: 2rem; font-weight: 700; line-height: 1;">${fmtNumber(volBtc, { max: 0 })} BTC</div>`;
  if (btcPrice) {
    volHtml += `<div style="font-size: 1rem; color: var(--muted); margin-top: 4px;">≈ ${fmtCurrency(volBtc * btcPrice, cur, { compact: true })}</div>`;
  }

  let buttons = '';
  if (data.url) buttons += `<a href="${escapeHtml(data.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">${t('js.website')}</a>`;
  if (data.twitter_handle) buttons += `<a href="https://twitter.com/${escapeHtml(data.twitter_handle)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Twitter</a>`;
  if (data.reddit_url) buttons += `<a href="${escapeHtml(data.reddit_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Reddit</a>`;
  if (data.facebook_url) buttons += `<a href="${escapeHtml(data.facebook_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Facebook</a>`;

  qs('#exHeader').innerHTML = `
    <div class="card-body" style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:24px;">
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div class="coin-title">
          ${data.image ? `<img src="${escapeHtml(data.image)}" alt="${escapeHtml(data.name)}" class="logo-img" referrerpolicy="no-referrer">` : ''}
          <h1 style="margin:0">${escapeHtml(data.name)}</h1>
        </div>
        <div class="chips-row">${chips}</div>
        <div style="display:flex; gap:8px; margin-top:4px;">${buttons}</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end;">
        ${volHtml}
      </div>
    </div>
  `;
}

function renderInfo(data) {
  const volBtc = data.trade_volume_24h_btc || 0;
  const volBtcNorm = data.trade_volume_24h_btc_normalized || 0;
  const pairsCount = data.tickers ? data.tickers.length : 0;
  
  let html = `<div class="stat-list">`;
  html += `<div class="stat-row"><dt>${t('exchange.rank')}</dt><dd>${data.trust_score_rank || '—'}</dd></div>`;
  html += `<div class="stat-row"><dt>${t('exchange.trust')}</dt><dd>${data.trust_score || '—'}/10</dd></div>`;
  html += `<div class="stat-row"><dt>${t('exchange.volume24h')}</dt><dd>${fmtNumber(volBtc, { max: 0 })} BTC</dd></div>`;
  if (volBtcNorm > 0) html += `<div class="stat-row"><dt>${t('exchange.volumeNormalized')}</dt><dd>${fmtNumber(volBtcNorm, { max: 0 })} BTC</dd></div>`;
  html += `<div class="stat-row"><dt>${t('exchange.pairsCount')}</dt><dd>${pairsCount}</dd></div>`;
  html += `<div class="stat-row"><dt>${t('exchange.year')}</dt><dd>${data.year_established || '—'}</dd></div>`;
  html += `<div class="stat-row"><dt>${t('exchange.country')}</dt><dd>${data.country ? escapeHtml(data.country) : '—'}</dd></div>`;
  if (data.centralized !== null) {
    html += `<div class="stat-row"><dt>${t('exchange.type')}</dt><dd>${data.centralized ? t('exchange.cex') : t('exchange.dex')}</dd></div>`;
  }
  html += `</div>`;
  
  qs('#infoBody').innerHTML = html;
}

function renderAbout(data) {
  let text = '—';
  if (data.description) {
    text = escapeHtml(data.description).replace(/\n/g, '<br>');
  }
  qs('#aboutBody').innerHTML = `<div style="color:var(--muted-strong); line-height:1.6">${text}</div>`;
}

function renderPairs(filter = '') {
  const tbody = qs('#pairsBody');
  const cur = settings.get().currency || 'usd';
  
  let list = pairsData.slice();
  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(p => `${p.base}/${p.target}`.toLowerCase().includes(q));
  }
  
  list.sort((a, b) => (b.volume_usd || 0) - (a.volume_usd || 0));
  // CoinGecko omits per-ticker trust scores on the exchange endpoint for most venues; drop the column then.
  const showTrust = pairsData.some(p => p.trust_score);
  
  if (list.length === 0) {
    tbody.innerHTML = emptyState(t('exchange.noPairs'), '');
    return;
  }
  
  let html = `<div class="table-frame"><table class="data-table is-plain">
    <thead>
      <tr>
        <th>#</th>
        <th>${t('exchange.pair')}</th>
        <th>${t('js.price')}</th>
        <th>${t('exchange.volume24h')}</th>
        <th>${t('exchange.spread')}</th>
        ${showTrust ? `<th style="text-align:center">${t('exchange.trust')}</th>` : ''}
        <th></th>
      </tr>
    </thead>
    <tbody>`;
    
  list.forEach((p, i) => {
    let pairHtml = `${escapeHtml(p.base)}/${escapeHtml(p.target)}`;
    if (p.coin_id) {
      pairHtml = `<a href="/coin/${encodeURIComponent(p.coin_id)}" class="ex-link">${escapeHtml(p.base)}</a>/${escapeHtml(p.target)}`;
    }
    
    const price = p.last_usd ? fmtCurrency(p.last_usd * fx, cur) : '—';
    const vol = p.volume_usd ? fmtCurrency(p.volume_usd * fx, cur, { compact: true }) : '—';
    const spread = p.spread !== null && p.spread !== undefined ? fmtPercent(p.spread).replace('+', '') : '—';
    
    let trustClass = 'grey';
    if (p.trust_score === 'green') trustClass = 'green';
    else if (p.trust_score === 'yellow') trustClass = 'yellow';
    else if (p.trust_score === 'red') trustClass = 'red';
    
    const tradeLink = p.trade_url ? `<a href="${escapeHtml(p.trade_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">${t('js.trade')}</a>` : '';
    
    html += `<tr>
      <td>${i + 1}</td>
      <td style="color:var(--blue); font-weight:500;">${pairHtml}</td>
      <td>${price}</td>
      <td>${vol}</td>
      <td>${spread}</td>
      ${showTrust ? `<td style="text-align:center"><span class="trust-dot is-${trustClass}" title="${escapeHtml(p.trust_score || 'unknown')}"></span></td>` : ''}
      <td style="text-align:right">${tradeLink}</td>
    </tr>`;
  });
  
  html += `</tbody></table></div>`;
  tbody.innerHTML = html;
}

function setupPairsFilter() {
  const inp = qs('#pairFilter');
  inp.addEventListener('input', debounce((e) => {
    renderPairs(e.target.value);
  }, 150));
}

function setupChartControls() {
  qsa('#volRange .range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active')) return;
      qsa('#volRange .range-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      renderChart(btn.dataset.days);
    });
  });
}

async function renderChart(days) {
  chartFetchToken++;
  const currentToken = chartFetchToken;
  
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  
  const cur = settings.get().currency || 'usd';
  const container = qs('#volumeCard .card-body');
  
  try {
    const raw = await api.exchangeVolume(exId, days);
    if (currentToken !== chartFetchToken) return;
    if (!raw || raw.length === 0) {
      container.innerHTML = emptyState(t('js.no_data'), '');
      return;
    }
    
    // Check if we need to restore canvas
    if (!qs('#volumeChart', container)) {
      container.innerHTML = '<canvas id="volumeChart"></canvas>';
    }
    const canvas = qs('#volumeChart', container);
    
    await new Promise(r => {
      if (window.Chart) r();
      else {
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          if (window.Chart || tries > 100) { clearInterval(iv); r(); }
        }, 50);
      }
    });
    if (!window.Chart) return;
    
    const labels = [];
    const data = [];
    
    raw.forEach(p => {
      labels.push(fmtDate(p[0]));
      data.push(p[1]);
    });
    
    const style = getComputedStyle(document.documentElement);
    const colorLine = style.getPropertyValue('--line').trim() || '#263442';
    const colorMuted = style.getPropertyValue('--muted-strong').trim() || '#a9b5bf';
    
    const config = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: '#4ea1ff',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => fmtDate(raw[ctx[0].dataIndex][0]),
              label: ctx => {
                const volBtc = ctx.raw;
                let lbl = fmtNumber(volBtc, { max: 0 }) + ' BTC';
                if (btcPrice) {
                  lbl += ` (${fmtCurrency(volBtc * btcPrice, cur, { compact: true })})`;
                }
                return ' ' + lbl;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: colorMuted, maxTicksLimit: 8, maxRotation: 0, autoSkip: true },
            grid: { display: false }
          },
          y: {
            position: 'right',
            ticks: {
              color: colorMuted,
              callback: v => fmtNumber(v, { max: 0 }) + ' BTC'
            },
            grid: { color: 'rgba(128,128,128,.12)' }
          }
        }
      }
    };
    
    chartInstance = new Chart(canvas, config);
    
  } catch (err) {
    if (currentToken !== chartFetchToken) return;
    container.innerHTML = emptyState(t('js.failed_to_load'), '');
  }
}
