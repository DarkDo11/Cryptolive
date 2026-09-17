import { initLayout, setTitle, qs, qsa, debounce } from '../layout.js';
import { settings } from '../store.js';
import { api, normalizeCoin } from '../api.js';
import { live } from '../live.js';
import { fmtCurrency, fmtPercent, escapeHtml } from '../format.js';
import { emptyState, changeBadge } from '../components.js';
import { t } from '../i18n.js';

let data = [];
let fx = 1;
let topN = 100;
let colorBy = '24h'; // 1h, 24h, 7d
let sizeBy = 'marketCap'; // marketCap, volume
let resizeObserver = null;

async function loadFx() {
  fx = await api.fxRatio();
}

async function loadData() {
  const container = qs('#heatmap');
  container.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100%;"><div class="skeleton" style="width:100%;height:100%"></div></div>`;
  
  try {
    const res = await api.markets({ perPage: 250 });
    data = res.map(normalizeCoin);
    render();
  } catch (e) {
    container.innerHTML = emptyState(t('js.error'), t('js.failed_to_load_heatmap_data_try_again_la'));
  }
}

// Squarified treemap implementation
function squarify(items, x, y, w, h) {
  // Squarified treemap (Bruls, Huizing, van Wijk). Items must be sorted by value desc.
  const result = [];
  const total = items.reduce((sum, item) => sum + item.val, 0);
  if (!total || w <= 0 || h <= 0) return result;
  const scale = (w * h) / total;
  const areas = items.map(item => ({ area: item.val * scale, ref: item.ref }));

  // Worst aspect ratio of a row laid along a side of length `len`.
  const worst = (row, len) => {
    let sum = 0, min = Infinity, max = 0;
    for (const a of row) { sum += a.area; min = Math.min(min, a.area); max = Math.max(max, a.area); }
    const s2 = sum * sum, l2 = len * len;
    return Math.max((l2 * max) / s2, s2 / (l2 * min));
  };

  // Lay out one row along the shorter side of the remaining rectangle, return the leftover rectangle.
  const layoutRow = (row, rect) => {
    const sum = row.reduce((acc, a) => acc + a.area, 0);
    const vertical = rect.w >= rect.h; // row is a vertical strip on the left when the rect is wide
    if (vertical) {
      const stripW = sum / rect.h;
      let yy = rect.y;
      for (const a of row) {
        const ih = a.area / stripW;
        result.push({ item: a.ref, x: rect.x, y: yy, w: stripW, h: ih });
        yy += ih;
      }
      return { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h };
    }
    const stripH = sum / rect.w;
    let xx = rect.x;
    for (const a of row) {
      const iw = a.area / stripH;
      result.push({ item: a.ref, x: xx, y: rect.y, w: iw, h: stripH });
      xx += iw;
    }
    return { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH };
  };

  let rect = { x, y, w, h };
  let row = [];
  for (const a of areas) {
    const len = Math.min(rect.w, rect.h);
    if (row.length && worst([...row, a], len) > worst(row, len)) {
      rect = layoutRow(row, rect);
      row = [];
    }
    row.push(a);
  }
  if (row.length) layoutRow(row, rect);
  return result;
}

