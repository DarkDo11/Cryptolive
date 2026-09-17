# Page contract (read together with ARCHITECTURE.md)

Every page in `public/*.html` follows this template exactly (replace TITLE, DESC, PAGE, and the `<main>` body):

```html
<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="theme-color" content="#080b0f">
  <title>TITLE · Cryptolive</title>
  <meta name="description" content="DESC">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="/css/style.css">
  <script src="/js/theme-boot.js"></script>
  <!-- only on pages with charts: -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js" defer></script>
  <script type="module" src="/js/pages/PAGE.js"></script>
</head>
<body>
  <div id="app-header"></div>
  <main class="shell" id="main">
    ... static skeleton markup of the page (containers with ids the page script fills) ...
  </main>
  <div id="app-footer"></div>
</body>
</html>
```

`/js/theme-boot.js` (already exists) applies the saved theme before first paint. CSP forbids inline scripts
and inline event handlers (`onclick=` etc.) — **never** use them; attach listeners with `addEventListener`
(use event delegation on containers for rows/buttons).

## Available modules (exact exports)

`/js/layout.js`
- `initLayout({active})` — `active` ∈ `'markets' | 'gainers-losers' | 'heatmap' | 'categories' | 'exchanges' | 'watchlist' | 'portfolio' | 'converter' | 'compare' | 'alerts' | 'overview' | 'trending' | 'settings' | 'exchanges' | ''`. Call first thing. Injects header + ticker bar + footer + search palette, starts live connection.
- `toast(message, {type:'info'|'success'|'error'})`, `setTitle(text)`, `qs(sel, ctx?)`, `qsa(sel, ctx?)`, `debounce(fn, ms)`.
- Window events you can listen to: `currency:change` (user switched fiat currency → refetch & re-render), `watchlist:change`, `portfolio:change`, `settings:change`, `live:status` (detail: `'connecting'|'live'|'offline'`).

`/js/api.js`
- `api.global()` → CoinGecko `/global` raw (`data.total_market_cap.usd`, `data.market_cap_change_percentage_24h_usd`, `data.market_cap_percentage.btc`, …)
- `api.fng()` → `{value, classification, timestamp, history:[{value,timestamp}]}`
- `api.trending()` → `{coins:[{id,name,symbol,thumb,rank,price_usd,change24h,sparkline_url}]}`
- `api.markets({page, perPage, ids, category, order})` → array of raw CoinGecko market rows in the **current currency** (`vs` is added automatically from settings). Max perPage 250.
- `api.coin(id)` → raw CoinGecko `/coins/{id}` (has `market_data.current_price[cur]`, `market_data.market_cap[cur]`, `market_data.total_volume[cur]`, `market_data.high_24h`, `low_24h`, `ath`, `ath_change_percentage`, `ath_date`, `atl*`, `circulating_supply`, `total_supply`, `max_supply`, `price_change_percentage_1h_in_currency[cur]`, `price_change_percentage_24h/7d/14d/30d/60d/200d/1y`, `fully_diluted_valuation`, `sparkline_7d.price`; plus `description.en`, `links.homepage[]`, `links.blockchain_site[]`, `links.repos_url.github[]`, `links.twitter_screen_name`, `links.subreddit_url`, `links.whitepaper`, `categories[]`, `genesis_date`, `hashing_algorithm`, `image.large`, `market_cap_rank`).
- `api.chart(id, days)` → `{prices:[[ts,v]], market_caps:[[ts,v]], total_volumes:[[ts,v]]}` in current currency. days ∈ 1,7,30,90,365,'max'.
- `api.ohlc(id, days)` → `[[ts,o,h,l,c], …]`. days ∈ 1,7,14,30,90,180,365.
- `api.tickers(id, page)` → `{tickers:[{exchange, exchange_id, exchange_logo, base, target, last_usd, volume_usd, trust_score ('green'|'yellow'|'red'|null), spread, trade_url}]}`
- `api.search(q)` → `{coins:[{id,name,symbol,thumb,rank}], categories:[{id,name}], exchanges:[{id,name,thumb}]}`
- `api.categories()` → `[{id,name,market_cap,market_cap_change_24h,volume_24h,top_3_coins:[url],top_3_coins_id:[id]}]`
- `api.exchanges(page, perPage)` → raw `[{id,name,year_established,country,image,url,trust_score,trust_score_rank,trade_volume_24h_btc}]`
- `api.simplePrice(ids, vs)` → `{bitcoin:{usd:…, eur:…, usd_24h_change:…}}` (`ids` comma string, `vs` comma string)
- `api.currencies()` → `[{code,symbol,name}]`
- `api.fxRatio()` → number: current-currency price / USD price (1 for usd). Multiply **USD live prices** by it.
- `normalizeCoin(row)` → `{id, rank, name, symbol, image, price, change1h, change24h, change7d, volume, marketCap, fdv, sparkline[], high24h, low24h, ath, athDate, atl, circulating, total, max}`
- Errors: throws `ApiError {status, message}`.

