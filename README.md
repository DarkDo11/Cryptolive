# Cryptolive

Cryptolive is a self-hosted, zero-dependency cryptocurrency market data service built with Node.js 22 and vanilla ES modules in the spirit of CoinGecko and CoinMarketCap. It delivers a comprehensive markets overview, detailed coin pages with charts, watchlist and portfolio trackers, currency converter, market heatmap, top gainers and losers rankings, categories, and exchange directories. Real-time prices are streamed via a Binance WebSocket connection relayed to browsers through Server-Sent Events (SSE), while upstream CoinGecko data is proxied with an in-memory TTL cache and request coalescing.

## Features

- **Overview**: Market Overview dashboard featuring a Fear & Greed gauge + 30-day history, market dominance doughnut, top sectors bar chart, market breadth, and a watchlist snapshot.
- **Markets**: Global stats bar (total market cap, 24h volume, BTC/ETH dominance, Fear & Greed Index), trending and top gainers/losers highlight cards, sortable top-N coin table with 7-day sparklines, quick filter tabs (All, Watchlist, Gainers, Losers), per-page selector (50/100/250), and live price update flashes.
- **Coin Detail**: Interactive line and candlestick charts with timeframe ranges (24h to Max) and logarithmic scale toggle, price vs. market cap toggle, key stats (circulating/total/max supply, volume/market cap), ATH/ATL metrics with percentage change and dates, 24h low/high range bar, mini-converter, multi-timeframe price performance, historical data table + CSV export, exchange tickers with trust scores and trade links, coin description, official links, and a "Set alert" button.
- **Compare**: Up to 4 coins side-by-side comparison with a normalized performance chart.
- **Alerts**: Price alerts (above/below rules checked against the live stream + 60 s polling fallback) triggering toasts and browser Notifications; triggered alerts can be re-armed; stored in `localStorage`.
- **Watchlist**: Track favorite coins locally via `localStorage` with JSON import and export capability.
- **Portfolio**: Transaction-based portfolio tracker with buy/sell logging, holdings balances, average buy price, profit & loss (P&L) tracking, asset allocation doughnut chart, and JSON import/export.
- **Converter**: Real-time crypto↔crypto, crypto↔fiat, and fiat↔fiat conversions with URL state synchronization (`?from=&to=&amount=`) and quick-pick popular conversions.
- **Heatmap**: Squarified treemap visualization sized by Market Cap or 24h Volume, color-coded by 1h, 24h, or 7d price change percentage with responsive resizing.
- **Gainers & Losers**: Highlights top 20 gainers and top 20 losers across 1h, 24h, and 7d horizons (minimum $50k volume filter).
- **Categories**: Market sectors table sorted by market cap with 24h changes and top 3 coins preview; drill down to explore category-specific coin markets.
- **Exchanges**: Directory of top cryptocurrency exchanges with trust scores, country of origin, 24h BTC volume, and direct links.
- **Global Search & UI**: Command palette (`⌘K` or `/`) searching coins, categories, and exchanges; 8 display currencies (USD, EUR, GBP, RUB, JPY, CNY, BTC, ETH); dark and light themes; responsive mobile-friendly design.

## Architecture

- **Frontend (`public/`)**: Static multi-page application with clean URLs, vanilla HTML5/CSS, and native browser ES modules—no build steps or bundlers required.
- **Server (`server/`)**: Lightweight Node.js HTTP server utilizing native modules (`node:http`, `node:fs/promises`, global `fetch`, and global `WebSocket`).
- **Server Resilience & Caching**: 
  - **Caching & Flow**: In-memory stale-while-revalidate cache with request coalescing. On-disk cache snapshot (`CACHE_FILE`, written every 30 s and on shutdown, restored on start; Docker volume `cryptolive-cache`).
  - **Upstream Protection**: Upstream cooldown after a 429 (fails fast with 503 + Retry-After instead of hammering; cache serves stale). Global concurrency limiter (maximum 3 parallel requests).
  - **Degraded Mode**: Degraded coin payload from the universe (`X-Cache: fallback`, `partial: true`) so coin pages still render during throttling.
  - **API Rate Limiting**: Per-IP API rate limit (`API_RATE_LIMIT`, 429 + Retry-After, `X-RateLimit-Remaining`).
  - **Optimization**: Brotli/gzip compression, weak ETags + 304, dynamic `/sitemap.xml` (`PUBLIC_URL`), `robots.txt`, web manifest, and `/healthz` (includes `upstream: {throttled, throttledForMs}`).
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
| `CACHE_FILE` | `.cache/cache.json` | On-disk cache snapshot file path (empty disables) |
| `PUBLIC_URL` | `http://localhost:8080` | Base URL used in `/sitemap.xml` |

## API

### REST Endpoints

All endpoints serve JSON and return `X-Cache` (`hit`, `miss`, `stale`, `universe`, or `fallback`) along with `Cache-Control` headers. Error `503` is returned when upstream is in cooldown.

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
| `GET /api/search` | `q` | 600s | Multi-category search (coins, categories, exchanges) |
| `GET /api/categories` | — | 600s | Cryptocurrency category market caps and 24h performance |
| `GET /api/exchanges` | `page`, `per_page` | 600s | Exchange list with trust scores and 24h trading volume |
| `GET /api/simple-price` | `ids`, `vs` | 60s | Simple prices and 24h change (served from universe if cached) |
| `GET /api/currencies` | — | 3600s (static) | Supported display currencies (USD, EUR, GBP, RUB, JPY, CNY, BTC, ETH) |
| `GET /healthz` | — | — | Health check with server uptime, cache stats, and live stream status |

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

Run tests with `npm test` (uses native `node:test`, no dependencies). Tests cover:
- `TtlCache`: hit/miss, coalescing of concurrent fetchers, stale-while-revalidate, stale-on-error
- Universe: `convertRow` currency conversion and `marketsFromUniverse` paging / ids lookups
- Per-IP rate limiter windows
- Response compression (gzip when accepted, passthrough for small bodies)
- API routes with a stubbed `fetch`: `/api/currencies`, parameter validation (400), Fear & Greed mapping

## Project Layout

```
Cryptolive/
├── docs/
│   └── ARCHITECTURE.md     # Architecture specifications and technical spec
├── public/                 # Static frontend assets (no build step)
│   ├── index.html          # Markets overview (home)
│   ├── overview.html       # Market overview dashboard (/overview)
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
│   ├── 404.html            # 404 error page
│   ├── css/style.css       # Unified CSS design system
│   └── js/                 # Vanilla ES modules (api, store, format, live, layout, pages, alerts)
├── server/                 # Node.js backend (Node >= 22)
│   ├── server.js           # HTTP server, clean URLs, static serving, healthz
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
