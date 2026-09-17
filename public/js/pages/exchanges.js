import { initLayout, qs } from '../layout.js';
import { api } from '../api.js';
import { renderPagination, skeletonRows } from '../components.js';
import { fmtCurrency, fmtNumber, escapeHtml } from '../format.js';
import { settings } from '../store.js';
import { t } from '../i18n.js';

initLayout({ active: 'exchanges' });

const exTable = qs('#exTable');
const exPagination = qs('#exPagination');

let currentPage = 1;

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
    const [btcPriceData, rows] = await Promise.all([
      api.simplePrice('bitcoin', cur),
      api.exchanges(currentPage, 50)
    ]);

    const btcPrice = (btcPriceData.bitcoin && btcPriceData.bitcoin[cur]) || 0;
    
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
                <div style="font-weight: 500;">${escapeHtml(ex.name)}</div>
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

    renderPagination(exPagination, {
      page: currentPage,
      totalPages: 10,
      onChange: (p) => {
        currentPage = p;
        window.scrollTo(0, 0);
        loadData();
      }
    });

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

window.addEventListener('currency:change', loadData);

loadData();