`/js/store.js`
- `settings.get()` → `{theme, currency, perPage, …}`; `settings.set(patch)`.
- `watchlist.list()`, `watchlist.has(id)`, `watchlist.toggle(id)`, `watchlist.add(id)`, `watchlist.remove(id)`, `watchlist.replace?` (not guaranteed — use add/remove).
- `portfolio.list()` → transactions `[{id, coinId, symbol, name, image, type:'buy'|'sell', amount, price (USD), date (ms), note}]`; `portfolio.add(tx)`, `portfolio.update(id, patch)`, `portfolio.remove(id)`, `portfolio.clear()`, `portfolio.holdings()` → `[{coinId, symbol, name, image, amount, costBasisUsd, avgPriceUsd}]`.

`/js/format.js`
- `fmtCurrency(value, code='usd', {compact})`, `fmtCompact(value, code)`, `fmtNumber(value, {max})`, `fmtPercent(value)`, `fmtSupply(n, symbol)`, `fmtDate(ts)`, `fmtDateTime(ts)`, `fmtTime(ts)`, `timeAgo(ts)`, `currencySymbol(code)`, `escapeHtml(str)`.

`/js/live.js`
- `live.connect()`, `live.subscribe(cb)` → unsubscribe fn; `cb({ts, prices:{[coinId]:{p: usdPrice, c: change24hPct}}})`.
- `applyLiveTick(rootEl, tick, fx)` — updates any `[data-live-price="<id>"][data-price-usd]` and `[data-live-change="<id>"]` inside root with flash animation. `flashPrice(el, 'up'|'down')`.

`/js/components.js`
- `renderCoinTable(container, coins, opts)` — `coins` are **normalized** coins. opts: `{columns?: ['rank','coin','price','change1h','change24h','change7d','volume','marketCap','sparkline'], sortable?: true, sortKey?, sortDir?: 'asc'|'desc', onSort?(key), showStar?: true, fx?: 1}`. Renders `.table-frame > table.data-table`. Price cells already have `data-live-price` / `data-price-usd` so `applyLiveTick(container, tick, fx)` works.
- `sortCoins(coins, key, dir)`, `sparklineSvg(values, isUp, {width,height})`, `changeBadge(value)`, `renderPagination(container, {page, totalPages, onChange})`, `skeletonRows(count, cols)` → html string, `emptyState(title, hint)` → html string, `gaugeSvg(value, label)` → html string, `coinChip(coin)` → html string, `normalizeCoin`.

## Live price pattern (use on every page with prices)
```js
let fx = await api.fxRatio();
const unsub = live.subscribe((tick) => applyLiveTick(tableContainer, tick, fx));
window.addEventListener('currency:change', async () => { fx = await api.fxRatio(); await load(); });
```

## Loading / error / empty
Show `skeletonRows()` or `.skeleton` blocks while loading; on error render a `.card` with the message and a
"Retry" `.btn` that calls `load()` again; use `emptyState()` when there is nothing to show.
Refresh data periodically only when `document.visibilityState === 'visible'`.
