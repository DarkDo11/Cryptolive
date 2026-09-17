// Server-side <head> decoration for /coin/:id pages: title, description, canonical and Open Graph tags
// filled from the universe snapshot so crawlers and link previews see real data without running JS.
import { getUniverse } from './universe.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtUsd(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const digits = v >= 1 ? 2 : v >= 0.01 ? 4 : 6;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
  });
}

/**
 * Returns the coin page HTML with per-coin meta tags, or the original HTML when the coin is not in the
 * universe (unknown id, or upstream unavailable and nothing cached). Never throws; bounded by `timeoutMs`.
 */
export async function decorateCoinPage(html, coinId, { cache, publicUrl, timeoutMs = 1500 }) {
  const uni = await withTimeout(getUniverse({ cache }), timeoutMs);
  const row = uni?.byId.get(coinId);
  const canonical = `${publicUrl.replace(/\/$/, '')}/coin/${encodeURIComponent(coinId)}`;
  if (!row) {
    return html.replace('</head>', `  <link rel="canonical" href="${escapeHtml(canonical)}">\n</head>`);
  }
  const name = String(row.name || coinId);
  const symbol = String(row.symbol || '').toUpperCase();
  const price = fmtUsd(row.current_price);
  const change = typeof row.price_change_percentage_24h === 'number' ? row.price_change_percentage_24h.toFixed(2) + '%' : null;
  const mcap = fmtUsd(row.market_cap);
  const title = `${name} (${symbol}) price today${price ? ' — ' + price : ''} · Cryptolive`;
  const description = [
    `Live ${name} price${price ? ' ' + price : ''}`,
    change ? `24h change ${change}` : null,
    mcap ? `market cap ${mcap}` : null,
    row.market_cap_rank ? `rank #${row.market_cap_rank}` : null,
    'charts, markets, converter and price alerts.'
  ].filter(Boolean).join(', ');
  const image = row.image ? escapeHtml(row.image) : null;
  const og = [
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Cryptolive">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    image ? `<meta property="og:image" content="${image}">` : null,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    image ? `<meta name="twitter:image" content="${image}">` : null
  ].filter(Boolean).map((l) => '  ' + l).join('\n');
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`)
    .replace('</head>', `${og}\n</head>`);
}
