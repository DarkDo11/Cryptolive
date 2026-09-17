import { initLayout, setTitle, qs, qsa } from '../layout.js';
import { settings } from '../store.js';
import { api } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { fmtCurrency, escapeHtml, timeAgo } from '../format.js';
import { changeBadge } from '../components.js';

let fxRates = {}; // fiat code -> usd rate
let coinsMap = {}; // coinId -> price_usd
let lastUpdate = Date.now();
let rateInterval;

async function loadData() {
  try {
    const fiats = await api.currencies();
    const codes = fiats.map(c => c.code).join(',');
    const [markets, btcRates] = await Promise.all([
      api.get('/markets', { vs_currency: 'usd', per_page: 250, page: 1 }),
      api.simplePrice('bitcoin', codes)
    ]);
    
    const btc = btcRates.bitcoin;
    const btcUsd = btc.usd || 1;
    fiats.forEach(f => {
      fxRates[f.code] = (btc[f.code] || 0) / btcUsd;
    });

    markets.forEach(m => {
      coinsMap[m.id] = m.current_price;
    });

    return { fiats, markets };
  } catch (e) {
    console.error(e);
    return null;
  }
}

function getUsdValue(assetStr) {
  if (!assetStr) return 0;
  const [type, id] = assetStr.split(':');
  if (type === 'coin') {
    return coinsMap[id] || 0;
  } else if (type === 'fiat') {
    const rate = fxRates[id];
    return rate ? 1 / rate : 0;
  }
  return 0;
}

function convert(amount, fromStr, toStr) {
  const fromUsd = getUsdValue(fromStr);
  const toUsd = getUsdValue(toStr);
  if (toUsd === 0) return 0;
  return amount * fromUsd / toUsd;
}

function getLabel(assetStr) {
  if (!assetStr) return '';
  const [type, id] = assetStr.split(':');
  if (type === 'coin') {
    const sel = qs(`#fromAsset option[value="${assetStr}"]`);
    return sel ? sel.text.split(' - ')[0] : id.toUpperCase();
  }
  return id.toUpperCase();
}

