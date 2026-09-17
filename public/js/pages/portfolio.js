import { initLayout, setTitle, toast, qs, qsa, debounce } from '../layout.js';
import { settings, portfolio } from '../store.js';
import { api } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { fmtCurrency, fmtPercent, fmtCompact, fmtNumber, escapeHtml, fmtDate, toCsv, downloadCsv } from '../format.js';
import { emptyState, changeBadge } from '../components.js';
import { t } from '../i18n.js';

let fx = 1;
let currentCoinIds = [];
let chartInstance = null;
let txFilterCoin = null;
let editingTxId = null;

async function loadFx() {
  fx = await api.fxRatio();
}

const PALETTE = [
  '#4ea1ff', '#20c997', '#f5b451', '#ff5c73', 
  '#9b51e0', '#f2994a', '#2d9cdb', '#eb5757', '#6fcf97'
];

let histDays = 30;
let histChart = null;
let histToken = 0;

async function renderHistory() {
  const card = qs('#historyCard');
  if (!card) return;
  const holdings = portfolio.holdings().filter(h => h.amount > 0);
  if (holdings.length === 0) {
    card.hidden = true;
    if (histChart) { histChart.destroy(); histChart = null; }
    return;
  }
  card.hidden = false;

  const top = holdings.slice(0, 10);
  const token = ++histToken;
  const results = await Promise.allSettled(top.map(h => api.chart(h.coinId, histDays)));
  if (token !== histToken) return;

  const validSeries = [];
  let failedCount = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value && results[i].value.prices) {
      validSeries.push({ coinId: top[i].coinId, prices: results[i].value.prices });
    } else {
      failedCount++;
    }
  }

  const note = qs('#historyNote');
  note.textContent = failedCount > 0 ? t('portfolio.historyPartial', { n: failedCount }) : '';

  if (validSeries.length === 0) return;

  let longest = validSeries[0].prices;
  for (const s of validSeries) {
    if (s.prices.length > longest.length) longest = s.prices;
  }

  const txs = portfolio.list();
  const cur = settings.get().currency || 'usd';

  const timestamps = longest.map(p => p[0]);
  const valueData = [];
  const investedData = [];

  for (const ts of timestamps) {
    let valSum = 0;
    let invSum = 0;

    for (const h of top) {
      let amt = 0;
      let buyCost = 0;
      let sellCost = 0;
      for (const tx of txs) {
        if (tx.coinId === h.coinId && tx.date <= ts) {
          if (tx.type === 'buy') {
            amt += tx.amount;
            buyCost += tx.amount * tx.price;
          } else if (tx.type === 'sell') {
            amt -= tx.amount;
            sellCost += tx.amount * tx.price;
          }
        }
      }

      const s = validSeries.find(x => x.coinId === h.coinId);
      if (s && amt > 0) {
        let price = s.prices[0][1];
        for (let i = s.prices.length - 1; i >= 0; i--) {
          if (s.prices[i][0] <= ts) {
            price = s.prices[i][1];
            break;
          }
        }
        valSum += amt * price;
      }
      
      invSum += (buyCost - sellCost);
    }
    investedData.push(Math.max(0, invSum * fx));
    valueData.push(valSum);
  }

  const firstVal = valueData[0] || 0;
  const lastVal = valueData[valueData.length - 1] || 0;
  const valColor = lastVal >= firstVal ? '#20c997' : '#ff5c73';

  const ctx = qs('#historyChart');
  if (!ctx) return;

  const data = {
    labels: timestamps,
    datasets: [
      {
        label: t('portfolio.value'),
        data: valueData,
        borderColor: valColor,
        backgroundColor: valColor + '22',
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.25
      },
      {
        label: t('portfolio.invested'),
        data: investedData,
        borderColor: '#8795a4',
        borderDash: [4, 4],
        fill: false,
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0
      }
    ]
  };

  if (histChart) {
    histChart.data = data;
    histChart.options.plugins.legend.labels.color = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    histChart.update();
  } else {
    histChart = new Chart(ctx, {
      type: 'line',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: { maxTicksLimit: 8, callback: function(val) { return fmtDate(Number(this.getLabelForValue(val))); } },
            grid: { color: 'rgba(128,128,128,.12)' }
          },
          y: {
            ticks: { callback: function(val) { return fmtCurrency(val, settings.get().currency || 'usd'); } },
            grid: { color: 'rgba(128,128,128,.12)' }
          }
        },
        plugins: {
          legend: { position: 'top', align: 'end', labels: { font: { size: 11 }, boxWidth: 10, color: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() } },
          tooltip: {
            callbacks: {
              title: function(ctxs) { return fmtDate(Number(ctxs[0].label)); },
              label: function(context) { return context.dataset.label + ': ' + fmtCurrency(context.raw, settings.get().currency || 'usd'); }
            }
          }
        }
      }
    });
  }
}

