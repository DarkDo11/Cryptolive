# Cryptolive

Cryptolive is a self-hosted, zero-dependency cryptocurrency market data service built with Node.js 22 and vanilla ES modules in the spirit of CoinGecko and CoinMarketCap. It delivers a comprehensive markets overview, detailed coin pages with charts, watchlist and portfolio trackers, currency converter, market heatmap, top gainers and losers rankings, categories, and exchange directories. Real-time prices are streamed via a Binance WebSocket connection relayed to browsers through Server-Sent Events (SSE), while upstream CoinGecko data is proxied with an in-memory TTL cache and request coalescing.

## Features

- **Overview**: Market Overview dashboard featuring a Fear & Greed gauge + 30-day history, market dominance doughnut, top sectors bar chart, market breadth, and a watchlist snapshot.
- **Markets**: Global stats bar (total market cap, 24h volume, BTC/ETH dominance, Fear & Greed Index), trending and top gainers/losers highlight cards, sortable top-N coin table with 7-day sparklines, quick filter tabs (All, Watchlist, Gainers, Losers), per-page selector (50/100/250), and live price update flashes; tick up to 4 coins to jump into Compare; CSV export of the current view (also on Watchlist and Portfolio transactions).
- **Coin Detail**: Interactive line (with a volume histogram) and candlestick charts with timeframe ranges (24h to Max) and logarithmic scale toggle, price vs. market cap toggle, key stats (circulating/total/max supply, volume/market cap), ATH/ATL metrics with percentage change and dates, 24h low/high range bar, mini-converter, multi-timeframe price performance, historical data table + CSV export, exchange tickers with trust scores and trade links, coin description, official links, a "Similar coins" card (rank neighbours with live prices) and a "Set alert" button. Coin pages are served with per-coin `<title>`, description, canonical and Open Graph tags filled server-side from the universe snapshot, and the sitemap lists every coin in the universe.
- **Compare**: Up to 4 coins side-by-side comparison with a normalized performance chart.
- **Alerts**: Price alerts (above/below rules checked against the live stream + 60 s polling fallback) triggering toasts and browser Notifications; triggered alerts can be re-armed; stored in `localStorage`; besides above/below price targets, alerts can fire on 24h percent change (≥ +X% / ≤ −X%).
- **Watchlist**: Track favorite coins locally via `localStorage` with JSON import and export capability.
- **Portfolio**: Transaction-based portfolio tracker with buy/sell logging, holdings balances, average buy price, profit & loss (P&L) tracking, asset allocation doughnut chart, a portfolio value vs. invested history chart (7d/30d/90d), a privacy mode that blurs all balances, and JSON import/export. Coin pages link straight into it (`/portfolio?add=<id>`) and into Compare.
- **Converter**: Real-time crypto↔crypto, crypto↔fiat, and fiat↔fiat conversions with URL state synchronization (`?from=&to=&amount=`) and quick-pick popular conversions; an "in all currencies" table for the selected asset, shareable URLs (`?from=coin:bitcoin&to=fiat:eur&amount=1`) with a copy-link button.
- **Heatmap**: Squarified treemap visualization sized by Market Cap or 24h Volume, color-coded by 1h, 24h, or 7d price change percentage with responsive resizing; a Sectors mode renders category market caps as tiles (24h change colouring) linking into the category view.
- **Gainers & Losers**: Highlights top 20 gainers and top 20 losers across 1h, 24h, and 7d horizons (minimum $50k volume filter).
- **Categories**: Market sectors table sorted by market cap with 24h changes and top 3 coins preview; drill down to explore category-specific coin markets.
- **Exchanges**: Directory of the top 250 exchanges with search, sorting (trust rank / volume / age / name), a CEX/DEX filter, trust scores, country of origin, 24h BTC volume, and direct links; each exchange has its own page (`/exchange/:id`) with a BTC volume chart, info card and a filterable list of top trading pairs.
- **Trending**: CoinGecko's trending coins, categories and NFT collections with 7-day sparklines (`/trending`).
- **Settings**: theme (dark / light / system), display currency, language, rows per page, live-flash reduction, browser notification permission, full JSON backup/restore of watchlist + portfolio + alerts, clear local data (`/settings`).
- **Status page** (`/status`): public health dashboard — data-provider state and counters (requests, 429s, errors, cooldown), Binance feed state, cache hit ratio, server version/uptime/memory; auto-refreshes every 15 s from `/healthz`.
- **Global Search & UI**: Command palette (`⌘K` or `/`) with recent searches, searching coins, categories, and exchanges; 18 display currencies (USD, EUR, GBP, RUB, JPY, CNY, CAD, AUD, CHF, KRW, INR, BRL, TRY, UAH, PLN, KZT, BTC, ETH); keyboard shortcuts (`?` for the cheat sheet, `g`+key navigation, `t` theme); **English / Russian interface** (switch in the header, `public/js/i18n/`); dark and light themes; an offline banner when the network drops; installable PWA (web manifest + service worker for the app shell); responsive mobile-friendly design.

