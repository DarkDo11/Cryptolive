# Cryptolive — Architecture & UI Spec

Cryptolive is a self-hosted crypto market data service (CoinGecko/CoinMarketCap-style):
market overview, coin detail pages, watchlist, portfolio tracker, converter, heatmap,
gainers/losers, categories, exchanges. Live prices via Binance WebSocket relayed over SSE.

Language of UI: **English**. Code comments: English. No frameworks, no build step.
Plain ES modules in the browser, plain Node.js (>=22) on the server, **zero npm dependencies**.

---

## 1. Repository layout

```
server/
  server.js            # HTTP server: static files + /api proxy + /api/stream SSE + universe warm-up
  cache.js             # in-memory TTL cache: request coalescing, stale-while-revalidate, stale-on-error
  upstream.js          # CoinGecko fetcher: concurrency limit (3), 15s timeout, capped 429 back-off
  universe.js          # top-500 coins in USD refreshed every 60s + fx ratios; serves most /api/markets
  routes.js            # /api route table (path -> upstream URL builder + TTL)
  live.js              # Binance WebSocket client -> broadcast to SSE subscribers
public/
  index.html           # Markets overview (home)
  coin.html            # Coin detail page   (URL: /coin/<id>)
  watchlist.html       # /watchlist
  portfolio.html       # /portfolio
  converter.html       # /converter
  heatmap.html         # /heatmap
  gainers-losers.html  # /gainers-losers
  categories.html      # /categories
  exchanges.html       # /exchanges
  404.html
  css/style.css        # global design system + all components (single file)
  js/api.js            # fetch wrapper for /api with client cache + currency awareness
  js/format.js         # number/currency/percent/date formatters
  js/store.js          # localStorage: settings (theme, currency), watchlist, portfolio
  js/live.js           # EventSource client for /api/stream + price-flash helper
  js/layout.js         # injects header/nav/footer, global search (Cmd/Ctrl+K), theme + currency switch
  js/components.js     # shared renderers: coin table, sparkline SVG, change badge, pagination, skeletons, toast
  js/pages/markets.js
  js/pages/coin.js
  js/pages/watchlist.js
  js/pages/portfolio.js
  js/pages/converter.js
  js/pages/heatmap.js
  js/pages/gainers-losers.js
  js/pages/categories.js
  js/pages/exchanges.js
Dockerfile
docker-compose.yml
package.json           # "type": "module", scripts: start, dev — no dependencies
docs/ARCHITECTURE.md   # this file
README.md
```

Clean URLs: the server maps `/` -> `index.html`, `/coin/<id>` -> `coin.html`,
`/watchlist` -> `watchlist.html`, etc. (see §2.1). Unknown paths -> `404.html` with status 404.

---

## 2. Backend (`server/`)

Node 22 built-ins only: `node:http`, `node:fs/promises`, `node:path`, `node:url`, global `fetch`,
global `WebSocket`. ES modules (`"type": "module"`).

Env vars: `PORT` (default 8080), `HOST` (default `0.0.0.0`), `COINGECKO_API_KEY` (optional; if set,
send header `x-cg-demo-api-key`), `UPSTREAM_COINGECKO` (default `https://api.coingecko.com/api/v3`),
`UPSTREAM_FNG` (default `https://api.alternative.me/fng/`), `LOG_LEVEL` (`info` | `debug`).

### 2.1 Static serving
- Root: `public/`. Serve with correct `Content-Type` (html, css, js, json, svg, png, ico, webmanifest, txt).
- `Cache-Control`: `no-cache` for `.html`, `public, max-age=3600` for css/js/assets.
- Route table for clean URLs (exact match or prefix):
  - `/` -> `index.html`
  - `/coin/:id` -> `coin.html` (the page reads the id from `location.pathname`)
  - `/watchlist`, `/portfolio`, `/converter`, `/heatmap`, `/gainers-losers`, `/categories`, `/exchanges` -> matching html
  - `/healthz` -> `200 {"ok":true,"uptime":<sec>,"cache":{"entries":n},"live":{"connected":bool,"subscribers":n}}`