async function load() {
  const container = qs('#holdingsTable');
  const sumContainer = qs('#portfolioSummary');
  const cur = settings.get().currency || 'usd';

  const holdings = portfolio.holdings().filter(h => h.amount > 0);
  currentCoinIds = holdings.map(h => h.coinId);

  let markets = [];
  if (currentCoinIds.length > 0) {
    try {
      markets = await api.markets({ ids: currentCoinIds.join(','), perPage: 250 });
    } catch (e) {
      toast(t('js.failed_to_load_live_prices'), { type: 'error' });
    }
  }

  const marketMap = {};
  markets.forEach(m => { marketMap[m.id] = m; });

  let totalValue = 0;
  let totalCost = 0;
  let total24hChangeAbs = 0;

  const rows = holdings.map(h => {
    const m = marketMap[h.coinId];
    const priceCur = m ? m.current_price : 0;
    const change24h = m ? (m.price_change_percentage_24h_in_currency ?? m.price_change_percentage_24h ?? 0) : 0;
    
    const value = h.amount * priceCur;
    const cost = h.costBasisUsd * fx;
    const pnl = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    const change24hAbs = value - (value / (1 + change24h / 100));

    totalValue += value;
    totalCost += cost;
    total24hChangeAbs += change24hAbs;

    return {
      ...h,
      priceCur,
      change24h,
      value,
      cost,
      pnl,
      pnlPct,
      priceUsd: m && m.current_price_usd ? m.current_price_usd : (priceCur / fx)
    };
  });

  rows.sort((a, b) => b.value - a.value);

  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  
  sumContainer.innerHTML = `
    <div class="card" style="flex:1; min-width:200px">
      <div class="card-body">
        <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('js.total_balance')}</div>
        <div style="font-size:1.5rem; font-weight:700" id="totalBalanceVal">${fmtCurrency(totalValue, cur)}</div>
      </div>
    </div>
    <div class="card" style="flex:1; min-width:200px">
      <div class="card-body">
        <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('js.24h_change')}</div>
        <div style="display:flex; align-items:center; gap:8px">
          <span style="font-size:1.2rem; font-weight:600" id="total24hVal">${fmtCurrency(Math.abs(total24hChangeAbs), cur)}</span>
          ${changeBadge(totalValue > 0 ? (total24hChangeAbs/totalValue)*100 : 0, 'id="total24hBadge"')}
        </div>
      </div>
    </div>
    <div class="card" style="flex:1; min-width:200px">
      <div class="card-body">
        <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('js.total_p_l')}</div>
        <div style="display:flex; align-items:center; gap:8px">
          <span style="font-size:1.2rem; font-weight:600" id="totalPnlVal">${fmtCurrency(Math.abs(totalPnl), cur)}</span>
          ${changeBadge(totalPnlPct, 'id="totalPnlBadge"')}
        </div>
      </div>
    </div>
    <div class="card" style="flex:1; min-width:120px">
      <div class="card-body">
        <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('js.holdings_count')}</div>
        <div style="font-size:1.5rem; font-weight:700">${rows.length}</div>
      </div>
    </div>
  `;

  if (rows.length === 0) {
    container.innerHTML = emptyState(t('js.no_holdings'), t('js.add_a_transaction_to_get_started'));
  } else {
    let tbody = '';
    rows.forEach(r => {
      tbody += `
        <tr data-coin-id="${escapeHtml(r.coinId)}">
          <td>
            <a class="asset-cell" href="/coin/${escapeHtml(r.coinId)}">
              <img src="${escapeHtml(r.image)}" alt="${escapeHtml(r.name)}" width="24" height="24" style="border-radius:50%">
              <span class="asset-copy">
                <span class="asset-name">${escapeHtml(r.name)}</span>
                <span class="asset-symbol">${escapeHtml(r.symbol.toUpperCase())}</span>
              </span>
            </a>
          </td>
          <td class="price-cell" data-live-price="${escapeHtml(r.coinId)}" data-price-usd="${r.priceUsd}">${fmtCurrency(r.priceCur, cur)}</td>
          <td>
            <div data-live-holdings-value="${escapeHtml(r.coinId)}" data-amount="${r.amount}">${fmtCurrency(r.value, cur)}</div>
            <div style="color:var(--muted); font-size:0.8rem">${fmtNumber(r.amount, { max: 8 })} ${escapeHtml(r.symbol.toUpperCase())}</div>
          </td>
          <td>${fmtCurrency(r.avgPriceUsd * fx, cur)}</td>
          <td>
            <div data-live-pnl="${escapeHtml(r.coinId)}" data-cost="${r.cost}">${fmtCurrency(Math.abs(r.pnl), cur)}</div>
            <div data-live-pnl-pct="${escapeHtml(r.coinId)}">${changeBadge(r.pnlPct)}</div>
          </td>
          <td>${changeBadge(r.change24h, `data-live-change="${escapeHtml(r.coinId)}"`)}</td>
          <td>
            <div style="display:flex; gap:4px; justify-content:flex-end">
              <button class="btn btn-ghost btn-sm action-add" data-id="${escapeHtml(r.coinId)}" title="Add transaction">+</button>
              <button class="btn btn-ghost btn-sm action-filter" data-id="${escapeHtml(r.coinId)}" title="Filter transactions">≡</button>
              <button class="btn btn-ghost btn-sm action-remove" data-id="${escapeHtml(r.coinId)}" title="Remove asset">×</button>
            </div>
          </td>
        </tr>
      `;
    });
    container.innerHTML = `
      <div class="table-frame">
        <table class="data-table is-plain">
          <thead>
            <tr>
              <th>${t('js.coin')}</th>
              <th>${t('js.price')}</th>
              <th>${t('js.holdings')}</th>
              <th>${t('js.avg_buy_price')}</th>
              <th>${t('js.p_l')}</th>
              <th>${t('js.24h')}</th>
              <th style="text-align:right">${t('js.actions')}</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    `;
  }

  const allocCanvas = qs('#allocChart');
  if (rows.length === 0) {
    if (chartInstance) chartInstance.destroy();
    allocCanvas.style.display = 'none';
  } else {
    allocCanvas.style.display = 'block';
    const top = rows.slice(0, 8);
    const other = rows.slice(8);
    const labels = top.map(r => r.symbol.toUpperCase());
    const data = top.map(r => r.value);
    if (other.length > 0) {
      labels.push('Other');
      data.push(other.reduce((s, r) => s + r.value, 0));
    }
    const colors = PALETTE.slice(0, labels.length);
    
    if (chartInstance) {
      chartInstance.data.labels = labels;
      chartInstance.data.datasets[0].data = data;
      chartInstance.data.datasets[0].backgroundColor = colors;
      chartInstance.update();
    } else {
      chartInstance = new Chart(allocCanvas, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: { position: 'bottom', labels: { color: '#eef4f8', padding: 20 } },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const val = ctx.raw;
                  const pct = totalValue > 0 ? (val / totalValue) * 100 : 0;
                  return ` ${ctx.label}: ${fmtCurrency(val, cur)} (${fmtPercent(pct)})`;
                }
              }
            }
          }
        }
      });
    }
  }

  renderTransactions();
  renderHistory().catch(() => {});
}

