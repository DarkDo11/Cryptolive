import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestCounters, renderMetrics } from '../server/metrics.js';

test('renders Prometheus metrics with metadata and sample values', () => {
  const output = renderMetrics({
    cacheStats: { entries: 7, inFlight: 2, hit: 11, stale: 3, miss: 5, error: 1 },
    upstream: { requests: 20, ok: 17, rateLimited: 2, errors: 1, throttled: true, throttledForMs: 2500 },
    live: { connected: true, subscribers: 4, pricesKnown: 60, reconnects: 3 },
    memory: { rss: 1000, heapUsed: 500 },
    uptimeSeconds: 42,
    requestCounters: { byClass: { '2xx': 8, '3xx': 1, '4xx': 2, '5xx': 1 }, durationSum: 75, durationCount: 12 }
  });

  assert.match(output, /# HELP cryptolive_uptime_seconds /);
  assert.match(output, /# TYPE cryptolive_uptime_seconds gauge/);
  assert.match(output, /cryptolive_uptime_seconds 42/);
  assert.match(output, /# TYPE cryptolive_cache_lookups_total counter/);
  assert.match(output, /cryptolive_cache_lookups_total\{result="stale"\} 3/);
  assert.match(output, /cryptolive_upstream_cooldown_seconds 2.5/);
  assert.match(output, /cryptolive_live_connected 1/);
  assert.match(output, /cryptolive_http_requests_total\{status="4xx"\} 2/);
  assert.match(output, /cryptolive_http_request_duration_ms_sum 75/);
  assert.ok(output.endsWith('\n'));
});

test('renders missing and non-finite values as zero', () => {
  const output = renderMetrics({
    cacheStats: null,
    upstream: { requests: NaN },
    live: undefined,
    memory: { rss: NaN },
    uptimeSeconds: NaN,
    requestCounters: null
  });

  assert.doesNotMatch(output, /NaN/);
  assert.match(output, /cryptolive_uptime_seconds 0/);
  assert.match(output, /cryptolive_process_resident_memory_bytes 0/);
  assert.match(output, /cryptolive_cache_entries 0/);
  assert.match(output, /cryptolive_upstream_requests_total 0/);
  assert.match(output, /cryptolive_live_subscribers 0/);
  assert.match(output, /cryptolive_http_requests_total\{status="5xx"\} 0/);
});

test('request counters classify statuses and sum durations', () => {
  const counters = createRequestCounters();
  counters.record(200, 1.5);
  counters.record(304, 2.5);
  counters.record(404, 3);
  counters.record(503, 4);

  assert.deepEqual(counters.snapshot(), {
    byClass: { '2xx': 1, '3xx': 1, '4xx': 1, '5xx': 1 },
    durationSum: 11,
    durationCount: 4
  });
});