- Path traversal protection (resolve and ensure inside `public/`).
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'`.
- GZIP not required.

### 2.2 `/api` proxy with cache (`routes.js`, `cache.js`)
All browser data requests go to **our** server, never directly to CoinGecko (rate limits: ~10-30 req/min without key).
Every route: validate query params (whitelist), build upstream URL, fetch through `cache.get(key, ttlMs, fetcher)`.

Cache semantics (`cache.js`):
- `get(key, ttlMs, fetcher)`: return fresh value if present; if a fetch for the same key is in flight, await it
  (coalescing); otherwise fetch. On upstream failure (network error, 429, 5xx) **return the stale value if one exists**
  (mark response header `X-Cache: stale`), else throw.
- Response headers: `X-Cache: hit | miss | stale`, `Cache-Control: public, max-age=<ttl seconds>`.
- Entry cap 500; evict oldest on overflow. `stats()` returns `{entries}`.
- Upstream retry: if 429, wait `Retry-After` or 2s and retry once.
- Global concurrency limiter for upstream calls: max 3 parallel, FIFO queue.

Routes (all GET, JSON; `vs` = vs_currency, default `usd`, allowed: usd, eur, gbp, rub, jpy, cny, btc, eth):

| Route | Upstream | TTL |
|---|---|---|
| `/api/global` | `/global` | 120s |
| `/api/fng` | alternative.me `?limit=30&format=json` -> return `{value, classification, timestamp, history:[{value,timestamp}]}` | 600s |
| `/api/trending` | `/search/trending` -> return `{coins:[{id,name,symbol,thumb,rank,price_usd,change24h,sparkline_url}]}` (map from `item.data`) | 300s |
| `/api/markets?vs=&page=&per_page=&ids=&category=&order=` | `/coins/markets?vs_currency&order=market_cap_desc&per_page(<=250)&page&sparkline=true&price_change_percentage=1h,24h,7d[&ids][&category]` | 60s |
| `/api/coin/:id` | `/coins/:id?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true` | 120s |
| `/api/coin/:id/chart?vs=&days=` | `/coins/:id/market_chart?vs_currency&days` (days ∈ 1,7,30,90,365,max) -> `{prices, market_caps, total_volumes}` | 1d: 120s, others 900s |
| `/api/coin/:id/ohlc?vs=&days=` | `/coins/:id/ohlc?vs_currency&days` (days ∈ 1,7,14,30,90,180,365) | 300s |
| `/api/coin/:id/tickers?page=` | `/coins/:id/tickers?page&order=volume_desc&depth=false` -> `{tickers:[{exchange, exchange_id, exchange_logo?, base, target, last_usd, volume_usd, trust_score, spread, trade_url}]}` | 300s |
| `/api/search?q=` | `/search?query` -> `{coins:[{id,name,symbol,thumb,rank}] (max 20), categories:[{id,name}], exchanges:[{id,name,thumb}]}` | 600s |
| `/api/categories` | `/coins/categories?order=market_cap_desc` -> strip `content`, keep `id,name,market_cap,market_cap_change_24h,volume_24h,top_3_coins,top_3_coins_id` | 600s |
| `/api/exchanges?page=&per_page=` | `/exchanges?per_page&page` | 600s |
| `/api/simple-price?ids=&vs=` | `/simple/price?ids&vs_currencies&include_24hr_change=true` (ids max 100) | 60s |
| `/api/currencies` | static list (no upstream): `[{code:"usd",symbol:"$",name:"US Dollar"},{eur,"€"},{gbp,"£"},{rub,"₽"},{jpy,"¥"},{cny,"¥"},{btc,"₿"},{eth,"Ξ"}]` | — |

Errors: JSON `{"error":"message"}` with 400/404/502/504. Log one line per request at `info`:
`METHOD path status ms cache`.