function renderTransactions() {
  const cur = settings.get().currency || 'usd';
  let txs = portfolio.list();
  txs.sort((a, b) => b.date - a.date);

  const filterSpan = qs('#txFilterSpan');
  if (txFilterCoin) {
    const fTxs = txs.filter(t => t.coinId === txFilterCoin);
    const sym = fTxs.length > 0 ? fTxs[0].symbol.toUpperCase() : 'Coin';
    filterSpan.innerHTML = `Showing: ${escapeHtml(sym)} &middot; <a href="#" id="clearTxFilter" style="color:var(--blue)">clear filter</a>`;
    txs = fTxs;
  } else {
    filterSpan.innerHTML = '';
  }

  const container = qs('#txTable');
  if (txs.length === 0) {
    if (txFilterCoin) {
      container.innerHTML = emptyState(t('js.no_transactions_found'), t('js.no_transactions_match_the_current_filter'));
    } else {
      container.innerHTML = emptyState(t('js.no_transactions_yet'), t('js.add_your_first_buy_to_start_tracking'));
      container.innerHTML += `<div style="text-align:center; padding-bottom:32px;"><button class="btn btn-primary action-add-empty">${t('js.add_transaction')}</button></div>`;
    }
    return;
  }

  let tbody = '';
  txs.forEach(tx => {
    const isBuy = tx.type === 'buy';
    const priceCur = tx.price * fx;
    const total = tx.amount * priceCur;
    tbody += `
      <tr>
        <td style="text-align:left">${fmtDate(tx.date)}</td>
        <td style="text-align:left"><span class="tx-type ${isBuy ? 'buy' : 'sell'}">${isBuy ? t('js.buy') : t('js.sell')}</span></td>
        <td style="text-align:left">
          <div style="display:flex; align-items:center; gap:8px">
            <img src="${escapeHtml(tx.image)}" width="16" height="16" style="border-radius:50%">
            ${escapeHtml(tx.name)}
          </div>
        </td>
        <td>${fmtNumber(tx.amount, { max: 8 })} ${escapeHtml(tx.symbol.toUpperCase())}</td>
        <td>${fmtCurrency(priceCur, cur)}</td>
        <td>${fmtCurrency(total, cur)}</td>
        <td style="max-width:150px; overflow:hidden; text-overflow:ellipsis" title="${escapeHtml(tx.note || '')}">${escapeHtml(tx.note || '-')}</td>
        <td>
          <button class="btn btn-ghost btn-sm tx-edit" data-id="${escapeHtml(tx.id)}">${t('js.edit')}</button>
          <button class="btn btn-ghost btn-sm tx-del" data-id="${escapeHtml(tx.id)}" style="color:var(--red)">${t('js.delete')}</button>
        </td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="table-frame">
      <table class="data-table is-plain">
        <thead>
          <tr>
            <th>${t('js.date')}</th>
            <th>${t('js.type')}</th>
            <th>${t('js.coin')}</th>
            <th>${t('js.amount')}</th>
            <th>${t('js.price')}</th>
            <th>${t('js.total')}</th>
            <th>${t('js.note')}</th>
            <th style="text-align:right">${t('js.action')}</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

// Modal handling
let modalActive = false;
let selectedCoin = null;

function buildModal() {
  if (qs('#txModalBackdrop')) return;
  const html = `
    <div class="modal-backdrop" id="txModalBackdrop" style="display:none">
      <div class="modal">
        <div class="modal-head">
          <span id="txModalTitle">${t('js.add_transaction')}</span>
          <button class="btn btn-ghost btn-sm" id="txModalClose">×</button>
        </div>
        <div class="modal-body">
          <form id="txForm" class="modal-form-grid">
            <div class="field full-width autocomplete" id="txCoinSearchField">
              <label>${t('js.coin')}</label>
              <input type="text" class="input" id="txCoinSearch" placeholder="Search coin..." autocomplete="off">
              <div class="autocomplete-dropdown" id="txCoinDropdown" style="display:none"></div>
              <div id="txSelectedCoin" style="display:none; margin-top:8px;"></div>
            </div>
            
            <div class="field full-width">
              <label>${t('js.type')}</label>
              <div class="toggle-group" style="width:100%; display:flex;">
                <button type="button" class="range-btn is-active" style="flex:1" data-val="buy">${t('js.buy')}</button>
                <button type="button" class="range-btn" style="flex:1" data-val="sell">${t('js.sell')}</button>
              </div>
              <input type="hidden" id="txType" value="buy">
            </div>

            <div class="field">
              <label>${t('js.amount')}</label>
              <input type="number" class="input" id="txAmount" step="any" min="0" required>
            </div>
            <div class="field">
              <label>${t('js.price_per_coin')}</label>
              <input type="number" class="input" id="txPrice" step="any" min="0" required>
            </div>
            
            <div class="field">
              <label>${t('js.date')}</label>
              <input type="datetime-local" class="input" id="txDate" required>
            </div>
            <div class="field">
              <label>${t('js.note_optional')}</label>
              <input type="text" class="input" id="txNote">
            </div>
          </form>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" id="txModalCancel">${t('js.cancel')}</button>
          <button class="btn btn-primary" id="txModalSave">${t('js.save')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  
  const backdrop = qs('#txModalBackdrop');
  qs('#txModalClose').addEventListener('click', closeModal);
  qs('#txModalCancel').addEventListener('click', closeModal);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  
  qsa('.toggle-group .range-btn', backdrop).forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.toggle-group .range-btn', backdrop).forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      qs('#txType').value = btn.dataset.val;
    });
  });

  const searchInp = qs('#txCoinSearch');
  const dd = qs('#txCoinDropdown');
  
  const doSearch = debounce(async (q) => {
    if (!q) { dd.style.display = 'none'; return; }
    try {
      const res = await api.search(q);
      const coins = res.coins || [];
      if (coins.length === 0) {
        dd.innerHTML = `<div class="autocomplete-item" style="color:var(--muted)">${t('js.no_coins_found')}</div>`;
      } else {
        dd.innerHTML = coins.map(c => `
          <div class="autocomplete-item tx-coin-item" data-id="${escapeHtml(c.id)}" data-symbol="${escapeHtml(c.symbol)}" data-name="${escapeHtml(c.name)}" data-thumb="${escapeHtml(c.thumb)}">
            <img src="${escapeHtml(c.thumb)}" width="20" height="20" style="border-radius:50%">
            <span>${escapeHtml(c.name)}</span>
            <span style="color:var(--muted); font-size:0.8rem">${escapeHtml(c.symbol)}</span>
            <span style="margin-left:auto; color:var(--muted); font-size:0.8rem">#${c.market_cap_rank||'-'}</span>
          </div>
        `).join('');
      }
      dd.style.display = 'block';
    } catch (e) {}
  }, 250);

  searchInp.addEventListener('input', e => doSearch(e.target.value));
  
  dd.addEventListener('click', e => {
    const item = e.target.closest('.tx-coin-item');
    if (!item) return;
    dd.style.display = 'none';
    selectTxCoin({ id: item.dataset.id, symbol: item.dataset.symbol, name: item.dataset.name, thumb: item.dataset.thumb });
  });

  qs('#txModalSave').addEventListener('click', saveTx);
}