async function init() {
  initLayout({ active: 'converter' });
  setTitle('Converter');

  const data = await loadData();
  if (!data) return;

  const fromSel = qs('#fromAsset');
  const toSel = qs('#toAsset');
  
  let fiatOpts = `<optgroup label="Fiat">`;
  data.fiats.forEach(f => {
    if (f.code !== 'btc' && f.code !== 'eth') {
      fiatOpts += `<option value="fiat:${f.code}">${f.code.toUpperCase()} - ${escapeHtml(f.name)}</option>`;
    }
  });
  fiatOpts += `</optgroup>`;
  
  let cryptoOpts = `<optgroup label="Crypto">`;
  data.markets.forEach(m => {
    cryptoOpts += `<option value="coin:${m.id}">${escapeHtml(m.symbol.toUpperCase())} - ${escapeHtml(m.name)}</option>`;
  });
  cryptoOpts += `</optgroup>`;
  
  fromSel.innerHTML = fiatOpts + cryptoOpts;
  toSel.innerHTML = fiatOpts + cryptoOpts;

  const params = new URLSearchParams(location.search);
  let urlFrom = params.get('from');
  let urlTo = params.get('to');
  let urlAmount = params.get('amount') || '1';

  function findOpt(val) {
    if (!val) return null;
    if (data.fiats.some(f => f.code === val)) return `fiat:${val}`;
    if (data.markets.some(m => m.id === val)) return `coin:${val}`;
    return null;
  }
  
  fromSel.value = findOpt(urlFrom) || 'coin:bitcoin';
  toSel.value = findOpt(urlTo) || 'fiat:usd';
  qs('#fromAmount').value = urlAmount;

  function recompute(focus = 'from') {
    const amtFrom = Number(qs('#fromAmount').value);
    const amtTo = Number(qs('#toAmount').value);
    const fStr = fromSel.value;
    const tStr = toSel.value;
    
    if (focus === 'from') {
      const res = convert(amtFrom, fStr, tStr);
      qs('#toAmount').value = res ? res.toPrecision(8).replace(/\\.?0+$/, '') : '';
    } else {
      const res = convert(amtTo, tStr, fStr);
      qs('#fromAmount').value = res ? res.toPrecision(8).replace(/\\.?0+$/, '') : '';
    }
    
    const fId = fStr.split(':')[1];
    const tId = tStr.split(':')[1];
    const newUrl = new URL(location);
    newUrl.searchParams.set('from', fId);
    newUrl.searchParams.set('to', tId);
    newUrl.searchParams.set('amount', qs('#fromAmount').value);
    history.replaceState(null, '', newUrl);

    updateRateLine();
  }

  function updateRateLine() {
    const fStr = fromSel.value;
    const tStr = toSel.value;
    const rate = convert(1, fStr, tStr);
    qs('#rateLine').innerHTML = `1 ${escapeHtml(getLabel(fStr))} = ${rate > 100 ? rate.toLocaleString(undefined,{maximumFractionDigits:2}) : rate.toPrecision(6)} ${escapeHtml(getLabel(tStr))} &middot; updated ${timeAgo(lastUpdate)}`;
  }

  recompute('from');

  qs('#fromAmount').addEventListener('input', () => recompute('from'));
  qs('#toAmount').addEventListener('input', () => recompute('to'));
  fromSel.addEventListener('change', () => recompute('from'));
  toSel.addEventListener('change', () => recompute('from'));

  qs('#swapBtn').addEventListener('click', () => {
    const tmp = fromSel.value;
    fromSel.value = toSel.value;
    toSel.value = tmp;
    recompute('from');
  });

  qsa('#quickPicks .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const pick = btn.dataset.pick;
      const [type] = pick.split(':');
      const fromType = fromSel.value.split(':')[0];
      if (fromType === 'coin') {
        if (type === 'coin') fromSel.value = pick; else toSel.value = pick;
      } else {
        if (type === 'fiat') fromSel.value = pick; else toSel.value = pick;
      }
      recompute('from');
    });
  });

  rateInterval = setInterval(updateRateLine, 10000);

  const popIds = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple'];
  const popMarkets = data.markets.filter(m => popIds.includes(m.id)).sort((a,b) => popIds.indexOf(a.id) - popIds.indexOf(b.id));
  const cur = settings.get().currency || 'usd';
  const fxCur = fxRates[cur] || 1;
  
  let popHtml = '';
  popMarkets.forEach(m => {
    const val = m.current_price * fxCur;
    popHtml += `
      <tr>
        <td style="text-align:left">
          <a class="asset-cell" href="/coin/${escapeHtml(m.id)}">
            <img src="${escapeHtml(m.image)}" width="24" height="24" style="border-radius:50%">
            <span class="asset-copy">
              <span class="asset-name">1 ${escapeHtml(m.symbol.toUpperCase())}</span>
            </span>
          </a>
        </td>
        <td class="price-cell" data-live-price="${escapeHtml(m.id)}" data-price-usd="${m.current_price}">${fmtCurrency(val, cur)}</td>
        <td>${changeBadge(m.price_change_percentage_24h, `data-live-change="${escapeHtml(m.id)}"`)}</td>
      </tr>
    `;
  });
  qs('#popularTable').innerHTML = `
    <div class="table-frame">
      <table class="data-table is-plain">
        <tbody>${popHtml}</tbody>
      </table>
    </div>
  `;

  live.subscribe(tick => {
    let changed = false;
    if (tick.prices) {
      for (const [id, t] of Object.entries(tick.prices)) {
        if (coinsMap[id]) {
          coinsMap[id] = t.p;
          changed = true;
        }
      }
    }
    if (changed) {
      lastUpdate = Date.now();
      recompute(document.activeElement === qs('#toAmount') ? 'to' : 'from');
    }
    applyLiveTick(qs('#popularTable'), tick, fxCur);
  });
}

init();