## Architecture

- **Frontend (`public/`)**: Static multi-page application with clean URLs, vanilla HTML5/CSS, and native browser ES modules—no build steps or bundlers required.
- **Server (`server/`)**: Lightweight Node.js HTTP server utilizing native modules (`node:http`, `node:fs/promises`, global `fetch`, and global `WebSocket`).
- **Server Resilience & Caching**: 
  - **Caching & Flow**: In-memory stale-while-revalidate cache with request coalescing. On-disk cache snapshot (`CACHE_FILE`, written every 30 s and on shutdown, restored on start; Docker volume `cryptolive-cache`).
  - **Upstream Protection**: Upstream cooldown after a 429 (fails fast with 503 + Retry-After instead of hammering; cache serves stale). Global concurrency limiter (maximum 3 parallel requests).
  - **Degraded Mode**: Degraded coin payload from the universe (`X-Cache: fallback`, `partial: true`) so coin pages still render during throttling; `/api/search` likewise falls back to a name/symbol search over the universe. Throttled API responses carry `Retry-After`, and the browser client waits once (≤20 s) and retries before showing an error.
  - **API Rate Limiting**: Per-IP API rate limit (`API_RATE_LIMIT`, 429 + Retry-After, `X-RateLimit-Remaining`).
  - **Warm cache**: the detail payloads of the top `WARM_COINS` coins are refreshed every 10 minutes (sequentially, skipped while the upstream is in cooldown), so popular coin pages are served from cache and survive throttling with full data.
  - **Optimization**: Brotli/gzip compression, weak ETags + 304, dynamic `/sitemap.xml` (`PUBLIC_URL`), `robots.txt`, web manifest, and `/healthz` (version, uptime, memory, cache counters + hit ratio, upstream counters and cooldown, live feed state).
- **The Universe**: To minimize upstream queries, the server maintains an in-memory "universe" of the top 500 coins refreshed every 60 seconds (`universe.js`). Most `/api/markets` (default order) and `/api/simple-price` requests are fulfilled directly from this cache with server-side fiat/crypto currency conversion without hitting upstream.
- **Real-Time Price Stream (`/api/stream`)**: A single Binance combined WebSocket connection (`miniTicker` streams for ~60 top assets) feeds an SSE broadcaster (`live.js`). The connection connects lazily on the first client subscription and disconnects 60 seconds after the last subscriber leaves; price updates are throttled to at most once per second.
- **Upstream Limits**: The public CoinGecko API allows ~10–30 req/min without an API key. Supplying a free Demo key via `COINGECKO_API_KEY` increases limits to ~30 req/min (10k requests/month).

## Quick Start

### Local Installation (Node.js >= 22)

No build step or dependency installation is required (`package.json` has zero npm dependencies):

```bash
npm start
```