function pad(n) { return n < 10 ? '0'+n : n; }
function localIsoStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

async function selectTxCoin(coin) {
  const searchInp = qs('#txCoinSearch');
  const sel = qs('#txSelectedCoin');
  searchInp.style.display = 'none';
  selectedCoin = coin;
  sel.innerHTML = `
    <div class="chip" style="font-size:0.9rem; padding:6px 12px">
      <img src="${escapeHtml(selectedCoin.thumb || '')}" width="16" height="16" style="border-radius:50%">
      ${escapeHtml(selectedCoin.name)} (${escapeHtml(String(selectedCoin.symbol || '').toUpperCase())})
      <button type="button" class="btn btn-ghost btn-sm" style="margin-left:8px; padding:0 4px" id="txClearCoin">×</button>
    </div>
  `;
  sel.style.display = 'block';
  qs('#txClearCoin').addEventListener('click', () => {
    selectedCoin = null;
    sel.style.display = 'none';
    searchInp.style.display = 'block';
    searchInp.value = '';
    searchInp.focus();
  });
  try {
    const cur = settings.get().currency || 'usd';
    const prices = await api.simplePrice(selectedCoin.id, cur);
    if (prices && prices[selectedCoin.id] && prices[selectedCoin.id][cur]) {
      qs('#txPrice').value = prices[selectedCoin.id][cur];
    }
  } catch (err) {}
}

