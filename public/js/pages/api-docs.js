import { initLayout, qs, qsa, setTitle } from '../layout.js';
import { t } from '../i18n.js';

initLayout({ active: '' });
setTitle('API');

const urlInput = qs('#tryUrl');
const output = qs('#tryOutput');
const meta = qs('#tryMeta');

let sendSeq = 0;
async function send(url) {
  const seq = ++sendSeq;
  output.textContent = '…';
  meta.textContent = '';
  const started = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const ms = Math.round(performance.now() - started);
    const text = await res.text();
    if (seq !== sendSeq) return;
    let body = text;
    try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
    if (body.length > 20000) body = body.slice(0, 20000) + `\n… (${t('apiDocs.truncated')})`;
    output.textContent = body;
    meta.textContent = `HTTP ${res.status} · ${ms} ms · X-Cache: ${res.headers.get('X-Cache') || '—'} · ${text.length.toLocaleString('en-US')} bytes`;
  } catch (err) {
    if (seq !== sendSeq) return;
    output.textContent = String(err && err.message ? err.message : err);
    meta.textContent = t('apiDocs.failed');
  }
}

qs('#tryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!/^\/(api\/|healthz)/.test(url)) { meta.textContent = t('apiDocs.onlyLocal'); return; }
  send(url);
});

qsa('.try-btn').forEach((btn) => btn.addEventListener('click', () => {
  urlInput.value = btn.dataset.url;
  send(btn.dataset.url);
  qs('#tryCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

// SSE demo: listen for 10 seconds, print the first events.
let es = null;
let esTimeout = null;
qs('#streamBtn').addEventListener('click', () => {
  const out = qs('#streamOutput');
  if (es) { es.close(); es = null; }
  if (esTimeout) { clearTimeout(esTimeout); esTimeout = null; }
  out.hidden = false;
  out.textContent = '';
  let lines = 0;
  const log = (l) => { if (lines++ < 40) out.textContent += l + '\n'; };
  es = new EventSource('/api/stream');
  const mine = es;
  es.addEventListener('hello', (e) => log('hello: ' + e.data.slice(0, 200) + (e.data.length > 200 ? '…' : '')));
  es.addEventListener('tick', (e) => log('tick:  ' + e.data.slice(0, 200) + (e.data.length > 200 ? '…' : '')));
  es.onerror = () => log('(connection error)');
  esTimeout = setTimeout(() => { if (es === mine) { es.close(); es = null; log('(closed after 10 s)'); } }, 10000);
});
