import { api } from './api.js';
import { live } from './live.js';
import { settings } from './store.js';
import { fmtCurrency, escapeHtml } from './format.js';

// Local helpers
const qs = (s, ctx = document) => ctx.querySelector(s);
const qsa = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));
function debounce(fn, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}

const STORAGE_KEY = 'cryptolive:alerts';

function getStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function setStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new Event('alerts:change'));
  } catch (e) {}
}

export const alerts = {
  list: () => getStorage(),
  active: () => getStorage().filter(a => !a.triggeredAt),
  add: (rule) => {
    const list = getStorage();
    list.push({
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      createdAt: Date.now(),
      triggeredAt: null,
      triggeredPrice: null,
      ...rule
    });
    setStorage(list);
  },
  remove: (id) => setStorage(getStorage().filter(a => a.id !== id)),
  reset: (id) => {
    const list = getStorage();
    const alert = list.find(a => a.id === id);
    if (alert) {
      alert.triggeredAt = null;
      alert.triggeredPrice = null;
      setStorage(list);
    }
  },
  clear: () => setStorage([])
};

let engineStarted = false;
let engineNotify = null;

export function startAlertEngine({ notify }) {
  if (engineStarted) return;
  engineStarted = true;
  engineNotify = notify;

  const checkAlerts = (pricesObj) => {
    const list = getStorage();
    let changed = false;
    
    list.forEach(alert => {
      if (alert.triggeredAt) return;
      const priceInfo = pricesObj[alert.coinId];
      if (!priceInfo) return;
      
      const p = priceInfo.p || priceInfo.usd; // fallback for simplePrice vs live
      if (!p) return;

      const isMatch = alert.condition === 'above' ? p >= alert.price : p <= alert.price;
      if (isMatch) {
        alert.triggeredAt = Date.now();
        alert.triggeredPrice = p;
        changed = true;
        
        const msg = `${alert.symbol.toUpperCase()} is ${alert.condition} ${fmtCurrency(alert.price, 'usd')} — now ${fmtCurrency(p, 'usd')}`;
        if (engineNotify) engineNotify(msg, 'success');
        
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Cryptolive Alert', { body: msg, icon: alert.image });
        }
      }
    });

    if (changed) setStorage(list);
  };

  live.subscribe(tick => {
    if (tick && tick.prices) checkAlerts(tick.prices);
  });

  setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const activeAlerts = alerts.active();
    if (activeAlerts.length === 0) return;
    
    const ids = activeAlerts.map(a => a.coinId);
    try {
      const prices = await api.simplePrice(ids.join(','), 'usd');
      checkAlerts(prices);
    } catch (e) {}
  }, 60000);
}

export function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
  return Notification.requestPermission();
}

let modalActive = false;
let selectedCoin = null;