function openModal(prefillCoinId = null) {
  buildModal();
  editingTxId = null;
  qs('#txModalTitle').textContent = t('js.add_transaction');
  qs('#txForm').reset();
  qs('#txDate').value = localIsoStr(new Date());
  qsa('.toggle-group .range-btn').forEach(b => b.classList.remove('is-active'));
  qs('.toggle-group .range-btn[data-val="buy"]').classList.add('is-active');
  qs('#txType').value = 'buy';
  
  selectedCoin = null;
  qs('#txSelectedCoin').style.display = 'none';
  const searchInp = qs('#txCoinSearch');
  searchInp.style.display = 'block';
  searchInp.value = '';
  qs('#txCoinDropdown').style.display = 'none';

  qs('#txModalBackdrop').style.display = 'flex';
  modalActive = true;

  if (prefillCoinId) {
    api.search(prefillCoinId).then(res => {
      const c = (res.coins || []).find(x => x.id === prefillCoinId) || (res.coins || [])[0];
      if (c) selectTxCoin({ id: c.id, symbol: c.symbol, name: c.name, thumb: c.thumb });
      else searchInp.focus();
    }).catch(() => searchInp.focus());
  } else {
    setTimeout(() => searchInp.focus(), 50);
  }
}

async function openEditModal(id) {
  const tx = portfolio.list().find(item => item.id === id);
  if (!tx) return;

  openModal();
  editingTxId = id;
  qs('#txModalTitle').textContent = t('js.edit_transaction');
  qsa('.toggle-group .range-btn').forEach(b => b.classList.remove('is-active'));
  qs(`.toggle-group .range-btn[data-val="${tx.type}"]`).classList.add('is-active');
  qs('#txType').value = tx.type;
  await selectTxCoin({ id: tx.coinId, symbol: tx.symbol, name: tx.name, thumb: tx.image });
  qs('#txPrice').value = tx.price * fx;
  qs('#txAmount').value = tx.amount;
  qs('#txDate').value = localIsoStr(new Date(tx.date));
  qs('#txNote').value = tx.note || '';
}

