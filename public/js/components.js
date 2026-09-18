import { settings, watchlist } from './store.js';
import { fmtCurrency, fmtPercent, fmtCompact, escapeHtml } from './format.js';
import { t } from './i18n.js';
export { normalizeCoin } from './api.js';

export function sparklineSvg(values, isUp, { width = 120, height = 36 } = {}) {
  if (!values || values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const color = isUp ? 'var(--green)' : 'var(--red)';
  return `
    <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" points="${pts}" />
    </svg>
  `;
}

export function changeBadge(value, dataAttr = '') {
  const isUp = value > 0;
  const isDown = value < 0;
  const cls = `change-badge ${isUp ? 'is-up' : isDown ? 'is-down' : ''}`;
  return `<span class="${cls}" ${dataAttr}>${fmtPercent(value)}</span>`;
}

export function sortCoins(coins, key, dir) {
  const mult = dir === 'asc' ? 1 : -1;
  return [...coins].sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (typeof va === 'string') {
      return va.localeCompare(vb) * mult;
    }
    if (va == null) va = -Infinity;
    if (vb == null) vb = -Infinity;
    return (va > vb ? 1 : va < vb ? -1 : 0) * mult;
  });
}

export function bindSortableTable(container, onSort) {
  if (!container || typeof onSort !== 'function') return;
  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      onSort(th.dataset.sort);
    });
  });
}

