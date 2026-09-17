import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { TtlCache } from './cache.js';
import { coinDetailUrl, COIN_DETAIL_TTL_MS } from './routes.js';
import { createLive } from './live.js';
import { getUniverse, getFx } from './universe.js';
import { cacheKey, fetchUpstream, upstreamStatus } from './upstream.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const WARM_COINS = Math.max(0, parseInt(process.env.WARM_COINS || '10', 10) || 0);
const WARM_INTERVAL_MS = 10 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cache = new TtlCache(500);
const live = createLive();

// Optional on-disk cache snapshot: survives restarts (and CoinGecko cooldowns). Empty CACHE_FILE disables it.
const CACHE_FILE = process.env.CACHE_FILE === undefined
  ? path.resolve(__dirname, '../.cache/cache.json')
  : process.env.CACHE_FILE;

async function restoreCache() {
  if (!CACHE_FILE) return;
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const n = cache.restore(JSON.parse(raw));
    if (n) console.log(`Restored ${n} cache entries from ${CACHE_FILE}`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('Cache restore failed:', err.message);
  }
}

let lastSnapshotSize = -1;
async function persistCache() {
  if (!CACHE_FILE) return;
  try {
    const snap = cache.snapshot();
    if (snap.entries.length === lastSnapshotSize && snap.entries.length === 0) return;
    lastSnapshotSize = snap.entries.length;
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${CACHE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snap));
    await fs.rename(tmp, CACHE_FILE);
  } catch (err) {
    console.warn('Cache persist failed:', err.message);
  }
}

const { server } = await createApp({ cache, live });

function shutdown() {
  console.log('Shutting down gracefully...');
  persistCache().finally(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await restoreCache();
server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
setInterval(persistCache, 30000).unref();

setTimeout(() => {
  getUniverse({cache}).catch(()=>{});
  getFx({cache}).catch(()=>{});
}, 500);

setInterval(() => {
  getUniverse({cache}).catch(()=>{});
}, 60000).unref();

async function warmTopCoins() {
  if (WARM_COINS === 0 || upstreamStatus().throttled) return;
  const uni = await getUniverse({ cache }).catch(() => null);
  const rows = (uni?.rows || []).slice(0, WARM_COINS);
  let warmed = 0;
  for (const row of rows) {
    if (upstreamStatus().throttled) break;
    const url = coinDetailUrl(row.id);
    await cache.get(cacheKey(url), COIN_DETAIL_TTL_MS, () => fetchUpstream(url)).catch(() => {});
    warmed++;
  }
  if (LOG_LEVEL === 'debug') console.log(`warm: ${warmed} coins`);
}

const runWarmup = () => warmTopCoins().catch((err) => {
  if (LOG_LEVEL !== 'silent') console.error('Warm cache failed:', err.message);
});

setTimeout(runWarmup, 5000).unref();
setInterval(runWarmup, WARM_INTERVAL_MS).unref();