function closeModal(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (qs('#txModalBackdrop')) {
    qs('#txModalBackdrop').style.display = 'none';
  }
  modalActive = false;
}

function saveTx(e) {
  e.preventDefault();
  if (!selectedCoin) {
    toast(t('js.please_select_a_coin'), { type: 'error' });
    return;
  }
  const type = qs('#txType').value;
  const amount = Number(qs('#txAmount').value);
  const priceCur = Number(qs('#txPrice').value);
  const dateStr = qs('#txDate').value;
  const note = qs('#txNote').value.trim();

  if (!amount || amount <= 0) { toast(t('js.invalid_amount'), {type:'error'}); return; }
  if (priceCur < 0) { toast(t('js.invalid_price'), {type:'error'}); return; }

  if (type === 'sell') {
    const held = portfolio.list()
      .filter(tx => tx.coinId === selectedCoin.id && tx.id !== editingTxId)
      .reduce((sum, tx) => sum + (tx.type === 'buy' ? tx.amount : -tx.amount), 0);
    if (amount > held) {
      toast(t('js.cannot_sell_more', { amount, symbol: selectedCoin.symbol.toUpperCase(), held }), {type:'error'});
      return;
    }
  }

  const priceUsd = priceCur / fx;
  const d = new Date(dateStr).getTime();

  const tx = {
    coinId: selectedCoin.id,
    symbol: selectedCoin.symbol,
    name: selectedCoin.name,
    image: selectedCoin.thumb || selectedCoin.image,
    type,
    amount,
    price: priceUsd,
    date: isNaN(d) ? Date.now() : d,
    note
  };

  if (editingTxId) {
    portfolio.update(editingTxId, tx);
    toast(t('js.transaction_updated'), {type:'success'});
    editingTxId = null;
  } else {
    portfolio.add(tx);
    toast(t('js.transaction_saved'), {type:'success'});
  }
  closeModal();
  load();
}

