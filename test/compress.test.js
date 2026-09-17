import test from 'node:test';
import assert from 'node:assert';
import zlib from 'node:zlib';
import { send } from '../server/compress.js';

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
