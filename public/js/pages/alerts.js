import { initLayout, setTitle, qs, qsa, toast } from '../layout.js';
import { settings } from '../store.js';
import { api } from '../api.js';
import { live, applyLiveTick } from '../live.js';
import { alerts, openAlertModal, requestNotificationPermission } from '../alerts.js';
import { fmtCurrency, fmtDateTime, timeAgo, escapeHtml, fmtPercent } from '../format.js';
import { emptyState } from '../components.js';
import { t } from '../i18n.js';

let fx = 1;

async function loadFx() {
  fx = await api.fxRatio();
}

function updateNotificationBtn() {
  const btn = qs('#enableNotificationsBtn');
  if (!btn || typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'inline-flex';
  }
}

async function load() {
  const cur = settings.get().currency || 'usd';
  const allAlerts = alerts.list();
  
  const activeAlerts = allAlerts.filter(a => !a.triggeredAt).sort((a, b) => b.createdAt - a.createdAt);
  const triggeredAlerts = allAlerts.filter(a => a.triggeredAt).sort((a, b) => b.triggeredAt - a.triggeredAt);
  
  const clearBtn = qs('#clearAlertsBtn');
  if (allAlerts.length > 0) {
    clearBtn.style.display = 'inline-flex';
  } else {
    clearBtn.style.display = 'none';
  }

  const activeContainer = qs('#activeAlertsContainer');
  const triggeredCard = qs('#triggeredAlertsCard');
  const triggeredContainer = qs('#triggeredAlertsContainer');
  
  if (activeAlerts.length === 0) {
    activeContainer.innerHTML = `<div style="padding: 24px">` + emptyState(t('js.no_active_alerts'), t('js.create_an_alert_to_get_started')) + `</div>`;
  } else {
    let ids = Array.from(new Set(activeAlerts.map(a => a.coinId)));
    let prices = {};
    try {
      const p = await api.simplePrice(ids.join(','), cur);
      prices = p || {};
    } catch (e) {}

    let tbody = '';
    activeAlerts.forEach(a => {
      const priceUsd = prices[a.coinId] && prices[a.coinId][cur] ? prices[a.coinId][cur] / fx : 0;
      const currentPrice = priceUsd * fx;
      const targetPrice = a.price * fx;
      const dist = currentPrice > 0 ? (targetPrice - currentPrice) / currentPrice : 0;
      
      tbody += `
        <tr>
          <td>
            <a class="asset-cell" href="/coin/${escapeHtml(a.coinId)}">
              <img src="${escapeHtml(a.image)}" alt="${escapeHtml(a.name)}" width="24" height="24" style="border-radius:50%">
              <span class="asset-copy">
                <span class="asset-name">${escapeHtml(a.name)}</span>
                <span class="asset-symbol">${escapeHtml(String(a.symbol || "").toUpperCase())}</span>
              </span>
            </a>
            ${a.note ? `<div style="font-size:0.8rem; color:var(--muted); margin-top:4px">${escapeHtml(a.note)}</div>` : ''}
          </td>
          <td>
            <span class="chip ${a.condition === 'above' ? 'is-up' : 'is-down'}">${escapeHtml(String(a.condition || "").toUpperCase())}</span>
          </td>
          <td>${fmtCurrency(targetPrice, cur)}</td>
          <td class="price-cell" data-live-price="${escapeHtml(a.coinId)}" data-price-usd="${priceUsd}">${currentPrice > 0 ? fmtCurrency(currentPrice, cur) : '—'}</td>
          <td data-alert-dist="${escapeHtml(a.id)}" data-target-price="${a.price}">${currentPrice > 0 ? fmtPercent(dist * 100) : '—'}</td>
          <td style="color:var(--muted)">${timeAgo(a.createdAt)}</td>
          <td style="text-align:right">
            <button class="btn btn-ghost btn-sm action-delete" data-id="${escapeHtml(a.id)}" style="color:var(--red)">${t('js.delete')}</button>
          </td>
        </tr>
      `;
    });
    
    activeContainer.innerHTML = `
      <div class="table-frame">
        <table class="data-table is-plain">
          <thead>
            <tr>
              <th>${t('js.coin')}</th>
              <th>${t('js.condition')}</th>
              <th>${t('js.target')}</th>
              <th>${t('js.current_price')}</th>
              <th>${t('js.distance')}</th>
              <th>${t('js.created')}</th>
              <th style="text-align:right">${t('js.action')}</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    `;
  }
  
  if (triggeredAlerts.length === 0) {
    triggeredCard.style.display = 'none';
    triggeredContainer.innerHTML = '';
  } else {
    triggeredCard.style.display = 'block';
    let tbody = '';
    triggeredAlerts.forEach(a => {
      const targetPrice = a.price * fx;
      const triggeredPrice = a.triggeredPrice * fx;
      
      tbody += `
        <tr>
          <td>
            <a class="asset-cell" href="/coin/${escapeHtml(a.coinId)}">
              <img src="${escapeHtml(a.image)}" alt="${escapeHtml(a.name)}" width="24" height="24" style="border-radius:50%">
              <span class="asset-copy">
                <span class="asset-name">${escapeHtml(a.name)}</span>
                <span class="asset-symbol">${escapeHtml(String(a.symbol || "").toUpperCase())}</span>
              </span>
            </a>
            ${a.note ? `<div style="font-size:0.8rem; color:var(--muted); margin-top:4px">${escapeHtml(a.note)}</div>` : ''}
          </td>
          <td>
            <span class="chip ${a.condition === 'above' ? 'is-up' : 'is-down'}">${escapeHtml(String(a.condition || "").toUpperCase())}</span>
          </td>
          <td>${fmtCurrency(targetPrice, cur)}</td>
          <td>${fmtDateTime(a.triggeredAt)}</td>
          <td>${fmtCurrency(triggeredPrice, cur)}</td>
          <td style="text-align:right">
            <div style="display:flex; justify-content:flex-end; gap:8px">
              <button class="btn btn-ghost btn-sm action-rearm" data-id="${escapeHtml(a.id)}">${t('js.re_arm')}</button>
              <button class="btn btn-ghost btn-sm action-delete" data-id="${escapeHtml(a.id)}" style="color:var(--red)">${t('js.delete')}</button>
            </div>
          </td>
        </tr>
      `;
    });
    
    triggeredContainer.innerHTML = `
      <div class="table-frame">
        <table class="data-table is-plain">
          <thead>
            <tr>
              <th>${t('js.coin')}</th>
              <th>${t('js.condition')}</th>
              <th>${t('js.target')}</th>
              <th>${t('js.triggered_at')}</th>
              <th>${t('js.trigger_price')}</th>
              <th style="text-align:right">${t('js.actions')}</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    `;
  }
}

