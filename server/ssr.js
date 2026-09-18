const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2
});

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: price >= 1 ? 2 : 6
  }).format(price);
}

function formatCompact(value) {
  const number = Number(value);
  return Number.isFinite(number) ? compactUsd.format(number) : '—';
}

export function renderMarketsTable(rows, { limit = 100 } = {}) {
  const body = (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, limit)).map((row, index) => {
    const id = escapeHtml(row?.id || '');
    const href = `/coin/${encodeURIComponent(String(row?.id || ''))}`;
    const image = escapeHtml(row?.image || '');
    const name = escapeHtml(row?.name || row?.id || '');
    const symbol = escapeHtml(String(row?.symbol || '').toUpperCase());
    const rank = escapeHtml(row?.market_cap_rank ?? index + 1);
    const change = Number(row?.price_change_percentage_24h);
    const validChange = Number.isFinite(change);
    const changeClass = validChange && change >= 0 ? 'is-up' : 'is-down';
    const changeText = validChange ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—';
    return `<tr data-coin-id="${id}"><td>${rank}</td><td><a class="asset-cell" href="${escapeHtml(href)}"><img class="asset-logo" src="${image}" alt="" loading="lazy" referrerpolicy="no-referrer" width="24" height="24"><span class="asset-copy"><span class="asset-name">${name}</span><span class="asset-symbol">${symbol}</span></span></a></td><td>${formatPrice(row?.current_price)}</td><td><span class="change-badge ${changeClass}">${changeText}</span></td><td>${formatCompact(row?.total_volume)}</td><td>${formatCompact(row?.market_cap)}</td></tr>`;
  }).join('');

  return `<div class="table-frame ssr"><table class="data-table"><thead><tr><th class="col-num">#</th><th class="col-coin">Coin</th><th class="col-price">Price</th><th class="col-change24h">24h %</th><th class="col-volume">24h Volume</th><th class="col-marketCap">Market Cap</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
