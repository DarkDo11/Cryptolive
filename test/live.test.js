import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLive } from '../server/live.js';

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    chunks: [],
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(chunk);
    }
  };
}

function installFakeWebSocket() {
  const instances = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.closeCalls = 0;
      instances.push(this);
    }

    close() {
      this.closeCalls++;
      this.onclose?.({});
    }
  }
  globalThis.WebSocket = FakeWebSocket;
  return instances;
}

function eventData(chunks, event) {
  const frame = chunks.find(chunk => chunk.startsWith(`event: ${event}\n`));
  assert.ok(frame, `expected ${event} frame`);
  return JSON.parse(frame.match(/data: (.+)\n/)[1]);
}

const originalWebSocket = globalThis.WebSocket;

test('broadcasts live ticks, snapshots state, and disconnects when idle', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = installFakeWebSocket();
  try {
    const live = createLive();
    const first = fakeResponse();
    live.subscribe(first);

    assert.strictEqual(first.statusCode, 200);
    const hello = eventData(first.chunks, 'hello');
    assert.ok(hello.symbols.includes('bitcoin'));
    assert.ok(hello.symbols.includes('ethereum'));
    assert.strictEqual(sockets.length, 1);

    sockets[0].onopen();
    const second = fakeResponse();
    live.subscribe(second);
    sockets[0].onmessage({
      data: JSON.stringify({ data: { s: 'BTCUSDT', c: '100', o: '90' } })
    });
    mock.timers.tick(1000);

    const tick = eventData(first.chunks, 'tick');
    assert.strictEqual(tick.prices.bitcoin.p, 100);
    assert.ok(Math.abs(tick.prices.bitcoin.c - 11.11111111111111) < 1e-10);
    assert.deepStrictEqual(eventData(second.chunks, 'tick').prices.bitcoin, tick.prices.bitcoin);

    const late = fakeResponse();
    live.subscribe(late);
    const snapshot = eventData(late.chunks, 'tick');
    assert.deepStrictEqual(snapshot.prices.bitcoin, tick.prices.bitcoin);

    const status = live.status();
    assert.strictEqual(status.connected, true);
    assert.strictEqual(status.subscribers, 3);
    assert.strictEqual(status.pricesKnown, 1);
    assert.strictEqual(typeof status.lastMessageAt, 'number');

    live.unsubscribe(first);
    live.unsubscribe(second);
    live.unsubscribe(late);
    mock.timers.tick(60000);
    assert.strictEqual(sockets[0].closeCalls, 1);
    assert.strictEqual(live.status().connected, false);
    assert.strictEqual(live.status().subscribers, 0);
  } finally {
    mock.timers.reset();
    globalThis.WebSocket = originalWebSocket;
  }
});

test('reconnects after a close while subscribed', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = installFakeWebSocket();
  try {
    const live = createLive();
    const res = fakeResponse();
    live.subscribe(res);
    sockets[0].onopen();
    sockets[0].onclose();

    assert.strictEqual(live.status().connected, false);
    assert.strictEqual(live.status().reconnects, 1);
    mock.timers.tick(999);
    assert.strictEqual(sockets.length, 1);
    mock.timers.tick(1);
    assert.strictEqual(sockets.length, 2);
  } finally {
    mock.timers.reset();
    globalThis.WebSocket = originalWebSocket;
  }
});

test('does not reconnect after a close with no subscribers', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const sockets = installFakeWebSocket();
  try {
    const live = createLive();
    const res = fakeResponse();
    live.subscribe(res);
    sockets[0].onopen();
    live.unsubscribe(res);
    sockets[0].onclose();

    mock.timers.tick(60000);
    assert.strictEqual(sockets.length, 1);
    assert.strictEqual(live.status().reconnects, 0);
    assert.strictEqual(live.status().connected, false);
  } finally {
    mock.timers.reset();
    globalThis.WebSocket = originalWebSocket;
  }
});