function updateDistances(tick) {
  const container = qs('#activeAlertsContainer');
  if (!container || !tick || !tick.prices) return;
  qsa('[data-alert-dist]', container).forEach(el => {
    const id = el.dataset.alertDist;
    const targetPriceUsd = Number(el.dataset.targetPrice);
    const row = el.closest('tr');
    const priceCell = qs('[data-live-price]', row);
    if (priceCell) {
      const currentPriceUsd = Number(priceCell.dataset.priceUsd);
      if (currentPriceUsd > 0 && targetPriceUsd > 0) {
        const dist = (targetPriceUsd - currentPriceUsd) / currentPriceUsd;
        el.textContent = fmtPercent(dist * 100);
      }
    }
  });
}

async function init() {
  initLayout({ active: 'alerts' });
  setTitle('Price Alerts');
  
  await loadFx();
  await load();
  updateNotificationBtn();
  
  live.subscribe(tick => {
    const container = qs('#activeAlertsContainer');
    if (container) {
      applyLiveTick(container, tick, fx);
      updateDistances(tick);
    }
  });
  
  window.addEventListener('currency:change', async () => {
    await loadFx();
    await load();
  });
  
  window.addEventListener('alerts:change', () => {
    load();
  });

  qs('#newAlertBtn').addEventListener('click', () => openAlertModal());
  
  const notifyBtn = qs('#enableNotificationsBtn');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', async () => {
      const res = await requestNotificationPermission();
      if (res === 'granted') {
        toast(t('js.notifications_enabled'), { type: 'success' });
        updateNotificationBtn();
      } else {
        toast(`Notification permission ${res}`, { type: 'error' });
      }
    });
  }
  
  qs('#clearAlertsBtn').addEventListener('click', () => {
    if (confirm('Clear all alerts?')) {
      alerts.clear();
      toast(t('js.alerts_cleared'));
    }
  });
  
  document.addEventListener('click', (e) => {
    if (e.target.closest('.action-delete')) {
      const id = e.target.closest('button').dataset.id;
      alerts.remove(id);
      toast(t('js.alert_deleted'));
    } else if (e.target.closest('.action-rearm')) {
      const id = e.target.closest('button').dataset.id;
      alerts.reset(id);
      toast(t('js.alert_re_armed'));
    }
  });
}

init();