Then visit [http://localhost:8080](http://localhost:8080). For local development with file watching, run `npm run dev`.

### Docker

```bash
docker compose up -d --build
```

### Environment Variables

Configuration options can be placed in a `.env` file (see `.env.example`). `docker-compose.yml` automatically passes `COINGECKO_API_KEY` from your environment.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port for the HTTP server |
| `HOST` | `0.0.0.0` | Host interface to bind to |
| `COINGECKO_API_KEY` | *(none)* | Optional CoinGecko Demo API key (`x-cg-demo-api-key` header) |
| `UPSTREAM_COINGECKO` | `https://api.coingecko.com/api/v3` | Upstream CoinGecko API base URL |
| `UPSTREAM_FNG` | `https://api.alternative.me/fng/` | Upstream Fear & Greed index API base URL |
| `LOG_LEVEL` | `info` | Server logging level (`info`, `debug`, `silent`) |
| `API_RATE_LIMIT` | `120` | Per-IP limit for `/api` requests per minute |
| `WARM_COINS` | `10` | How many top coins' detail payloads to keep pre-fetched (0 disables) |
| `ENABLE_HSTS` | unset | Set to `1` when serving over HTTPS to send `Strict-Transport-Security` |
| `CACHE_FILE` | `.cache/cache.json` | On-disk cache snapshot file path (empty disables) |
| `PUBLIC_URL` | `http://localhost:8080` | Base URL used in `/sitemap.xml` |

## API

A public, self-documenting copy of this table with a "try it" console and an SSE demo is served at `/api-docs`.

### REST Endpoints

All endpoints serve JSON and return `X-Cache` (`hit`, `miss`, `stale`, `universe`, or `fallback`), `Cache-Control` and a weak `ETag` (send `If-None-Match` to get a `304`). Error `503` is returned when upstream is in cooldown.

| Route | Parameters | Cache TTL | Description |
|---|---|---|---|
| `GET /api/global` | — | 120s | Global market stats (market cap, volume, BTC/ETH dominance) |
| `GET /api/fng` | — | 600s | Fear & Greed Index current value and 30-day historical points |
| `GET /api/trending` | — | 300s | Trending coins from CoinGecko search |
| `GET /api/markets` | `vs`, `page`, `per_page`, `ids`, `category`, `order` | 60s | Market coin list with sparklines; served from universe when applicable |
| `GET /api/coin/:id` | `:id` | 120s | Coin metadata, market stats, ATH/ATL, description, and links |
| `GET /api/coin/:id/chart` | `vs`, `days` (1, 7, 30, 90, 365, max) | 120s (1d) / 900s | Historical price, market cap, and volume series |
| `GET /api/coin/:id/ohlc` | `vs`, `days` (1, 7, 14, 30, 90, 180, 365) | 300s | OHLC candlestick data |
| `GET /api/coin/:id/tickers` | `page` | 300s | Exchange trading pairs, volumes, trust scores, and trade URLs |
| `GET /api/search` | `q` | 600s | Multi-category search (coins, categories, exchanges); coins are enriched with `price_usd`, `change24h`, `market_cap_usd` from the universe |
| `GET /api/categories` | — | 600s | Cryptocurrency category market caps and 24h performance |
| `GET /api/exchanges` | `page`, `per_page` | 600s | Exchange list with trust scores and 24h trading volume |
| `GET /api/exchange/:id` | — | 600s | Exchange profile (trust, volume, links, description) and top 100 tickers |
| `GET /api/exchange/:id/volume` | `days` (7/14/30/90) | 900s | Daily/hourly BTC volume series for the exchange |
| `GET /api/coin/:id/similar` | `vs` | universe | Coins ranked next to the coin by market cap (served from the universe, no upstream call) |
| `GET /api/simple-price` | `ids`, `vs` | 60s | Simple prices and 24h change (served from universe if cached) |
| `GET /api/currencies` | — | 3600s (static) | Supported display currencies (18: fiat + BTC/ETH) |
| `GET /healthz` | — | — | Health JSON: version, uptime, memory, cache counters, upstream counters/cooldown, live feed state (rendered by `/status`) |

### Live Price Stream (`/api/stream`)

Server-Sent Events endpoint streaming real-time price updates:

- `event: hello` — Sent upon connecting, lists all monitored coin identifiers:
  ```json
  {"symbols": ["bitcoin", "ethereum", "solana", "..."]}
  ```
- `event: tick` — Throttled tick updates broadcast at most once per second (`p`: price USD, `c`: 24h change %):
  ```json
  {"ts": 1710000000000, "prices": {"bitcoin": {"p": 76318.9, "c": 0.46}}}
  ```
- `: ping` — Comment ping sent every 25 seconds to keep SSE connections alive.

## Testing

Run `npm test` (native `node:test`, no dependencies). It first runs `npm run check` — a static pass over every
JS/HTML file (syntax via `node --check`, inline event handlers that the CSP would block, escaped template
literals, and i18n keys: RU/EN parity plus every `t('…')` / `data-i18n` key must exist) — then the unit tests:
- `TtlCache`: hit/miss, coalescing of concurrent fetchers, stale-while-revalidate, stale-on-error
- Universe: `convertRow` currency conversion, `marketsFromUniverse` paging / ids lookups, `similarFromUniverse`, `searchUniverse`
- Per-IP rate limiter windows
- Response compression (gzip when accepted, passthrough for small bodies)
- Server-side coin page SEO decoration (`decorateCoinPage`)
- API routes with a stubbed `fetch`: `/api/currencies`, parameter validation (400), Fear & Greed mapping, `/api/coin/:id/similar`, `/api/exchange/:id` (+ volume), `/api/search` universe fallback under 429
- HTTP integration tests (`test/app.test.js`): static routing, clean URLs, 404, coin page SEO tags, `/healthz`, API ETag/304, universe-served markets, validation errors, sitemap, per-IP rate limit, 405, static caching, path traversal

## Project Layout

```
Cryptolive/
├── docs/
│   └── ARCHITECTURE.md     # Architecture specifications and technical spec
├── public/                 # Static frontend assets (no build step)
│   ├── index.html          # Markets overview (home)
│   ├── overview.html       # Market overview dashboard (/overview)
│   ├── trending.html       # Trending coins / categories / NFTs (/trending)
│   ├── status.html         # Service status (/status)
│   ├── api-docs.html       # Public API reference with try-it console (/api-docs)
│   ├── settings.html       # Settings & data backup (/settings)
│   ├── coin.html           # Coin detail & interactive charts (/coin/:id)
│   ├── compare.html        # Side-by-side coin comparison (/compare)
│   ├── alerts.html         # Price alerts manager (/alerts)
│   ├── watchlist.html      # Watchlist (/watchlist)
│   ├── portfolio.html      # Portfolio tracker (/portfolio)
│   ├── converter.html      # Crypto & fiat converter (/converter)
│   ├── heatmap.html        # Treemap market heatmap (/heatmap)
│   ├── gainers-losers.html # Top gainers and losers (/gainers-losers)
│   ├── categories.html     # Crypto categories (/categories)
│   ├── exchanges.html      # Exchanges list (/exchanges)
│   ├── exchange.html       # Exchange detail (/exchange/:id)
│   ├── 404.html            # 404 error page
│   ├── css/style.css       # Unified CSS design system
│   ├── sw.js               # Service worker (app-shell cache, same-origin only)
│   └── js/                 # Vanilla ES modules (api, store, format, live, layout, alerts, i18n + i18n/{en,ru}.js, pages/)
├── server/                 # Node.js backend (Node >= 22)
│   ├── server.js           # Process entrypoint, cache persistence, warmups, shutdown
│   ├── app.js              # request handler factory (createApp) — used by server.js and the integration tests
│   ├── cache.js            # In-memory TTL cache with coalescing & stale fallback
│   ├── routes.js           # API route table and query parameter validation
│   ├── universe.js         # Top 500 universe cache & currency conversions
│   ├── live.js             # Binance WebSocket client and SSE broadcaster
│   ├── upstream.js         # Upstream fetcher with cooldown and backoff
│   ├── ratelimit.js        # Per-IP rate limiter
│   └── compress.js         # Brotli/gzip compression
├── test/                   # node:test test suite
├── Dockerfile              # Production Alpine container
├── docker-compose.yml      # Docker Compose service definition
└── package.json            # Project scripts and engines (zero dependencies)
```

## Credits & Disclaimer

- Market data provided by [CoinGecko](https://www.coingecko.com/).
- Fear & Greed Index provided by [Alternative.me](https://alternative.me/crypto/fear-and-greed-index/).
- Live tick stream relayed from [Binance](https://www.binance.com/) WebSocket feeds.
- **Disclaimer**: Cryptolive is for informational purposes only. Nothing herein constitutes financial, investment, legal, or tax advice.
- **License**: Released under the MIT License.