### 2.3 Live prices — `/api/stream` (SSE) (`live.js`)
- Server keeps **one** WebSocket to Binance combined stream:
  `wss://stream.binance.com:9443/stream?streams=<sym>usdt@miniTicker/...` for a fixed symbol list of the top ~60
  coins that exist on Binance (hardcode a map CoinGecko id -> Binance symbol, e.g. bitcoin->BTCUSDT, ethereum->ETHUSDT,
  binancecoin->BNBUSDT, solana->SOLUSDT, ripple->XRPUSDT, cardano->ADAUSDT, dogecoin->DOGEUSDT, tron->TRXUSDT,
  avalanche-2->AVAXUSDT, chainlink->LINKUSDT, polkadot->DOTUSDT, matic-network->POLUSDT (POL), litecoin->LTCUSDT,
  bitcoin-cash->BCHUSDT, shiba-inu->SHIBUSDT, uniswap->UNIUSDT, stellar->XLMUSDT, near->NEARUSDT, aptos->APTUSDT,
  internet-computer->ICPUSDT, ethereum-classic->ETCUSDT, filecoin->FILUSDT, hedera-hashgraph->HBARUSDT, sui->SUIUSDT,
  arbitrum->ARBUSDT, optimism->OPUSDT, cosmos->ATOMUSDT, render-token->RENDERUSDT, injective-protocol->INJUSDT,
  the-graph->GRTUSDT, pepe->PEPEUSDT, zcash->ZECUSDT, monero (not on binance: skip), fetch-ai->FETUSDT,
  immutable-x->IMXUSDT, algorand->ALGOUSDT, vechain->VETUSDT, aave->AAVEUSDT, maker->MKRUSDT, the-sandbox->SANDUSDT,
  decentraland->MANAUSDT, axie-infinity->AXSUSDT, theta-token->THETAUSDT, eos->EOSUSDT, tezos->XTZUSDT, neo->NEOUSDT,
  kaspa (skip), toncoin->TONUSDT, wrapped-bitcoin (skip), staked-ether (skip), tether (skip), usd-coin (skip),
  dai (skip), leo-token (skip), okb (skip), crypto-com-chain->CROUSDT, bittensor->TAOUSDT, ondo-finance->ONDOUSDT,
  worldcoin-wld->WLDUSDT, jupiter-exchange-solana->JUPUSDT, sei-network->SEIUSDT, celestia->TIAUSDT,
  mantle->MNTUSDT, dogwifcoin->WIFUSDT, floki->FLOKIUSDT, bonk->BONKUSDT, starknet->STRKUSDT, ethena->ENAUSDT,
  pyth-network->PYTHUSDT, hyperliquid (skip)).
- Reconnect with exponential backoff (1s..30s) on close/error. Lazy: connect when the first SSE subscriber
  arrives; disconnect 60s after the last one leaves.
- Throttle: aggregate ticks and broadcast at most **once per second** a single event:
  `event: tick\ndata: {"ts":<ms>,"prices":{"bitcoin":{"p":76318.9,"c":0.46},"ethereum":{...}}}\n\n`
  where `p` = last price in USD (miniTicker `c`), `c` = 24h change % computed as `(c-o)/o*100`.
- On subscribe, immediately send the latest snapshot (if any) then `event: hello` with `{"symbols":[...ids]}`.
- Keep-alive comment `: ping` every 25s. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`.
- If the client's chosen fiat currency is not USD, the **client** converts using the ratio
  `coin.current_price(vs) / coin.current_price(usd)` obtained from the markets payload; the server only knows USD.
  Practically: the client stores `usdRatio = current_price_in_vs / current_price_usd` from `/api/markets` (server adds
  `current_price_usd` to each row when vs != usd by fetching... **no** — keep simple: server's `/api/markets` with
  `vs != usd` returns rows as-is; the client fetches `/api/simple-price?ids=bitcoin&vs=<vs>,usd` once to derive one
  fiat ratio `fx = price_vs / price_usd` and multiplies live USD prices by `fx`).

### 2.4 Docker
```
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server/server.js"]
```
`docker-compose.yml`: service `cryptolive`, `build: .`, `restart: unless-stopped`, ports `8080:8080`,
`environment: [ "COINGECKO_API_KEY=${COINGECKO_API_KEY:-}" ]`.

---

## 3. Frontend foundations

### 3.1 Design system (`css/style.css`)
Keep the existing look: dark terminal-ish theme, blue accent, green/red for up/down, `Inter` font
(load from Google Fonts: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap`),
`--radius: 8px`, cards with 1px border + subtle shadow. Tokens on `:root` (dark default) and
`:root[data-theme="light"]`:

