function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function metric(name, help, type, samples) {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${samples.join('\n')}\n`;
}

export function renderMetrics({
  cacheStats,
  upstream,
  live,
  memory,
  uptimeSeconds,
  requestCounters
} = {}) {
  const cacheValues = cacheStats || {};
  const upstreamValues = upstream || {};
  const liveValues = live || {};
  const memoryValues = memory || {};
  const requestValues = requestCounters || {};
  const byClass = requestValues.byClass || {};

  return [
    metric('cryptolive_uptime_seconds', 'Server uptime in seconds.', 'gauge', [
      `cryptolive_uptime_seconds ${number(uptimeSeconds)}`
    ]),
    metric('cryptolive_process_resident_memory_bytes', 'Resident process memory in bytes.', 'gauge', [
      `cryptolive_process_resident_memory_bytes ${number(memoryValues.rss)}`
    ]),
    metric('cryptolive_process_heap_used_bytes', 'Process heap memory in use in bytes.', 'gauge', [
      `cryptolive_process_heap_used_bytes ${number(memoryValues.heapUsed)}`
    ]),
    metric('cryptolive_cache_entries', 'Number of entries in the cache.', 'gauge', [
      `cryptolive_cache_entries ${number(cacheValues.entries)}`
    ]),
    metric('cryptolive_cache_in_flight', 'Number of cache requests currently in flight.', 'gauge', [
      `cryptolive_cache_in_flight ${number(cacheValues.inFlight)}`
    ]),
    metric('cryptolive_cache_lookups_total', 'Cache lookups by result.', 'counter', [
      `cryptolive_cache_lookups_total{result="hit"} ${number(cacheValues.hit)}`,
      `cryptolive_cache_lookups_total{result="stale"} ${number(cacheValues.stale)}`,
      `cryptolive_cache_lookups_total{result="miss"} ${number(cacheValues.miss)}`,
      `cryptolive_cache_lookups_total{result="error"} ${number(cacheValues.error)}`
    ]),
    metric('cryptolive_upstream_requests_total', 'Total upstream requests.', 'counter', [
      `cryptolive_upstream_requests_total ${number(upstreamValues.requests)}`
    ]),
    metric('cryptolive_upstream_ok_total', 'Total successful upstream requests.', 'counter', [
      `cryptolive_upstream_ok_total ${number(upstreamValues.ok)}`
    ]),
    metric('cryptolive_upstream_rate_limited_total', 'Total rate-limited upstream requests.', 'counter', [
      `cryptolive_upstream_rate_limited_total ${number(upstreamValues.rateLimited)}`
    ]),
    metric('cryptolive_upstream_errors_total', 'Total upstream errors.', 'counter', [
      `cryptolive_upstream_errors_total ${number(upstreamValues.errors)}`
    ]),
    metric('cryptolive_upstream_throttled', 'Whether upstream requests are currently throttled.', 'gauge', [
      `cryptolive_upstream_throttled ${upstreamValues.throttled ? 1 : 0}`
    ]),
    metric('cryptolive_upstream_cooldown_seconds', 'Remaining upstream cooldown in seconds.', 'gauge', [
      `cryptolive_upstream_cooldown_seconds ${number(upstreamValues.throttledForMs) / 1000}`
    ]),
    metric('cryptolive_live_connected', 'Whether the live price feed is connected.', 'gauge', [
      `cryptolive_live_connected ${liveValues.connected ? 1 : 0}`
    ]),
    metric('cryptolive_live_subscribers', 'Current live price feed subscribers.', 'gauge', [
      `cryptolive_live_subscribers ${number(liveValues.subscribers)}`
    ]),
    metric('cryptolive_live_prices_known', 'Current live prices known.', 'gauge', [
      `cryptolive_live_prices_known ${number(liveValues.pricesKnown)}`
    ]),
    metric('cryptolive_live_reconnects_total', 'Total live price feed reconnects.', 'counter', [
      `cryptolive_live_reconnects_total ${number(liveValues.reconnects)}`
    ]),
    metric('cryptolive_http_requests_total', 'HTTP requests by response status class.', 'counter', [
      `cryptolive_http_requests_total{status="2xx"} ${number(byClass['2xx'])}`,
      `cryptolive_http_requests_total{status="3xx"} ${number(byClass['3xx'])}`,
      `cryptolive_http_requests_total{status="4xx"} ${number(byClass['4xx'])}`,
      `cryptolive_http_requests_total{status="5xx"} ${number(byClass['5xx'])}`
    ]),
    metric('cryptolive_http_request_duration_ms_sum', 'Sum of HTTP request durations in milliseconds.', 'counter', [
      `cryptolive_http_request_duration_ms_sum ${number(requestValues.durationSum)}`
    ]),
    metric('cryptolive_http_request_duration_ms_count', 'Number of timed HTTP requests.', 'counter', [
      `cryptolive_http_request_duration_ms_count ${number(requestValues.durationCount)}`
    ])
  ].join('');
}

export function createRequestCounters() {
  const byClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  let durationSum = 0;
  let durationCount = 0;

  return {
    record(statusCode, ms) {
      const statusClass = `${Math.floor(number(statusCode) / 100)}xx`;
      if (Object.hasOwn(byClass, statusClass)) byClass[statusClass]++;
      durationSum += number(ms);
      durationCount++;
    },
    snapshot() {
      return { byClass: { ...byClass }, durationSum, durationCount };
    }
  };
}
