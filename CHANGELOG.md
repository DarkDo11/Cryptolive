# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] — 2026-09-18

### Added

- Exchange detail pages (`/exchange/:id`) with volume chart and sortable pairs.
- Public `/status` page with real-time health counters, cache hit ratios, and WebSocket connection status.
- Interactive `/api-docs` page with complete endpoint reference, "try-it" console, and live SSE stream demo in English and Russian.
- Most viewed on Cryptolive (`/api/popular`): per-instance decayed view count tracking, trending tab, and overview dashboard link.
- Gainers & Losers leaderboards: dedicated volume and volatility ranking boards alongside 1h, 24h, and 7d top movers.
- Heatmap sectors mode displaying category market caps in a squarified treemap layout.
- Category statistics strip (total market cap, 24h volume, and market dominance share) on category detail views.
- Coin detail page additions: sticky section navigation with scrollspy, 'Your position' card, and Add to Portfolio / Compare actions with `?add=` deep linking.
- Market pair filtering on coin pages by exchange or trading pair, with exchange logos in tickers and category chips linking to category views.
- Recently viewed coins carousel strip on the Markets overview page.
- 24-hour percent-change alerts (rise/drop percentage thresholds) alongside price threshold alerts, with repeating alert support.
- Keyboard navigation: shortcut keys (`?` help sheet modal, `g+key` quick navigation, `t` theme toggle) with global `[hidden]` support.
- Accessibility enhancements: skip-to-content navigation link, labelled header select elements, and `aria-live` polite status toasts.
- Languages: Spanish and German complete interface localizations with service worker dictionary precaching.
- Tabular API CSV export: `?format=csv` parameter supported on `/api/markets`, `/api/ohlc`, `/api/chart`, `/api/exchanges`, and `/api/categories`.
- SEO and indexing: server-side meta tags (Open Graph, Twitter cards) for coin and exchange pages, plus comprehensive XML sitemap.

### Changed

- Portfolio: transaction editing, realized P&L, CSV import/export, privacy mode, value history chart.
- Exchanges directory: client-side search, multi-column sorting, and CEX/DEX filtering across 250+ exchanges.
- Currency support expanded to 18 display currencies (added CAD, AUD, CHF, KRW, INR, BRL, TRY, UAH, PLN, KZT) with zero-decimal formatting for JPY and KRW.
- Markets table: expandable 7-day sparkline charts, multi-coin compare selection, and CSV export.
- Watchlist: shareable links (copy URL, merge shared IDs on open) and persisted table sort order.
- Overview page: added trending coins card, top exchanges summary cards, and quick link to popular coins.
- Currency converter: all-currencies comparison table and shareable link state (`?from=&to=&amount=`).
- Settings page: configurable table density (compact/comfortable), customizable default start page, and language selection dropdown.
- Coin price charts: overlaid volume histogram and fallback sparkline rendering.
- Search palette: universe price and 24h change indicators displayed on results, with direct navigation to exchange detail pages.
- HTTP caching: conditional request handling with weak ETags and 304 Not Modified responses.
- Offline support: service worker serves last-cached API data (`cryptolive-api-v1`), offline route shells, and offline status banner.

### Fixed

- Two review rounds: upstream timeout covering body, trusted-proxy IP resolution, HEAD /api validation, SSE client cap, strict pagination, WebSocket reconnect cancellation on idle, moving-average cost basis, 24h % of previous value, prototype-safe accumulators, cancellation request tokens in search/compare/categories, watchlist fetching all watched coins with >100 ID chunking, import/backup validation, heatmap price double conversion fix, converter BTC/ETH support and currency switching, missing i18n strings, clipboard and URI protocol guards, offline route shells, simplePrice chunking, bulk portfolio writes, ledger-validated sells, rolling 7-day view counts, non-blocking view hits, SSE backpressure handling, Accept-Encoding q-values parsing, upstream error counting, watchlist currency refresh, fx NaN handling, USD liquidity thresholds, range percentage calculation, viewed-tab fx conversion, and scoped modal resets.
- Fixed coin page Markets table crash caused by ticker parameter shadowing the `t` i18n function, with static check detection.
- Resolved alert rules rendering crash when handling malformed alert configurations in localStorage.
- Corrected search fallback payload shape to prevent route re-transformation from corrupting fallback responses.
- Fixed theme toggle first-click responsiveness.
- Addressed trailing zero trimming on formatted numeric and currency displays.
- Persisted fx ratios across visits in localStorage and bounded the client API cache.
- Fixed portfolio transactions table crash when handling empty or incomplete rows.
- Enabled logging for swallowed load errors to ensure visibility during client audits.

### Security

- Content Security Policy (CSP) hardening with `frame-ancestors 'none'`, `base-uri 'self'`, and `form-action 'self'`.
- Standard HTTP security headers: `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` (COOP), and optional HSTS (`Strict-Transport-Security`).
- Input sanitization and prototype pollution protection: prototype-safe object accumulators, strict integer parameter validation, and clipboard/URI protocol guards.

### Ops

- Prometheus `/metrics` endpoint with optional bearer token authentication (`METRICS_TOKEN`).
- Request tracing and structured logging: `X-Request-Id` correlation header on all responses and structured JSON access logs (`LOG_FORMAT=json`).
- Cache and performance optimizations: configurable warm cache for top coins (`WARM_COINS`) and static compression cache (`createCompressionCache`) for pre-compressed assets.
- Upstream resilience and graceful degradation: in-memory universe fallback during CoinGecko rate limiting, client automatic retry on cooldown (`Retry-After`), and upstream error tracking.
- Testable server refactoring: extracted `createApp()` factory in `server/app.js` enabling decoupled HTTP integration tests on ephemeral ports.
- Automated testing and validation: static check script (`scripts/check.mjs`) in `npm test` verifying syntax, CSP handlers, template escaping, i18n parity, and `t`-shadowing, plus client-side unit tests and SSE live feed tests.

## [2.0.0] — 2026-09-17

- Initial server: in-memory TTL caching proxy (request coalescing, stale-while-revalidate, stale-on-error), CoinGecko rate limiting and capped backoff, universe (top-500 coins refreshed every 60s), live SSE price stream relayed from Binance WebSocket, and resilience against upstream outages.
- Multi-page application rebuild across clean URLs: Markets, Coin detail, Watchlist, Portfolio, Converter, Heatmap, Gainers & Losers, Categories, Exchanges, Overview, Trending, Compare, Alerts, Settings, and 404.
- Internationalization (i18n): English and Russian (EN/RU) dictionary-based translation system with header language switcher.
- Progressive Web App (PWA): web app manifest and service worker caching for offline shell availability.
- Containerization: Dockerfile (node:22-alpine) and Docker Compose configuration.
- Automated tests: test suite covering server routing, cache behavior, and data transformations.

## [1.0.0]

- Initial single-page dashboard.

## Versioning

The version in `package.json` is bumped with each tagged release.