```
--bg #080b0f  --panel #101720  --panel-soft #141d28  --panel-raised #182332
--line #263442  --line-strong #334758  --text #eef4f8  --muted #8795a4  --muted-strong #a9b5bf
--green #20c997 --green-soft rgba(32,201,151,.13)  --red #ff5c73 --red-soft rgba(255,92,115,.13)
--blue #4ea1ff --blue-soft rgba(78,161,255,.12) --amber #f5b451 --shadow rgba(0,0,0,.28)
light: --bg #f4f7fa --panel #fff --panel-soft #f7fafc --panel-raised #edf3f8 --line #d9e1e8
       --line-strong #c4d0db --text #17212b --muted #657485 --muted-strong #3f4e5d --shadow rgba(29,42,56,.12)
```
Layout: `.shell { width:min(1440px,100%); margin:0 auto; padding:16px 22px }`; mobile padding 12px.
Components that must exist (class names are the contract for JS):
`.site-header` (sticky, `.header-inner`, `.logo`, `.nav`, `.nav a.is-active`, `.header-actions`, `.search-trigger`,
`.currency-select`, `.theme-toggle`, `.nav-burger` + `.nav.is-open` for mobile),
`.ticker-bar` (global stats strip under header: horizontally scrollable on mobile, items `.ticker-item` with
`.ticker-label` + `.ticker-value` + `.change-badge`),
`.card`, `.card-head` (title + right meta), `.card-body`,
`.grid-3` (3 equal columns, 1 on mobile), `.grid-2`,
`.table-frame` (overflow-x auto) + `table.data-table` (th sortable `.is-sortable[data-sort]`, `.sort-asc/.sort-desc`
indicator, `th.is-sticky` for the coin column on mobile), `.asset-cell` (logo img 24px + name + symbol),
`.price-cell` (tabular-nums) with `.flash-up`/`.flash-down` animations (background fades over 700ms),
`.change-badge.is-up/.is-down`, `.sparkline`, `.star-btn` (outline star, `.is-active` filled amber),
`.tabs` + `.tab.is-active`, `.pagination`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-sm`, `.input`, `.select`,
`.field` (label + control), `.skeleton` (shimmer), `.empty-state`, `.toast-stack` + `.toast`,
`.modal-backdrop` + `.modal` (search palette & forms), `.search-palette` (input + results list with sections),
`.gauge` (Fear & Greed semicircle SVG), `.range-bar` (24h low/high with marker), `.stat-list` (dl rows),
`.chart-toolbar` (range buttons `.range-btn.is-active`, type toggle), `.heatmap` (position relative container;
tiles absolutely positioned `.heatmap-tile` with `.tile-symbol`, `.tile-change`, intensity via
`style="--tint: <0..1>"` and `.is-up/.is-down`), `.site-footer`.
Responsive breakpoints: 1120px, 780px, 480px. Respect `prefers-reduced-motion`. Focus-visible outlines.

### 3.2 `js/format.js` (exports)
`fmtCurrency(value, code='usd', {compact=false} = {})` — `Intl.NumberFormat`; for btc/eth use custom symbol prefix
(`₿0.01234`, 8 decimals max); dynamic precision: >=1000 -> 0-2 decimals, >=1 -> 2, <1 -> up to 6 significant
decimals, tiny values (<0.0001) -> up to 10 decimals. `fmtCompact(value, code)` (`$1.23T`, `$45.6B`),
`fmtNumber(value, {max=2})`, `fmtPercent(value)` (`+1.23%`, handles null -> `—`), `fmtSupply(n, symbol)`,
`fmtDate(ts)`, `fmtDateTime(ts)`, `fmtTime(ts)`, `timeAgo(ts)`, `currencySymbol(code)`.

### 3.3 `js/store.js`
Namespace `cryptolive:*` in localStorage. Exports:
- `settings`: `get()` -> `{theme:'dark'|'light', currency:'usd', perPage:100}`, `set(patch)`, emits
  `window.dispatchEvent(new CustomEvent('settings:change', {detail}))`.
- `watchlist`: `list()` -> string[] ids, `has(id)`, `toggle(id)`, `add`, `remove`; emits `watchlist:change`.
- `portfolio`: transactions `[{id:uuid, coinId, symbol, name, image, type:'buy'|'sell', amount, price (in USD), date(ms), note}]`;
  `list()`, `add(tx)`, `update(id, patch)`, `remove(id)`, `clear()`, `holdings()` -> aggregated
  `[{coinId, symbol, name, image, amount, costBasisUsd, avgPriceUsd}]` (FIFO not required: avg cost); emits `portfolio:change`.
- Migrate old key `cryptolive-theme` if present.

### 3.4 `js/api.js`
`api.get(path, params)` -> `fetch('/api'+path?query)`; JSON; client-side memory cache keyed by URL with TTL 30s;
throws `ApiError {status, message}`. Convenience: `api.global()`, `api.fng()`, `api.trending()`,
`api.markets({page, perPage, ids, category, order})` (adds `vs` from settings), `api.coin(id)`,
`api.chart(id, days)`, `api.ohlc(id, days)`, `api.tickers(id, page)`, `api.search(q)`, `api.categories()`,
`api.exchanges(page, perPage)`, `api.simplePrice(ids, vs)`, `api.currencies()`.
Also `api.fxRatio()` -> ratio `price_bitcoin[vs] / price_bitcoin[usd]` for current currency (1 when usd), cached 5 min.

### 3.5 `js/live.js`
`live.connect()` (idempotent, EventSource `/api/stream`), `live.subscribe(callback)` -> unsubscribe fn; callback
receives `{ts, prices}` in **USD**. `live.status()` -> `'connecting'|'live'|'offline'`; dispatches
`live:status` event. Helper `flashPrice(el, direction)` toggles `.flash-up/.flash-down` (remove after animation end).
Auto-reconnect is native to EventSource; show status in the header pill (`#liveStatus`: green pulse when live,
grey when offline).

