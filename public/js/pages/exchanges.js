import { initLayout, qs, debounce } from '../layout.js';
import { api } from '../api.js';
import { renderPagination, skeletonRows } from '../components.js';
import { fmtCurrency, fmtNumber, escapeHtml } from '../format.js';
import { settings } from '../store.js';
import { t } from '../i18n.js';

initLayout({ active: 'exchanges' });

const exTable = qs('#exTable');
const exPagination = qs('#exPagination');

let currentPage = 1;
const PER_PAGE = 50;
let allRows = [];        // up to 250 exchanges, fetched once per currency
let btcPrice = 0;
let query = '';
let sortBy = 'trust';
let typeFilter = 'all';

function isDex(ex) {
  // CoinGecko has no explicit flag on the list endpoint; DEXes carry no country/year and typically no trust rank.
  const DEX_NAME = /swap|dex|dao|protocol|finance|curve|balancer|raydium|orca|jupiter|dydx|hyperliquid|aerodrome|velodrome|1inch|osmosis|thorchain|meteora|joe|camelot|kyber|dodo|gmx|maverick|ambient|fluid|ekubo|lifinity|phoenix|drift|vertex|\(.*(ethereum|bsc|base|arbitrum|solana|polygon|optimism|avalanche|sui|aptos)\)/i;
  return ex.centralized === false || (!ex.country && DEX_NAME.test(ex.name || ''));
}

function filteredRows() {
  const q = query.trim().toLowerCase();
  let rows = allRows.filter(ex => {
    if (q && !(String(ex.name || '').toLowerCase().includes(q) || String(ex.country || '').toLowerCase().includes(q) || String(ex.id || '').includes(q))) return false;
    if (typeFilter === 'dex' && !isDex(ex)) return false;
    if (typeFilter === 'cex' && isDex(ex)) return false;
    return true;
  });
  const cmp = {
    trust: (a, b) => (a.trust_score_rank ?? 1e9) - (b.trust_score_rank ?? 1e9),
    volume: (a, b) => (b.trade_volume_24h_btc || 0) - (a.trade_volume_24h_btc || 0),
    year: (a, b) => (a.year_established || 9999) - (b.year_established || 9999),
    name: (a, b) => String(a.name || '').localeCompare(String(b.name || ''))
  }[sortBy] || (() => 0);
  return rows.sort(cmp);
}

async function loadData() {
  exTable.innerHTML = `
    <div class="table-frame">
      <table class="data-table is-plain">
        <thead><tr><th>#</th><th>${t('js.exchange')}</th><th>${t('js.trust_score')}</th><th>${t('js.24h_volume')}</th><th>${t('js.year')}</th><th>${t('js.website')}</th></tr></thead>
        <tbody>${skeletonRows(50, 6)}</tbody>
      </table>
    </div>
  `;
  exPagination.innerHTML = '';

  const cur = settings.get().currency || 'usd';

  try {
    if (allRows.length === 0) {
      const [btcPriceData, rows] = await Promise.all([
        api.simplePrice('bitcoin', cur).catch(() => ({})),
        api.exchanges(1, 250)
      ]);
      btcPrice = (btcPriceData.bitcoin && btcPriceData.bitcoin[cur]) || 0;
      allRows = rows;
    }
    renderTable();
  } catch (err) {
    console.error('Exchanges load error', err);
    exTable.innerHTML = `
      <div class="card" style="padding: 32px; text-align: center;">
        <p style="color: var(--red); margin-bottom: 16px;">${t('js.failed_to_load_exchanges')}</p>
        <button class="btn btn-primary" data-action="retry">${t('js.retry')}</button>
      </div>
    `;
    exPagination.innerHTML = '';
  }
}

function renderTable() {
  const cur = settings.get().currency || 'usd';
  const rowsAll = filteredRows();
  const totalPages = Math.max(1, Math.ceil(rowsAll.length / PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  const rows = rowsAll.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);
  qs('#exCount').textContent = t('exchanges.count', { n: rowsAll.length });
  {
    let tbody = '';
    
    rows.forEach(ex => {
      const rank = ex.trust_score_rank != null ? ex.trust_score_rank : '-';
      
      const score = ex.trust_score || 0;
      let scoreColor = 'red';
      if (score >= 8) scoreColor = 'green';
      else if (score >= 5) scoreColor = 'yellow';
      
      const volBtc = ex.trade_volume_24h_btc || 0;
      const volFiat = volBtc * btcPrice;
      
      const year = ex.year_established || '—';
      const country = ex.country ? `<div style="font-size: 12px; color: var(--muted); margin-top: 2px;">${escapeHtml(ex.country)}</div>` : '';
      
      tbody += `
        <tr>
          <td>${escapeHtml(String(rank))}</td>
          <td>
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${escapeHtml(ex.image)}" alt="${escapeHtml(ex.name)}" width="24" height="24" style="border-radius: 50%;" loading="lazy" referrerpolicy="no-referrer">
              <div>
                <div style="font-weight: 500;"><a href="/exchange/${encodeURIComponent(ex.id)}" class="ex-link">${escapeHtml(ex.name)}</a></div>
                ${country}
              </div>
            </div>
          </td>
          <td>
            <span class="chip trust-${scoreColor}">${score}/10</span>
          </td>
          <td>
            <div>${fmtCurrency(volFiat, cur, { compact: false })}</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">${fmtNumber(volBtc, { max: 0 })} BTC</div>
          </td>
          <td>${escapeHtml(String(year))}</td>
          <td>
            ${ex.url ? `<a href="${escapeHtml(ex.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">${t('js.website')}</a>` : '—'}
          </td>
        </tr>
      `;
    });

    exTable.innerHTML = `
      <div class="table-frame">
        <table class="data-table is-plain">
          <thead>
            <tr>
              <th>#</th>
              <th>${t('js.exchange')}</th>
              <th>${t('js.trust_score')}</th>
              <th>${t('js.24h_volume')}</th>
              <th>${t('js.year')}</th>
              <th>${t('js.website')}</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    `;

    if (rows.length === 0) {
      exTable.innerHTML = `<div class="card" style="padding:32px; text-align:center; color:var(--muted)">${t('exchanges.noMatch')}</div>`;
    }

    renderPagination(exPagination, {
      page: currentPage,
      totalPages,
      onChange: (p) => {
        currentPage = p;
        window.scrollTo(0, 0);
        renderTable();
      }
    });
  }
}

qs('#exSearch').addEventListener('input', debounce((e) => { query = e.target.value; currentPage = 1; renderTable(); }, 150));
qs('#exSort').addEventListener('change', (e) => { sortBy = e.target.value; currentPage = 1; renderTable(); });
qs('#exType').addEventListener('change', (e) => { typeFilter = e.target.value; currentPage = 1; renderTable(); });

window.addEventListener('currency:change', () => { allRows = []; loadData(); });

loadData();
