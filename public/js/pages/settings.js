import { initLayout, qs, qsa, toast } from '../layout.js';
import { api } from '../api.js';
import { settings, watchlist, portfolio } from '../store.js';
import { alerts, requestNotificationPermission } from '../alerts.js';
import { t, LANGS, getLang, setLang } from '../i18n.js';

initLayout({ active: 'settings' });

const APP_VERSION = 'v2.x';
qs('#appVersion').textContent = APP_VERSION;

// Appearance
const s = settings.get();

qsa('input[name="theme"]').forEach(r => {
  if (s.theme === r.value || (s.theme === null && r.value === 'system')) {
    r.checked = true;
  }
  r.addEventListener('change', () => {
    if (r.checked) {
      settings.set({ theme: r.value === 'system' ? null : r.value });
      if (r.value !== 'system') {
        document.documentElement.dataset.theme = r.value;
      } else {
        document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
    }
  });
});

async function loadCurrencies() {
  const sel = qs('#settingsCurrency');
  try {
    const list = await api.currencies();
    sel.innerHTML = list.map(c => 
      `<option value="${c.code}">${c.symbol} ${c.code.toUpperCase()}</option>`
    ).join('');
  } catch(e) {
    sel.innerHTML = `<option value="usd">USD</option><option value="eur">EUR</option>`;
  }
  sel.value = s.currency || 'usd';
  sel.addEventListener('change', e => {
    settings.set({ currency: e.target.value });
    window.dispatchEvent(new Event('currency:change'));
  });
}
loadCurrencies();

const langSel = qs('#settingsLang');
langSel.innerHTML = LANGS.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
langSel.value = getLang();
langSel.addEventListener('change', e => {
  setLang(e.target.value);
  location.reload();
});

const perPageSel = qs('#settingsPerPage');
perPageSel.value = String(s.perPage || 100);
perPageSel.addEventListener('change', e => {
  settings.set({ perPage: Number(e.target.value) });
});

const densitySel = qs('#settingsDensity');
densitySel.value = s.density || 'comfortable';
densitySel.addEventListener('change', e => {
  const density = e.target.value;
  settings.set({ density });
  document.documentElement.dataset.density = density;
});

const landingSel = qs('#settingsLanding');
landingSel.value = s.landing || '/';
landingSel.addEventListener('change', e => {
  settings.set({ landing: e.target.value });
});

const hideHigh = qs('#settingsHideHighlights');
hideHigh.checked = !s.hideHighlights;
hideHigh.addEventListener('change', e => {
  settings.set({ hideHighlights: !e.target.checked });
});

const reduceFlash = qs('#settingsReduceFlash');
reduceFlash.checked = !!s.reduceFlash;
reduceFlash.addEventListener('change', e => {
  settings.set({ reduceFlash: e.target.checked });
});


// Notifications
function updateNotifStatus() {
  const st = qs('#notifStatus');
  const btn = qs('#enableNotifBtn');
  const hint = qs('#notifHint');
  
  if (typeof Notification === 'undefined') {
    st.textContent = 'Unsupported';
    btn.style.display = 'none';
    hint.textContent = t('settings.notifUnsupported');
    return;
  }
  
  st.textContent = Notification.permission;
  if (Notification.permission === 'default') {
    btn.style.display = 'inline-flex';
    hint.textContent = t('settings.notifDefault');
  } else if (Notification.permission === 'denied') {
    btn.style.display = 'none';
    hint.textContent = t('settings.notifDenied');
  } else {
    btn.style.display = 'none';
    hint.textContent = t('settings.notifGranted');
  }
}
updateNotifStatus();

qs('#enableNotifBtn').addEventListener('click', async () => {
  await requestNotificationPermission();
  updateNotifStatus();
});


// Data
function updateCounts() {
  qs('#dataCountWatchlist').textContent = watchlist.list().length;
  qs('#dataCountPortfolio').textContent = portfolio.list().length;
  qs('#dataCountAlerts').textContent = alerts.list().length;
}
updateCounts();

qs('#exportDataBtn').addEventListener('click', () => {
  const data = {
    version: 1,
    exportedAt: Date.now(),
    settings: settings.get(),
    watchlist: watchlist.list(),
    portfolio: portfolio.list(),
    alerts: alerts.list()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  a.download = `cryptolive-backup-${d.toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const COIN_ID_RE = /^[a-z0-9-]{1,100}$/;

function validSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
  const out = {};
  if (['dark', 'light', 'system'].includes(value.theme)) out.theme = value.theme;
  if (typeof value.currency === 'string' && /^[a-z]{1,8}$/.test(value.currency)) out.currency = value.currency;
  if (['en', 'ru', 'es', 'de'].includes(value.lang)) out.lang = value.lang;
  if ([50, 100, 250].includes(value.perPage)) out.perPage = value.perPage;
  for (const key of ['hideHighlights', 'reduceFlash', 'privacy']) {
    if (typeof value[key] === 'boolean') out[key] = value[key];
  }
  if (['comfortable', 'compact'].includes(value.density)) out.density = value.density;
  if (typeof value.landing === 'string' && value.landing.startsWith('/')) out.landing = value.landing.slice(0, 200);
  if (Array.isArray(value.columns) && value.columns.every(column => typeof column === 'string')) {
    out.columns = value.columns.slice(0, 100).map(column => column.slice(0, 64));
  }
  return out;
}

function validTransactions(value) {
  if (!Array.isArray(value)) throw new Error('Invalid portfolio');
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || !COIN_ID_RE.test(item.coinId)) continue;
    if (item.type !== 'buy' && item.type !== 'sell') continue;
    if (!Number.isFinite(item.amount) || item.amount <= 0) continue;
    if (!Number.isFinite(item.price) || item.price < 0 || !Number.isFinite(item.date)) continue;
    result.push({
      ...(typeof item.id === 'string' && item.id ? { id: item.id } : {}),
      coinId: item.coinId,
      symbol: typeof item.symbol === 'string' ? item.symbol.slice(0, 64) : '',
      name: typeof item.name === 'string' ? item.name.slice(0, 64) : '',
      image: typeof item.image === 'string' ? item.image.slice(0, 1000) : '',
      type: item.type,
      amount: item.amount,
      price: item.price,
      date: item.date,
      note: typeof item.note === 'string' ? item.note.slice(0, 200) : ''
    });
  }
  return result;
}

function validAlerts(value) {
  if (!Array.isArray(value)) throw new Error('Invalid alerts');
  const result = [];
  const conditions = new Set(['above', 'below', 'change_up', 'change_down']);
  for (const item of value) {
    if (!item || typeof item !== 'object' || !COIN_ID_RE.test(item.coinId) || !conditions.has(item.condition)) continue;
    const isChange = item.condition === 'change_up' || item.condition === 'change_down';
    if (isChange ? !Number.isFinite(item.percent) : !Number.isFinite(item.price)) continue;
    result.push({
      id: typeof item.id === 'string' && item.id ? item.id.slice(0, 200) :
        (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      triggeredAt: Number.isFinite(item.triggeredAt) ? item.triggeredAt : null,
      triggeredPrice: Number.isFinite(item.triggeredPrice) ? item.triggeredPrice : null,
      triggeredChange: Number.isFinite(item.triggeredChange) ? item.triggeredChange : null,
      fireCount: Number.isSafeInteger(item.fireCount) && item.fireCount >= 0 ? item.fireCount : 0,
      coinId: item.coinId,
      symbol: typeof item.symbol === 'string' ? item.symbol.slice(0, 64) : '',
      name: typeof item.name === 'string' ? item.name.slice(0, 64) : '',
      image: typeof item.image === 'string' ? item.image.slice(0, 1000) : '',
      condition: item.condition,
      price: Number.isFinite(item.price) ? item.price : null,
      percent: Number.isFinite(item.percent) ? item.percent : null,
      note: typeof item.note === 'string' ? item.note.slice(0, 200) : '',
      repeat: item.repeat === true
    });
  }
  return result;
}

qs('#importDataBtn').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || data.version !== 1) throw new Error('Invalid format');

      const importedSettings = data.settings === undefined ? null : validSettings(data.settings);
      if (data.watchlist !== undefined && !Array.isArray(data.watchlist)) throw new Error('Invalid watchlist');
      const importedWatchlist = data.watchlist === undefined ? null : [...new Set(
        data.watchlist.filter(id => typeof id === 'string' && COIN_ID_RE.test(id))
      )];
      const importedPortfolio = data.portfolio === undefined ? null : validTransactions(data.portfolio);
      const importedAlerts = data.alerts === undefined ? null : validAlerts(data.alerts);

      if (importedSettings) {
        localStorage.setItem('cryptolive:settings', JSON.stringify(importedSettings));
        window.dispatchEvent(new CustomEvent('settings:change', { detail: importedSettings }));
      }
      if (importedWatchlist) {
        localStorage.setItem('cryptolive:watchlist', JSON.stringify(importedWatchlist));
        window.dispatchEvent(new Event('watchlist:change'));
      }
      if (importedPortfolio) portfolio.replaceAll(importedPortfolio);
      if (importedAlerts) {
        localStorage.setItem('cryptolive:alerts', JSON.stringify(importedAlerts));
        window.dispatchEvent(new Event('alerts:change'));
      }
      
      updateCounts();
      toast(t('js.backup_imported_successfully'), { type: 'success' });
    } catch(err) {
      toast(t('js.failed_to_import_backup'), { type: 'error' });
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // reset file input
});

qs('#clearDataBtn').addEventListener('click', () => {
  if (confirm('Are you sure you want to clear all local data? This cannot be undone.')) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cryptolive:')) {
        localStorage.removeItem(key);
      }
    }
    location.reload();
  }
});

window.addEventListener('watchlist:change', updateCounts);
window.addEventListener('portfolio:change', updateCounts);
window.addEventListener('alerts:change', updateCounts);