### 3.6 `js/layout.js`
Imported by every page as the first module. `initLayout({active: 'markets'|'watchlist'|...})`:
- Injects `<header class="site-header">`: logo "Cryptolive" (link `/`), nav: Markets `/`, Gainers & Losers
  `/gainers-losers`, Heatmap `/heatmap`, Categories `/categories`, Exchanges `/exchanges`, Watchlist `/watchlist`
  (with count badge), Portfolio `/portfolio`, Converter `/converter`. Actions: search button (`⌘K` hint),
  currency select (from `api.currencies()`, persisted via `settings`), theme toggle (sun/moon icon, persisted),
  live status pill `#liveStatus`.
- Injects `.ticker-bar` filled from `api.global()` + `api.fng()`: Coins, Exchanges, Market Cap (+24h%), 24h Vol,
  BTC dominance, ETH dominance, Fear & Greed (value + label). Use skeletons while loading.
- Injects footer: "Data by CoinGecko · Live ticks by Binance · Not financial advice" + year + links to pages.
- Global search palette: opened by button, `Cmd/Ctrl+K` or `/`; debounce 250ms `api.search(q)`; shows Coins (with
  rank, thumb), Categories, Exchanges; arrow-key navigation; Enter navigates to `/coin/<id>` (coins),
  `/categories?c=<id>` (categories), `/exchanges` (exchanges). Empty query shows trending coins.