function render() {
  const container = qs('#heatmap');
  if (!container || data.length === 0) return;
  
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (cw === 0 || ch === 0) return;

  let items = data.slice(0, topN);
  const itemsForTreemap = [];
  
  for (const c of items) {
    let val = sizeBy === 'marketCap' ? c.marketCap : c.volume;
    if (val > 0) {
      itemsForTreemap.push({ val, ref: c });
    }
  }
  
  itemsForTreemap.sort((a, b) => b.val - a.val);
  
  if (itemsForTreemap.length === 0) {
    container.innerHTML = emptyState(t('js.no_data'), t('js.could_not_render_heatmap_for_selected_cr'));
    return;
  }
  
  const layout = squarify(itemsForTreemap, 0, 0, cw, ch);
  
  const tooltip = qs('#heatmapTooltip');
  const cur = settings.get().currency || 'usd';
  
  let html = '';
  for (const block of layout) {
    const c = block.item;
    let change = 0;
    if (colorBy === '1h') change = c.change1h || 0;
    else if (colorBy === '24h') change = c.change24h || 0;
    else if (colorBy === '7d') change = c.change7d || 0;
    
    const tint = 0.15 + 0.85 * Math.min(Math.abs(change), 5) / 5;
    const isUp = change >= 0;
    const cls = isUp ? 'is-up' : 'is-down';
    
    let sizeCls = '';
    if (block.w < 48 || block.h < 28) sizeCls = 'is-small';
    else if (block.w < 80) sizeCls = 'is-medium';
    
    const tooltipData = escapeHtml(JSON.stringify({
      name: c.name,
      price: c.price * fx,
      mcap: c.marketCap,
      change,
      id: c.id
    }));
    
    html += `
      <a class="heatmap-tile ${cls} ${sizeCls}" href="/coin/${escapeHtml(c.id)}" 
         style="left:${block.x}px; top:${block.y}px; width:${block.w}px; height:${block.h}px; --tint:${tint}"
         data-tooltip="${tooltipData}"
         data-id="${escapeHtml(c.id)}">
        <span class="tile-symbol">${escapeHtml(c.symbol.toUpperCase())}</span>
        <span class="tile-change">${fmtPercent(change)}</span>
      </a>
    `;
  }
  
  container.innerHTML = html;
  
  container.querySelectorAll('.heatmap-tile').forEach(tile => {
    tile.addEventListener('mouseover', () => {
      const d = JSON.parse(tile.dataset.tooltip);
      tooltip.innerHTML = `
        <div style="font-weight:600; margin-bottom:4px">${escapeHtml(d.name)}</div>
        <div>Price: <span data-live-price="${escapeHtml(d.id)}" data-price-usd="${d.price/fx}">${fmtCurrency(d.price, cur)}</span></div>
        <div>Market Cap: ${fmtCurrency(d.mcap, cur, { compact: false })}</div>
        <div>${colorBy} Change: ${changeBadge(d.change, `data-live-change="${escapeHtml(d.id)}"`)}</div>
      `;
      tooltip.style.display = 'block';
    });
    tile.addEventListener('mousemove', e => {
      tooltip.style.left = (e.clientX + 15) + 'px';
      tooltip.style.top = (e.clientY + 15) + 'px';
    });
    tile.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });
}

async function init() {
  initLayout({ active: 'heatmap' });
  setTitle('Heatmap');

  const container = qs('#heatmap');
  resizeObserver = new ResizeObserver(debounce(() => {
    render();
  }, 100));
  resizeObserver.observe(container);

  qsa('#topTabs .tab').forEach(t => {
    t.addEventListener('click', () => {
      qsa('#topTabs .tab').forEach(x => x.classList.remove('is-active'));
      t.classList.add('is-active');
      topN = parseInt(t.dataset.top, 10);
      render();
    });
  });

  qsa('#cbGroup .range-btn').forEach(b => {
    b.addEventListener('click', () => {
      qsa('#cbGroup .range-btn').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      colorBy = b.dataset.cb;
      render();
    });
  });

  qsa('#sbGroup .range-btn').forEach(b => {
    b.addEventListener('click', () => {
      qsa('#sbGroup .range-btn').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      sizeBy = b.dataset.sb;
      render();
    });
  });

  await loadFx();
  await loadData();

  live.subscribe(tick => {
    if (!tick.prices) return;
    const cur = settings.get().currency || 'usd';
    
    const tooltip = qs('#heatmapTooltip');
    if (tooltip && tooltip.style.display === 'block') {
      const priceEl = qs('[data-live-price]', tooltip);
      const changeEl = qs('[data-live-change]', tooltip);
      if (priceEl && tick.prices[priceEl.dataset.livePrice]) {
        const id = priceEl.dataset.livePrice;
        const newPriceUsd = tick.prices[id].p;
        priceEl.textContent = fmtCurrency(newPriceUsd * fx, cur);
        priceEl.dataset.priceUsd = newPriceUsd;
      }
      if (changeEl && tick.prices[changeEl.dataset.liveChange]) {
        const id = changeEl.dataset.liveChange;
        changeEl.innerHTML = changeBadge(tick.prices[id].c);
      }
    }
    
    if (colorBy === '24h') {
      qsa('.heatmap-tile').forEach(tile => {
        const id = tile.dataset.id;
        if (tick.prices[id]) {
          const change = tick.prices[id].c;
          const tint = 0.15 + 0.85 * Math.min(Math.abs(change), 5) / 5;
          const isUp = change >= 0;
          tile.className = `heatmap-tile ${isUp ? 'is-up' : 'is-down'} ${tile.classList.contains('is-small') ? 'is-small' : ''} ${tile.classList.contains('is-medium') ? 'is-medium' : ''}`;
          tile.style.setProperty('--tint', tint);
          qs('.tile-change', tile).textContent = fmtPercent(change);
          
          const d = JSON.parse(tile.dataset.tooltip);
          d.change = change;
          d.price = tick.prices[id].p * fx;
          tile.dataset.tooltip = JSON.stringify(d); // dataset assignment needs no HTML escaping
        }
      });
    }
  });

  window.addEventListener('currency:change', async () => {
    await loadFx();
    await loadData();
  });
}

init();