export function renderCoinTable(container, coins, opts = {}) {
  const cur = settings.get().currency || 'usd';
  const fx = opts.fx || 1;
  
  const allCols = ['rank','coin','price','change1h','change24h','change7d','volume','marketCap','sparkline'];
  const columns = opts.columns || allCols;
  
  let thead = '<tr>';
  if (opts.selectable) thead += '<th class="col-select"></th>';
  if (opts.showStar !== false) thead += '<th class="col-star"></th>';
  
  const heads = {
    rank: { label: t('table.rank'), sort: 'rank', cls: 'col-num' },
    coin: { label: t('table.coin'), sort: 'name', cls: 'col-coin is-sticky' },
    price: { label: t('table.price'), sort: 'price', cls: 'col-price' },
    change1h: { label: t('table.change1h'), sort: 'change1h', cls: 'col-change1h' },
    change24h: { label: t('table.change24h'), sort: 'change24h', cls: 'col-change24h' },
    change7d: { label: t('table.change7d'), sort: 'change7d', cls: 'col-change7d' },
    volume: { label: t('table.volume'), sort: 'volume', cls: 'col-volume' },
    marketCap: { label: t('table.marketCap'), sort: 'marketCap', cls: 'col-marketCap' },
    sparkline: { label: t('table.sparkline'), sort: null, cls: 'col-sparkline' }
  };

  let totalColumnCount = (opts.selectable ? 1 : 0) + (opts.showStar !== false ? 1 : 0);
  columns.forEach(colKey => {
    const h = heads[colKey];
    if (h) {
      totalColumnCount++;
      if (opts.sortable !== false && h.sort) {
        let cls = 'is-sortable' + (h.cls ? ' ' + h.cls : '');
        let aria = 'none';
        if (opts.sortKey === h.sort) {
          cls += opts.sortDir === 'asc' ? ' sort-asc' : ' sort-desc';
          aria = opts.sortDir === 'asc' ? 'ascending' : 'descending';
        }
        thead += `<th class="${cls}" data-sort="${escapeHtml(h.sort)}" aria-sort="${aria}">${escapeHtml(h.label)}</th>`;
      } else {
        thead += `<th class="${h.cls || ''}">${escapeHtml(h.label)}</th>`;
      }
    }
  });
  thead += '</tr>';

  let tbody = '';
  coins.forEach(c => {
    const priceUsd = (c.price || 0) / fx;
    const coinId = escapeHtml(String(c.id ?? ''));
    const coinSymbol = escapeHtml(String(c.symbol ?? ''));
    const coinName = escapeHtml(String(c.name ?? ''));
    const coinImage = escapeHtml(String(c.image ?? ''));
    const isStar = watchlist.has(c.id);
    const starActive = isStar ? 'is-active' : '';
    const starPressed = isStar ? 'true' : 'false';
    const starFill = isStar ? 'currentColor' : 'none';

    tbody += `<tr data-coin-id="${coinId}" data-symbol="${coinSymbol}" tabindex="0" style="cursor:pointer">`;
    if (opts.selectable) {
      const isSelected = opts.selected && opts.selected.has(coinId);
      tbody += `<td class="col-select"><input type="checkbox" class="select-box" data-id="${coinId}" ${isSelected ? 'checked' : ''} aria-label="Select"></td>`;
    }
    if (opts.showStar !== false) {
      tbody += `<td class="col-star"><button type="button" class="star-btn ${starActive}" data-id="${coinId}" aria-label="${t('table.toggleWatchlist')}" aria-pressed="${starPressed}"><svg width="16" height="16" viewBox="0 0 24 24" fill="${starFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button></td>`;
    }
    
    columns.forEach(colKey => {
      if (colKey === 'rank') {
        tbody += `<td class="col-num">${c.rank != null ? escapeHtml(String(c.rank)) : '-'}</td>`;
      } else if (colKey === 'coin') {
        let btn = '';
        if (opts.expandable && c.sparkline?.length && !columns.includes('sparkline')) {
          btn = `<button type="button" class="expand-btn" data-expand="${coinId}" aria-expanded="false" aria-label="${t('markets.expandChart')}" title="${t('markets.expandChart')}">▾</button>`;
        }
        tbody += `
          <td class="col-coin is-sticky">
            <a class="asset-cell" href="/coin/${coinId}">
              <img class="asset-logo" src="${coinImage}" alt="${coinName}" data-symbol="${coinSymbol}" loading="lazy" referrerpolicy="no-referrer">
              <span class="asset-copy">
                <span class="asset-name">${coinName}</span>
                <span class="asset-symbol">${coinSymbol}</span>
              </span>
            </a>
            ${btn}
          </td>`;
      } else if (colKey === 'price') {
        tbody += `<td class="price-cell" data-live-price="${coinId}" data-price-usd="${priceUsd}">${fmtCurrency(c.price, cur)}</td>`;
      } else if (colKey === 'change1h') {
        tbody += `<td class="col-change1h">${changeBadge(c.change1h)}</td>`;
      } else if (colKey === 'change24h') {
        tbody += `<td class="col-change24h">${changeBadge(c.change24h, `data-live-change="${coinId}"`)}</td>`;
      } else if (colKey === 'change7d') {
        tbody += `<td class="col-change7d">${changeBadge(c.change7d)}</td>`;
      } else if (colKey === 'volume') {
        tbody += `<td class="col-volume">${fmtCurrency(c.volume, cur, { compact: false })}</td>`;
      } else if (colKey === 'marketCap') {
        tbody += `<td class="col-marketCap">${fmtCurrency(c.marketCap, cur, { compact: false })}</td>`;
      } else if (colKey === 'sparkline') {
        let btn = '';
        if (opts.expandable && c.sparkline?.length) {
          btn = `<button type="button" class="expand-btn" data-expand="${coinId}" aria-expanded="false" aria-label="${t('markets.expandChart')}" title="${t('markets.expandChart')}">▾</button>`;
        }
        tbody += `<td class="col-sparkline">${sparklineSvg(c.sparkline, (c.change7d || 0) >= 0)}${btn}</td>`;
      }
    });
    tbody += '</tr>';
    if (opts.expandable) {
      tbody += `<tr class="detail-row" data-detail-for="${coinId}" hidden><td colspan="${totalColumnCount}"><div class="detail-inner"></div></td></tr>`;
    }
  });

  container.innerHTML = `
    <div class="table-frame">
      <table class="data-table">
        <thead>${thead}</thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;

  // Image error fallback
  container.querySelectorAll('img.asset-logo').forEach(img => {
    const onError = () => {
      const sym = img.dataset.symbol || img.closest('tr')?.dataset?.symbol || img.alt || '?';
      const letter = sym.charAt(0).toUpperCase() || '?';
      const span = document.createElement('span');
      span.className = 'asset-icon';
      span.textContent = letter;
      img.replaceWith(span);
    };
    img.addEventListener('error', onError, { once: true });
    if (img.complete && img.naturalWidth === 0 && img.src) {
      onError();
    }
  });

  // Attach sort handlers
  if (opts.sortable !== false && opts.onSort) {
    bindSortableTable(container, opts.onSort);
  }

  // Delegated click handler
  if (container.__coinTableHandler) {
    container.removeEventListener('click', container.__coinTableHandler);
  }

  container.__coinTableHandler = (e) => {
    const starBtn = e.target.closest('button.star-btn');
    if (starBtn && container.contains(starBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const id = starBtn.dataset.id;
      if (id) {
        watchlist.toggle(id);
        const isActive = watchlist.has(id);
        starBtn.classList.toggle('is-active', isActive);
        starBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        const svg = starBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', isActive ? 'currentColor' : 'none');
      }
      return;
    }

    const expandBtn = e.target.closest('.expand-btn');
    if (expandBtn && container.contains(expandBtn)) {
      e.preventDefault();
      e.stopPropagation();
      const id = expandBtn.dataset.expand;
      const row = container.querySelector(`tr.detail-row[data-detail-for="${id}"]`);
      if (row) {
        const isExpanded = expandBtn.getAttribute('aria-expanded') === 'true';
        if (isExpanded) {
          row.hidden = true;
          expandBtn.setAttribute('aria-expanded', 'false');
          expandBtn.setAttribute('title', t('markets.expandChart'));
          expandBtn.setAttribute('aria-label', t('markets.expandChart'));
        } else {
          row.hidden = false;
          expandBtn.setAttribute('aria-expanded', 'true');
          expandBtn.setAttribute('title', t('markets.collapseChart'));
          expandBtn.setAttribute('aria-label', t('markets.collapseChart'));
          
          const inner = row.querySelector('.detail-inner');
          if (!inner.innerHTML.trim()) {
            const c = coins.find(x => String(x.id) === id);
            if (c && c.sparkline) {
              const isUp = (c.change7d || 0) >= 0;
              const min = Math.min(...c.sparkline);
              const max = Math.max(...c.sparkline);
              inner.innerHTML = `
                <div class="detail-caption">
                  <span>7d: ${changeBadge(c.change7d)}</span>
                  <span title="7d low">↓ ${fmtCurrency(min, cur)}</span>
                  <span title="7d high">↑ ${fmtCurrency(max, cur)}</span>
                </div>
                <div class="detail-chart">
                  ${sparklineSvg(c.sparkline, isUp, { width: 720, height: 140 }).replace('<svg ', '<svg preserveAspectRatio="none" ')}
                </div>`;
            }
          }
        }
      }
      return;
    }

    if (e.target.closest('a, button, .select-box, .col-select, .detail-row')) {
      return;
    }

    const row = e.target.closest('tr[data-coin-id]');
    if (row && container.contains(row)) {
      const id = row.dataset.coinId;
      if (id) {
        location.href = `/coin/${id}`;
      }
    }
  };

  container.addEventListener('click', container.__coinTableHandler);

  // Delegated change handler
  if (container.__coinTableChangeHandler) {
    container.removeEventListener('change', container.__coinTableChangeHandler);
  }

  container.__coinTableChangeHandler = (e) => {
    if (e.target.classList.contains('select-box')) {
      if (opts.onSelect) {
        opts.onSelect(e.target.dataset.id, e.target.checked);
      }
    }
  };
  container.addEventListener('change', container.__coinTableChangeHandler);

  // Keyboard navigation
  if (container.__coinTableKeyHandler) {
    container.removeEventListener('keydown', container.__coinTableKeyHandler);
  }

  container.__coinTableKeyHandler = (e) => {
    if (e.key === 'Enter') {
      if (e.target.closest('a, button')) return;
      const row = e.target.closest('tr[data-coin-id]');
      if (row && container.contains(row)) {
        const id = row.dataset.coinId;
        if (id) {
          e.preventDefault();
          location.href = `/coin/${id}`;
        }
      }
    }
  };

  container.addEventListener('keydown', container.__coinTableKeyHandler);
}

export function renderPagination(container, { page, totalPages, onChange }) {
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = '';
    if (container.__paginationHandler) {
      container.removeEventListener('click', container.__paginationHandler);
      delete container.__paginationHandler;
    }
    return;
  }
  
  let html = `<div class="pagination">`;
  html += `<button type="button" class="btn btn-sm btn-ghost" ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">${t('table.prev')}</button>`;
  
  let start = Math.max(1, page - 3);
  let end = Math.min(totalPages, start + 6);
  if (end - start < 6) {
    start = Math.max(1, end - 6);
  }
  
  for (let i = start; i <= end; i++) {
    const active = i === page ? 'btn-primary' : 'btn-ghost';
    html += `<button type="button" class="btn btn-sm ${active}" data-page="${i}">${i}</button>`;
  }
  
  html += `<span>${t('table.of')} ${totalPages}</span>`;
  html += `<button type="button" class="btn btn-sm btn-ghost" ${page >= totalPages ? 'disabled' : ''} data-page="${page + 1}">${t('table.next')}</button>`;
  html += `</div>`;
  
  container.innerHTML = html;
  
  if (container.__paginationHandler) {
    container.removeEventListener('click', container.__paginationHandler);
  }

  container.__paginationHandler = (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled || !container.contains(btn)) return;
    const p = parseInt(btn.dataset.page, 10);
    if (!Number.isNaN(p) && p !== page && p >= 1 && p <= totalPages) {
      if (typeof onChange === 'function') {
        onChange(p);
      }
    }
  };

  container.addEventListener('click', container.__paginationHandler);
}