- Applies theme on load before paint (inline script in each html: read `localStorage['cryptolive:settings']`, set
  `data-theme` on `<html>`) — the html pages contain that inline snippet in `<head>`.
- On `settings:change` with currency change: dispatch `currency:change` so pages refetch.
- Exports `toast(message, {type:'info'|'success'|'error'})` and `setTitle(text)`.

### 3.7 `js/components.js`
- `renderCoinTable(container, coins, {columns, sortable:true, onSort, showStar:true, showRank:true})` renders
  `table.data-table` with columns: `#`, Coin, Price, 1h %, 24h %, 7d %, 24h Volume, Market Cap, Last 7 Days
  (sparkline). Row `data-coin-id`; coin cell is a link to `/coin/<id>`; star button toggles watchlist (stop
  propagation). Price cells carry `data-coin-id` + `data-price-usd` for live updates via
  `applyLiveTick(container, tick, fx)` which updates price text + flash + 24h badge.
- `sparklineSvg(values, isUp, {width=135,height=40})`.
- `changeBadge(value)`, `renderPagination(container, {page, totalPages, onChange})`,
  `skeletonRows(count, cols)`, `emptyState(title, hint)`, `gaugeSvg(value 0..100, label)`,
  `coinChip(coin)` (thumb + symbol, link).
- `sortCoins(coins, key, dir)` for keys: rank, price, change1h, change24h, change7d, volume, marketCap, name.
- Normalized coin shape used everywhere (from `/api/markets` rows):
  `{id, rank:market_cap_rank, name, symbol, image, price:current_price, change1h:price_change_percentage_1h_in_currency,
  change24h:price_change_percentage_24h_in_currency ?? price_change_percentage_24h, change7d:..._7d_in_currency,
  volume:total_volume, marketCap:market_cap, fdv:fully_diluted_valuation, sparkline: sparkline_in_7d.price,
  high24h, low24h, ath, athDate, atl, circulating:circulating_supply, total:total_supply, max:max_supply}`
  via `normalizeCoin(row)`.

Every HTML page: `<!doctype html>`, `lang="en"`, viewport, theme-color, `<title>`, meta description, favicon
(`/favicon.svg` — an inline-created simple SVG file with a blue circle and white "C"), fonts link, `css/style.css`,
Chart.js only where charts are used (`https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js`, defer),
then `<script type="module" src="/js/pages/<page>.js">`. Body contains `<div id="app-header"></div>`,
`<main class="shell" id="main">…page skeleton markup…</main>`, `<div id="app-footer"></div>`.

---

## 4. Pages

### 4.1 Markets `/` (`index.html`, `pages/markets.js`)
- Hero row: h1 "Cryptocurrency Prices by Market Cap", subtitle with global market cap + 24h change sentence
  (like CoinGecko: "The global crypto market cap today is $2.61T, a ▲0.9% change in the last 24 hours").
- Highlights `.grid-3`: **Trending** (top 6 from `/api/trending`: thumb, name, price, 24h badge), **Top Gainers
  24h** (from the loaded top-250 markets: top 6), **Top Losers 24h** (bottom 6). Each card head has "View more" links
  (Gainers/Losers -> `/gainers-losers`). Fourth mini-card optional: Fear & Greed gauge.
- Toolbar: tabs `All | Watchlist | Gainers | Losers`; search-in-table input (filters loaded rows by name/symbol);
  per-page select (50/100/250); "Highlights" toggle to hide cards (persist in settings).
- Table via `renderCoinTable`, sortable by every numeric column (client-side over the loaded page), pagination
  (server pages of `perPage`), live price updates from `live` (USD * fx), row hover; star toggles watchlist.
- Refresh markets every 60s (only when tab visible: `document.visibilityState`). Show "Updated hh:mm:ss" meta.
- Read `?page=` from URL and keep it in sync (`history.replaceState`).