function buildAlertModal() {
  if (qs('#alertModalBackdrop')) return;
  const html = `
    <div class="modal-backdrop" id="alertModalBackdrop" style="display:none">
      <div class="modal">
        <div class="modal-head">
          Set Price Alert
          <button class="btn btn-ghost btn-sm" id="alertModalClose">×</button>
        </div>
        <div class="modal-body">
          <form id="alertForm" class="modal-form-grid">
            <div class="field full-width autocomplete" id="alertCoinSearchField">
              <label>Coin</label>
              <input type="text" class="input" id="alertCoinSearch" placeholder="Search coin..." autocomplete="off">
              <div class="autocomplete-dropdown" id="alertCoinDropdown" style="display:none"></div>
              <div id="alertSelectedCoin" style="display:none; margin-top:8px;"></div>
            </div>
            
            <div class="field full-width">
              <label>Condition</label>
              <div class="toggle-group" style="width:100%; display:flex;">
                <button type="button" class="range-btn is-active" style="flex:1" data-val="above">Above</button>
                <button type="button" class="range-btn" style="flex:1" data-val="below">Below</button>
              </div>
              <input type="hidden" id="alertCondition" value="above">
            </div>

            <div class="field">
              <label>Target Price (<span id="alertCurCode">USD</span>)</label>
              <input type="number" class="input" id="alertPrice" step="any" min="0" required>
            </div>
            
            <div class="field full-width">
              <label>Note (optional)</label>
              <input type="text" class="input" id="alertNote">
            </div>
          </form>
          <div id="alertError" style="color:var(--red); font-size:0.9rem; margin-top:12px; display:none"></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" id="alertModalCancel">Cancel</button>
          <button class="btn btn-primary" id="alertModalSave">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  
  const backdrop = qs('#alertModalBackdrop');
  qs('#alertModalClose').addEventListener('click', closeAlertModal);
  qs('#alertModalCancel').addEventListener('click', closeAlertModal);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeAlertModal(); });
  
  qsa('.toggle-group .range-btn', backdrop).forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.toggle-group .range-btn', backdrop).forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      qs('#alertCondition').value = btn.dataset.val;
    });
  });

  const searchInp = qs('#alertCoinSearch');
  const dd = qs('#alertCoinDropdown');
  
  const doSearch = debounce(async (q) => {
    if (!q) { dd.style.display = 'none'; return; }
    try {
      const res = await api.search(q);
      const coins = res.coins || [];
      if (coins.length === 0) {
        dd.innerHTML = `<div class="autocomplete-item" style="color:var(--muted)">No coins found</div>`;
      } else {
        dd.innerHTML = coins.map(c => `
          <div class="autocomplete-item alert-coin-item" data-id="${escapeHtml(c.id)}" data-symbol="${escapeHtml(c.symbol)}" data-name="${escapeHtml(c.name)}" data-thumb="${escapeHtml(c.thumb)}">
            <img src="${escapeHtml(c.thumb)}" width="20" height="20" style="border-radius:50%">
            <span>${escapeHtml(c.name)}</span>
            <span style="color:var(--muted); font-size:0.8rem">${escapeHtml(c.symbol)}</span>
          </div>
        `).join('');
      }
      dd.style.display = 'block';
    } catch (e) {}
  }, 250);

  searchInp.addEventListener('input', e => doSearch(e.target.value));
  
  dd.addEventListener('click', async e => {
    const item = e.target.closest('.alert-coin-item');
    if (!item) return;
    dd.style.display = 'none';
    
    selectCoin({
      id: item.dataset.id,
      symbol: item.dataset.symbol,
      name: item.dataset.name,
      image: item.dataset.thumb
    });
  });

  qs('#alertModalSave').addEventListener('click', saveAlert);
  
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalActive) closeAlertModal();
  });
}

async function selectCoin(coinData, isLocked = false) {
  selectedCoin = coinData;
  const searchInp = qs('#alertCoinSearch');
  const sel = qs('#alertSelectedCoin');
  
  searchInp.style.display = 'none';
  
  sel.innerHTML = `
    <div class="chip" style="font-size:0.9rem; padding:6px 12px">
      <img src="${escapeHtml(selectedCoin.image)}" width="16" height="16" style="border-radius:50%">
      ${escapeHtml(selectedCoin.name)} (${escapeHtml(selectedCoin.symbol.toUpperCase())})
      ${!isLocked ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-left:8px; padding:0 4px" id="alertClearCoin">×</button>` : ''}
    </div>
  `;
  sel.style.display = 'block';
  
  if (!isLocked) {
    qs('#alertClearCoin').addEventListener('click', () => {
      selectedCoin = null;
      sel.style.display = 'none';
      searchInp.style.display = 'block';
      searchInp.value = '';
      searchInp.focus();
      qs('#alertPrice').value = '';
    });
  }

  if (coinData.priceUsd) {
    const cur = settings.get().currency || 'usd';
    const fx = await api.fxRatio();
    qs('#alertPrice').value = coinData.priceUsd * fx;
  } else {
    try {
      const cur = settings.get().currency || 'usd';
      const prices = await api.simplePrice(selectedCoin.id, cur);
      if (prices && prices[selectedCoin.id] && prices[selectedCoin.id][cur]) {
        qs('#alertPrice').value = prices[selectedCoin.id][cur];
      }
    } catch (err) {}
  }
}

export function openAlertModal(opts = {}) {
  buildAlertModal();
  qs('#alertForm').reset();
  qs('#alertError').style.display = 'none';
  
  const cur = settings.get().currency || 'usd';
  qs('#alertCurCode').textContent = cur.toUpperCase();
  
  qsa('.toggle-group .range-btn').forEach(b => b.classList.remove('is-active'));
  qs('.toggle-group .range-btn[data-val="above"]').classList.add('is-active');
  qs('#alertCondition').value = 'above';
  
  selectedCoin = null;
  qs('#alertSelectedCoin').style.display = 'none';
  const searchInp = qs('#alertCoinSearch');
  searchInp.style.display = 'block';
  searchInp.value = '';
  qs('#alertCoinDropdown').style.display = 'none';

  qs('#alertModalBackdrop').style.display = 'flex';
  modalActive = true;

  if (opts && opts.coinId) {
    selectCoin({
      id: opts.coinId,
      symbol: opts.symbol,
      name: opts.name,
      image: opts.image,
      priceUsd: opts.priceUsd
    }, true);
  } else {
    setTimeout(() => searchInp.focus(), 50);
  }
}

function closeAlertModal(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (qs('#alertModalBackdrop')) {
    qs('#alertModalBackdrop').style.display = 'none';
  }
  modalActive = false;
}

async function saveAlert(e) {
  e.preventDefault();
  const errEl = qs('#alertError');
  errEl.style.display = 'none';

  if (!selectedCoin) {
    errEl.textContent = 'Please select a coin';
    errEl.style.display = 'block';
    return;
  }
  
  const condition = qs('#alertCondition').value;
  const priceCur = Number(qs('#alertPrice').value);
  const note = qs('#alertNote').value.trim();

  if (!priceCur || priceCur <= 0) {
    errEl.textContent = 'Invalid price';
    errEl.style.display = 'block';
    return;
  }

  const fx = await api.fxRatio();
  const priceUsd = priceCur / fx;

  alerts.add({
    coinId: selectedCoin.id,
    symbol: selectedCoin.symbol,
    name: selectedCoin.name,
    image: selectedCoin.image,
    condition,
    price: priceUsd,
    note
  });

  if (engineNotify) engineNotify('Alert saved', 'success');
  closeAlertModal();
  
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    requestNotificationPermission();
  }
}