export function skeletonRows(count, cols) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<tr class="skeleton-row">';
    for (let j = 0; j < cols; j++) {
      html += `<td><div class="skeleton"></div></td>`;
    }
    html += '</tr>';
  }
  return html;
}

export function emptyState(title, hint) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      ${hint ? `<p>${escapeHtml(hint)}</p>` : ''}
    </div>
  `;
}

export function gaugeSvg(value, label) {
  // Semi-circle gauge (0-100)
  const val = Math.max(0, Math.min(100, value));
  const angle = (val / 100) * 180;
  
  return `
    <div class="gauge" style="text-align:center;">
      <svg viewBox="0 0 100 50" style="overflow:visible;">
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="var(--line)" stroke-width="12" />
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="url(#g-grad)" stroke-width="12" stroke-dasharray="125" stroke-dashoffset="${125 - (val/100)*125}" />
        <line x1="50" y1="50" x2="${50 - 35 * Math.cos(angle * Math.PI / 180)}" y2="${50 - 35 * Math.sin(angle * Math.PI / 180)}" stroke="var(--text)" stroke-width="2" />
        <circle cx="50" cy="50" r="4" fill="var(--text)" />
        <defs>
          <linearGradient id="g-grad">
            <stop offset="0%" stop-color="var(--red)"/>
            <stop offset="50%" stop-color="var(--amber)"/>
            <stop offset="100%" stop-color="var(--green)"/>
          </linearGradient>
        </defs>
      </svg>
      <div style="font-weight:800; font-size:1.6rem; line-height:1; margin-top:4px;">${Math.round(val)}</div>
      <div style="font-weight:600; color:var(--muted-strong); margin-top:4px;">${escapeHtml(label)}</div>
    </div>
  `;
}

export function coinChip(coin) {
  const id = escapeHtml(String(coin?.id ?? ''));
  const symbol = escapeHtml(String(coin?.symbol ?? '').toUpperCase());
  const name = escapeHtml(String(coin?.name ?? symbol));
  const image = escapeHtml(String(coin?.image ?? ''));
  return `
    <a href="/coin/${id}" class="chip" style="text-decoration:none;">
      <img src="${image}" alt="${name}" width="16" height="16" style="border-radius:50%;" loading="lazy" referrerpolicy="no-referrer">
      <span style="color:var(--text); font-weight:500;">${symbol}</span>
    </a>
  `;
}