### 4.2 Coin detail `/coin/:id` (`coin.html`, `pages/coin.js`)
- Parse id from `location.pathname.split('/')[2]`. Title `<Name> (<SYMBOL>) price today`.
- Header: logo 40px, name, symbol chip, rank chip `#1`, categories chips (first 3), star button, big price (live
  updated + flash), 24h change badge, 24h range bar (low..high with marker), share/copy link button.
- Two-column layout (chart left 2/3, stats right 1/3; stack on mobile):
  - Chart card: toolbar with ranges `24h 7d 30d 90d 1y Max`, type toggle `Line | Candles`, metric toggle
    `Price | Market Cap` (only for Line), log-scale checkbox. Line chart = Chart.js line with gradient fill
    (green if the period change >= 0 else red), tooltips with formatted currency and date. Candles: implement with
    Chart.js `bar` type using floating bars `[low, high]` for wicks plus `[open, close]` bodies (two datasets, colored
    per candle, green/red) — no plugin needed. Show period change % and high/low in the card head.
    Live tick appends/updates the last point of the 24h line chart.
  - Stats card (`.stat-list`): Market Cap, FDV, 24h Volume, Volume/Market Cap, Circulating Supply (with progress bar
    vs max supply when max exists), Total Supply, Max Supply, ATH (price, %-from-ath, date), ATL (same).
  - Converter mini-widget: `<amount> <SYMBOL>` ⇄ `<amount> <currency>` (two inputs, both editable).
  - Price performance card: table of 1h, 24h, 7d, 14d, 30d, 60d, 1y with badges (from `market_data.price_change_percentage_*`).
- Below: **Markets** card — tickers table (Exchange with logo?, Pair, Price, 24h Volume, Trust score colored dot,
  Spread, link "Trade" opens `trade_url` in new tab), "Load more" button (page+1).
- **About** card: description (`description.en`, render as HTML but sanitize: strip `<script>`, allow a, p, br, strong,
  em, ul, li; use a simple allowlist sanitizer), links: Homepage, Explorer(s), GitHub, X/Twitter, Reddit, Whitepaper —
  as `.btn-ghost .btn-sm` chips. Genesis date, hashing algorithm if present.
- 404 handling: if `/api/coin/:id` fails with 404, render empty-state "Coin not found" with a link home.

### 4.3 Watchlist `/watchlist` (`pages/watchlist.js`)
- If empty: empty-state with CTA "Browse markets" and a hint about the star.
- Else `api.markets({ids: watchlist.list().join(','), perPage: 250})` -> `renderCoinTable` with live prices; summary
  strip: number of coins, combined market cap, average 24h change; "Clear watchlist" button (confirm).
- Import/Export buttons: export JSON of ids (download), import via file input.

### 4.4 Portfolio `/portfolio` (`pages/portfolio.js`)
- Summary cards: Total Value, 24h Change (value + %), All-time P&L (value + %), Holdings count.
- Allocation donut (Chart.js doughnut, top 8 + Other) beside holdings table.
- Holdings table: Coin, Price (live), Holdings (amount + value), Avg Buy Price, P&L (abs + %), 24h %, actions
  (add tx / view txs / remove).
- "Add transaction" modal: coin search (uses `/api/search` autocomplete), type Buy/Sell, amount, price per coin
  (prefill with current price via `/api/simple-price`), date (default now), note. Validation. Selling more than held
  -> error toast.
- Transactions list (collapsible per coin or a single table below): date, type, coin, amount, price, total, delete.
- Data in localStorage; export/import JSON. Prices are USD internally; display in selected currency via fx.

### 4.5 Converter `/converter` (`pages/converter.js`)
- Two rows: Amount + asset select (coins list = top 250 from markets + fiat currencies) ⇄ swap button ⇄ Amount +
  asset select. Live rate line "1 BTC = $76,318 · updated 12s ago". Supports crypto→crypto (via USD),
  crypto→fiat, fiat→crypto, fiat→fiat (via fx ratios from `/api/simple-price?ids=bitcoin&vs=<all fiat>`).
