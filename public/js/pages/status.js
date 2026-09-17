import { initLayout, setTitle, qs } from '../layout.js';
import { fmtNumber, timeAgo, fmtDateTime, escapeHtml } from '../format.js';
import { t } from '../i18n.js';

initLayout({ active: '' });
setTitle(t('status.title'));

let timer = null;

async function load() {
  const banner = qs('#statusBanner');
  const kpis = qs('#statusKpis');
  const upstreamBody = qs('#upstreamBody');
  const liveBody = qs('#liveBody');
  const cacheBody = qs('#cacheBody');
  const serverBody = qs('#serverBody');
  const updated = qs('#statusUpdated');

  try {
    const res = await fetch('/healthz', { cache: 'no-store' });
    if (!res.ok) throw new Error('Status fetch failed');
    const data = await res.json();
    
    const { upstream, live, cache, version, node, uptime, startedAt, memory } = data;

    // The Binance socket is opened lazily (only while browsers are subscribed), so "not connected"
    // with zero subscribers is idle, not a failure.
    const liveIdle = !live.connected && live.subscribers === 0;
    let verdict = 'ok';
    if (upstream.throttled || (!live.connected && !liveIdle)) {
      verdict = 'degraded';
    }

    // Banner
    banner.hidden = false;
    banner.className = 'notice';
    if (verdict === 'ok') {
      banner.classList.add('is-ok');
      banner.textContent = t('status.allGood');
    } else {
      banner.classList.add('is-warn');
      let msg = t('status.degraded');
      if (upstream.throttled) {
        msg += ' ' + t('status.throttledFor', { s: Math.ceil(upstream.throttledForMs / 1000) });
      }
      banner.textContent = msg;
    }

    // KPIs
    const hitRatioStr = cache.hitRatio !== null ? (cache.hitRatio * 100).toFixed(1) + '%' : '—';
    const overallDot = verdict === 'ok' ? 'is-ok' : 'is-warn';
    const upstreamLabel = upstream.throttled ? t('status.throttled') : t('status.operational');
    const liveLabel = live.connected ? t('status.connected') : liveIdle ? t('status.idle') : t('status.disconnected');

    kpis.innerHTML = `
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('status.overall')}</div>
          <div style="font-size:1.5rem; font-weight:700">
            <span class="status-dot ${overallDot}"></span>${verdict === 'ok' ? t('status.operational') : t('status.degradedShort')}
          </div>
        </div>
      </div>
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('status.upstream')}</div>
          <div style="font-size:1.5rem; font-weight:700">${escapeHtml(upstreamLabel)}</div>
        </div>
      </div>
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('status.live')}</div>
          <div style="font-size:1.5rem; font-weight:700">${escapeHtml(liveLabel)}</div>
        </div>
      </div>
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('status.hitRatio')}</div>
          <div style="font-size:1.5rem; font-weight:700">${escapeHtml(hitRatioStr)}</div>
        </div>
      </div>
    `;

    // Upstream detail
    upstreamBody.innerHTML = `
      <div class="stat-list"><dl style="margin:0">
        <div class="stat-row"><dt>${t('status.state')}</dt><dd>${escapeHtml(upstreamLabel)}</dd></div>
        <div class="stat-row"><dt>${t('status.apiKey')}</dt><dd>${upstream.keyConfigured ? t('status.keyYes') : t('status.keyNo')}</dd></div>
        <div class="stat-row"><dt>${t('status.requests')}</dt><dd>${fmtNumber(upstream.requests)}</dd></div>
        <div class="stat-row"><dt>${t('status.ok')}</dt><dd>${fmtNumber(upstream.ok)}</dd></div>
        <div class="stat-row"><dt>${t('status.rateLimited')}</dt><dd>${fmtNumber(upstream.rateLimited)}</dd></div>
        <div class="stat-row"><dt>${t('status.errors')}</dt><dd>${fmtNumber(upstream.errors)}</dd></div>
        <div class="stat-row"><dt>${t('status.lastOk')}</dt><dd>${upstream.lastOkAt ? timeAgo(upstream.lastOkAt) : '—'}</dd></div>
        <div class="stat-row"><dt>${t('status.lastRateLimit')}</dt><dd>${upstream.lastRateLimitAt ? timeAgo(upstream.lastRateLimitAt) : '—'}</dd></div>
        <div class="stat-row"><dt>${t('status.lastError')}</dt><dd>${upstream.lastErrorAt ? timeAgo(upstream.lastErrorAt) : '—'}</dd></div>
      </dl></div>
    `;

    // Live detail
    liveBody.innerHTML = `
      <div class="stat-list"><dl style="margin:0">
        <div class="stat-row"><dt>${t('status.state')}</dt><dd>${escapeHtml(liveLabel)}</dd></div>
        <div class="stat-row"><dt>${t('status.subscribers')}</dt><dd>${fmtNumber(live.subscribers)}</dd></div>
        <div class="stat-row"><dt>${t('status.symbols')}</dt><dd>${fmtNumber(live.symbols)}</dd></div>
        <div class="stat-row"><dt>${t('status.pricesKnown')}</dt><dd>${fmtNumber(live.pricesKnown)}</dd></div>
        <div class="stat-row"><dt>${t('status.lastMessage')}</dt><dd>${live.lastMessageAt ? timeAgo(live.lastMessageAt) : '—'}</dd></div>
        <div class="stat-row"><dt>${t('status.reconnects')}</dt><dd>${fmtNumber(live.reconnects)}</dd></div>
      </dl></div>
    `;

    // Cache detail
    cacheBody.innerHTML = `
      <div class="stat-list"><dl style="margin:0">
        <div class="stat-row"><dt>${t('status.entries')}</dt><dd>${fmtNumber(cache.entries)} / ${fmtNumber(cache.maxEntries)}</dd></div>
        <div class="stat-row"><dt>${t('status.inFlight')}</dt><dd>${fmtNumber(cache.inFlight)}</dd></div>
        <div class="stat-row"><dt>${t('status.hits')}</dt><dd>${fmtNumber(cache.hit)}</dd></div>
        <div class="stat-row"><dt>${t('status.stale')}</dt><dd>${fmtNumber(cache.stale)}</dd></div>
        <div class="stat-row"><dt>${t('status.misses')}</dt><dd>${fmtNumber(cache.miss)}</dd></div>
        <div class="stat-row"><dt>${t('status.errors')}</dt><dd>${fmtNumber(cache.error)}</dd></div>
        <div class="stat-row"><dt>${t('status.hitRatio')}</dt><dd>${escapeHtml(hitRatioStr)}</dd></div>
      </dl></div>
    `;

    // Server detail
    const d = Math.floor(uptime / 86400);
    const h = Math.floor((uptime % 86400) / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    let uptimeStr = '';
    if (d > 0) uptimeStr += d + 'd ';
    if (h > 0 || d > 0) uptimeStr += h + 'h ';
    uptimeStr += m + 'm';

    serverBody.innerHTML = `
      <div class="stat-list"><dl style="margin:0">
        <div class="stat-row"><dt>${t('status.version')}</dt><dd>${escapeHtml(version)}</dd></div>
        <div class="stat-row"><dt>${t('status.node')}</dt><dd>${escapeHtml(node)}</dd></div>
        <div class="stat-row"><dt>${t('status.uptime')}</dt><dd>${uptimeStr}</dd></div>
        <div class="stat-row"><dt>${t('status.started')}</dt><dd>${fmtDateTime(startedAt)}</dd></div>
        <div class="stat-row"><dt>${t('status.memory')}</dt><dd>${fmtNumber(memory.rss / 1048576, { max: 1 })} MB / ${fmtNumber(memory.heapUsed / 1048576, { max: 1 })} MB</dd></div>
      </dl></div>
    `;

    updated.textContent = t('status.updated', { time: fmtDateTime(Date.now()) });

  } catch (err) {
    banner.hidden = false;
    banner.className = 'notice is-error';
    banner.textContent = t('status.unreachable');
    
    kpis.innerHTML = `
      <div class="card kpi-card">
        <div class="card-body">
          <div style="color:var(--muted); font-size:0.85rem; margin-bottom:4px;">${t('status.overall')}</div>
          <div style="font-size:1.5rem; font-weight:700">
            <span class="status-dot is-error"></span>${t('status.down')}
          </div>
        </div>
      </div>
    `;
    upstreamBody.innerHTML = '';
    liveBody.innerHTML = '';
    cacheBody.innerHTML = '';
    serverBody.innerHTML = '';
    updated.textContent = t('status.updated', { time: fmtDateTime(Date.now()) });
  }
}

qs('#statusRefresh').addEventListener('click', load);

function startRefresh() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      load();
    }
  }, 15000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    load();
    startRefresh();
  } else {
    if (timer) clearInterval(timer);
    timer = null;
  }
});

load();
startRefresh();
