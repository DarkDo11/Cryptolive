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

qs('#importDataBtn').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data || data.version !== 1) throw new Error('Invalid format');
      
      if (data.settings) settings.set(data.settings);
      
      if (Array.isArray(data.watchlist)) {
        data.watchlist.forEach(id => watchlist.add(id));
      }
      
      if (Array.isArray(data.portfolio)) {
        const cur = portfolio.list();
        const curIds = new Set(cur.map(x => x.id));
        data.portfolio.forEach(tx => {
          if (!curIds.has(tx.id)) portfolio.add(tx);
        });
      }
      
      if (Array.isArray(data.alerts)) {
        const cur = alerts.list();
        const curIds = new Set(cur.map(x => x.id));
        data.alerts.forEach(a => {
          if (!curIds.has(a.id)) alerts.add(a);
        });
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