- URL state `?from=bitcoin&to=usd&amount=1`. Quick-pick chips: BTC, ETH, SOL, USD, EUR, RUB.
- Popular conversions table below (1 BTC, 1 ETH, 1 SOL, 1 BNB, 1 XRP in the selected currency + 24h %).
- Note: the `/coin` page mini-converter shares the same math helper (export `convert()` from a small module or
  duplicate minimal code — either is acceptable).

### 4.6 Heatmap `/heatmap` (`pages/heatmap.js`)
- Controls: Top `50 | 100 | 250` (market cap), color by `24h | 7d | 1h`, size by `Market Cap | 24h Volume`.
- Squarified treemap algorithm (implement in JS: Bruls et al.) laying out tiles inside `.heatmap` sized to the
  container (`ResizeObserver` relayout). Tile color: green/red scaled by |change| with saturation (clamp at ±10%),
  text: symbol + change %, hide text if tile too small; tooltip on hover (name, price, market cap, change);
  click -> `/coin/<id>`. Legend bar `-10% … 0 … +10%`. Live tick updates tile labels (not layout).

### 4.7 Gainers & Losers `/gainers-losers` (`pages/gainers-losers.js`)
- Load top 300 by market cap (2 pages of 150... use `per_page=250` page 1 + 2 => 500 rows, that's fine),
  filter `volume >= $50k`, timeframe tabs `1h | 24h | 7d`, two side-by-side tables (`.grid-2`): Top 20 gainers,
  Top 20 losers with columns `#`, Coin, Price, Change, 24h Volume, Market Cap. Live prices.

### 4.8 Categories `/categories` (`pages/categories.js`)
- Table: Category, Top 3 coins (thumbs), 24h %, Market Cap, 24h Volume; sortable; search filter.
- Clicking a category -> shows a coin table for that category (`api.markets({category:id})`) in a section below
  (and updates `?c=<id>` in URL; on load with `?c=` present, open it). Breadcrumb / "Back to all categories".

### 4.9 Exchanges `/exchanges` (`pages/exchanges.js`)
- Table: `#`, Exchange (logo + name + country), Trust Score (colored chip 1-10), 24h Volume (BTC and in selected
  currency using BTC price from `simple-price`), Year, link (external). Pagination (per_page 50).

### 4.10 404 (`404.html`)
Empty-state with "Page not found" and link home. Also loads layout.

---

## 4b. Pages added after the initial build
- `/overview` — market dashboard: KPIs, Fear & Greed gauge + 30-day history, dominance doughnut, top sectors, breadth, watchlist snapshot.
- `/trending` — trending coins / categories / NFTs (server maps `search/trending` incl. `categories` and `nfts`).
- `/compare?coins=a,b,c,d` — side-by-side stats + normalised performance chart (max 4).
- `/alerts` — price alerts (`public/js/alerts.js`: localStorage rules, live-tick engine, Notification API); "Set alert" on coin pages.
- `/settings` — appearance, notifications, JSON backup/restore, clear data; PWA (`manifest.webmanifest`, `sw.js`).
- Coin page extras: historical daily OHLC table + CSV export; degraded "partial" mode when upstream is throttled.
- i18n: `public/js/i18n.js` (`t()`, `applyTranslations()`, `data-i18n*` attributes) with dictionaries in `public/js/i18n/{en,ru}.js`; language stored in `settings.lang`, switch in the header reloads the page.

## 5. Non-functional
- No inline event handlers; escape all interpolated text (`escapeHtml`). Images: `loading="lazy"`,
  `referrerpolicy="no-referrer"`, fallback to a lettered circle on error.
- Accessibility: buttons have `aria-label`, tables `scope="col"`, sortable headers `aria-sort`, live regions
  for status pills, focus trap in modals, Esc closes.
- Performance: all lists rendered as one `innerHTML` string; live updates patch only changed cells.
- Every page handles loading (skeleton), error (card with retry button), and empty states.
- README.md: what it is, features, run with `npm start` / Docker, env vars, API routes table, credits.