async function init() {
  initLayout({ active: 'portfolio' });
  setTitle('My Portfolio');

  await loadFx();
  await load();

  live.subscribe(tick => {
    const container = qs('#holdingsTable');
    if (container) {
      applyLiveTick(container, tick, fx);
      recomputeLiveTotals(tick);
    }
  });

  window.addEventListener('currency:change', async () => {
    await loadFx();
    await load();
  });
  window.addEventListener('portfolio:change', load);
  
  qs('#histRange').addEventListener('click', e => {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;
    qsa('.range-btn', qs('#histRange')).forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    histDays = Number(btn.dataset.days);
    renderHistory().catch(() => {});
  });

  qs('#addTxBtn').addEventListener('click', () => openModal());

  // Privacy mode: blur every monetary figure (persisted in settings.privacy).
  const privacyBtn = qs('#privacyBtn');
  const applyPrivacy = () => {
    const on = settings.get().privacy === true;
    document.body.classList.toggle('is-private', on);
    privacyBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    privacyBtn.classList.toggle('is-active', on);
    privacyBtn.title = on ? t('portfolio.privacyOff') : t('portfolio.privacy');
  };
  privacyBtn.addEventListener('click', () => { settings.set({ privacy: !(settings.get().privacy === true) }); applyPrivacy(); });
  applyPrivacy();

  // Deep link from coin pages: /portfolio?add=<coinId> opens the transaction modal pre-filled.
  const addId = new URLSearchParams(location.search).get('add');
  if (addId && /^[a-z0-9-]{1,100}$/.test(addId)) {
    history.replaceState(null, '', '/portfolio');
    openModal(addId);
  }
  
  qs('#clearBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your entire portfolio?')) {
      portfolio.clear();
      toast(t('js.portfolio_cleared'));
    }
  });

  qs('#exportBtn').addEventListener('click', () => {
    const data = JSON.stringify(portfolio.list(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cryptolive-portfolio.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  qs('#exportCsvBtn')?.addEventListener('click', () => {
    const headers = ['Date', 'Type', 'Coin', 'Symbol', 'Amount', 'Price (USD)', 'Total (USD)', 'Note'];
    const rows = portfolio.list().map(tx => [
      new Date(tx.date).toISOString(),
      tx.type,
      tx.name,
      (tx.symbol || '').toUpperCase(),
      tx.amount,
      tx.price,
      tx.amount * tx.price,
      tx.note || ''
    ]);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`cryptolive-transactions-${dateStr}.csv`, toCsv(headers, rows));
  });

  qs('#importInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const arr = JSON.parse(ev.target.result);
        if (Array.isArray(arr)) {
          portfolio.clear();
          arr.forEach(tx => portfolio.add(tx));
          toast(t('js.portfolio_imported'), {type:'success'});
        }
      } catch (err) {
        toast(t('js.invalid_json_file'), {type:'error'});
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  document.addEventListener('click', e => {
    if (e.target.closest('.action-add')) {
      const id = e.target.closest('button').dataset.id;
      openModal(id);
    } else if (e.target.closest('.action-add-empty')) {
      openModal();
    } else if (e.target.closest('.action-filter')) {
      const id = e.target.closest('button').dataset.id;
      txFilterCoin = id;
      renderTransactions();
      qs('#txTableCard').scrollIntoView({ behavior: 'smooth' });
    } else if (e.target.closest('.action-remove')) {
      const id = e.target.closest('button').dataset.id;
      if (confirm('Remove all transactions for this coin?')) {
        const txs = portfolio.list().filter(t => t.coinId === id);
        txs.forEach(t => portfolio.remove(t.id));
        toast(t('js.asset_removed'));
      }
    } else if (e.target.closest('.tx-edit')) {
      const id = e.target.closest('button').dataset.id;
      openEditModal(id);
    } else if (e.target.closest('.tx-del')) {
      const id = e.target.closest('button').dataset.id;
      portfolio.remove(id);
      toast(t('js.transaction_deleted'));
    } else if (e.target.closest('#clearTxFilter')) {
      e.preventDefault();
      txFilterCoin = null;
      renderTransactions();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalActive) closeModal();
  });
}

function recomputeLiveTotals(tick) {
  if (!tick || !tick.prices) return;
  const container = qs('#holdingsTable');
  if (!container) return;
  const cur = settings.get().currency || 'usd';

  let tVal = 0;
  let tCost = 0;
  let t24hAbs = 0;
  let anyChanged = false;

  qsa('tr[data-coin-id]', container).forEach(tr => {
    const id = tr.dataset.coinId;
    const pnlEl = qs(`[data-live-pnl="${id}"]`, tr);
    const pnlPctEl = qs(`[data-live-pnl-pct="${id}"]`, tr);
    const holdEl = qs(`[data-live-holdings-value="${id}"]`, tr);
    const priceEl = qs(`[data-live-price="${id}"]`, tr);
    
    if (holdEl && pnlEl && priceEl) {
      const amt = Number(holdEl.dataset.amount) || 0;
      const cost = Number(pnlEl.dataset.cost) || 0;
      const priceUsd = Number(priceEl.dataset.priceUsd) || 0;
      const priceCur = priceUsd * fx;
      const val = amt * priceCur;
      
      const pnl = val - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      
      if (tick.prices[id]) {
        anyChanged = true;
        holdEl.textContent = fmtCurrency(val, cur);
        pnlEl.textContent = fmtCurrency(Math.abs(pnl), cur);
        if (pnlPctEl) pnlPctEl.innerHTML = changeBadge(pnlPct);
      }
      
      tVal += val;
      tCost += cost;
      
      const change24h = tick.prices[id] ? tick.prices[id].c : (Number(qs(`[data-live-change="${id}"]`, tr)?.textContent.replace(/[^0-9.-]/g, '')) || 0);
      t24hAbs += val - (val / (1 + change24h / 100));
    }
  });

  if (anyChanged) {
    const tPnl = tVal - tCost;
    const tPnlPct = tCost > 0 ? (tPnl / tCost) * 100 : 0;
    
    const bv = qs('#totalBalanceVal');
    if (bv) bv.textContent = fmtCurrency(tVal, cur);
    const dv = qs('#total24hVal');
    if (dv) dv.textContent = fmtCurrency(Math.abs(t24hAbs), cur);
    const db = qs('#total24hBadge');
    if (db) db.outerHTML = changeBadge(tVal > 0 ? (t24hAbs/tVal)*100 : 0, 'id="total24hBadge"');
    
    const pv = qs('#totalPnlVal');
    if (pv) pv.textContent = fmtCurrency(Math.abs(tPnl), cur);
    const pb = qs('#totalPnlBadge');
    if (pb) pb.outerHTML = changeBadge(tPnlPct, 'id="totalPnlBadge"');
  }
}

init();
