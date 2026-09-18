import test from 'node:test';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { createCompressionCache, send, weakEtag, etagMatches } from '../server/compress.js';

test('weakEtag: deterministic weak tag based on body', () => {
  const etag = weakEtag('hello');

  assert.strictEqual(weakEtag('hello'), etag);
  assert.notStrictEqual(weakEtag('world'), etag);
  assert.match(etag, /^W\/"\d+-[0-9a-f]{16}"$/);
  assert.strictEqual(weakEtag(Buffer.from('hello')), etag);
});

test('etagMatches: matches weak and strong tags and lists', () => {
  assert.strictEqual(etagMatches('W/"abc"', 'W/"abc"'), true);
  assert.strictEqual(etagMatches('"abc"', 'W/"abc"'), true);
  assert.strictEqual(etagMatches('W/"abc"', '"abc"'), true);
  assert.strictEqual(etagMatches('"x", W/"abc"', '"abc"'), true);
  assert.strictEqual(etagMatches('*', 'W/"abc"'), true);
  assert.strictEqual(etagMatches('"x"', 'W/"abc"'), false);
  assert.strictEqual(etagMatches('', 'W/"abc"'), false);
  assert.strictEqual(etagMatches(undefined, 'W/"abc"'), false);
});

test('compress: gzip when accepted and body large', () => {
  let writtenCode, writtenHeaders, writtenBody;
  const res = {
    writeHead(code, headers) {
      writtenCode = code;
      writtenHeaders = headers;
    },
    end(body) {
      writtenBody = body;
    }
  };
  
  const req = { headers: { 'accept-encoding': 'gzip, deflate' }, method: 'GET' };
  const largeBody = 'a'.repeat(1050);
  
  send(req, res, 200, { 'Content-Type': 'application/json' }, largeBody);
  
  assert.strictEqual(writtenCode, 200);
  assert.strictEqual(writtenHeaders['Content-Encoding'], 'gzip');
  assert.ok(writtenHeaders['Vary'].includes('Accept-Encoding'));
  
  const decompressed = zlib.gunzipSync(writtenBody).toString();
  assert.strictEqual(decompressed, largeBody);
});

test('compress: passthrough when small', () => {
  let writtenCode, writtenHeaders, writtenBody;
  const res = {
    writeHead(code, headers) {
      writtenCode = code;
      writtenHeaders = headers;
    },
    end(body) {
      writtenBody = body;
    }
  };
  
  const req = { headers: { 'accept-encoding': 'gzip' }, method: 'GET' };
  const smallBody = 'abc';
  
  send(req, res, 200, { 'Content-Type': 'application/json' }, smallBody);
  
  assert.strictEqual(writtenCode, 200);
  assert.strictEqual(writtenHeaders['Content-Encoding'], undefined);
  assert.strictEqual(writtenBody.toString(), smallBody);
});

test('compress: caches compressed bodies by key and encoding', () => {
  const cache = createCompressionCache();
  const originalGet = cache.get;
  let getCalls = 0;
  cache.get = (...args) => {
    getCalls++;
    return originalGet(...args);
  };
  const body = 'cache me'.repeat(200);

  const compress = (encoding) => {
    let writtenBody;
    const req = { headers: { 'accept-encoding': encoding }, method: 'GET' };
    const res = {
      writeHead() {},
      end(value) {
        writtenBody = value;
      }
    };
    send(req, res, 200, { 'Content-Type': 'text/css' }, body, {
      cacheKey: '/style.css|etag',
      compressionCache: cache
    });
    return writtenBody;
  };

  const firstGzip = compress('gzip');
  const secondGzip = compress('gzip');
  assert.deepStrictEqual(secondGzip, firstGzip);
  assert.strictEqual(getCalls, 2);
  assert.strictEqual(cache.size, 1);

  const brotli = compress('br');
  assert.strictEqual(cache.size, 2);
  assert.strictEqual(zlib.brotliDecompressSync(brotli).toString(), body);
});
