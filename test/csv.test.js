import test from 'node:test';
import assert from 'node:assert';
import { toCsv } from '../server/csv.js';

test('toCsv writes RFC 4180 CSV with CRLF rows and escaped values', () => {
  const rows = [
    { name: 'A, B', note: 'said "hello"\nagain', empty: null, data: { ok: true } },
    { name: 'plain', note: 'line\rreturn', empty: undefined, data: [1, 2] }
  ];
  const csv = toCsv(rows, [
    { key: 'name', header: 'name' },
    { key: 'note', header: 'note' },
    { key: 'empty', header: 'empty' },
    { key: row => row.data, header: 'object' }
  ]);

  assert.strictEqual(csv, 'name,note,empty,object\r\n"A, B","said ""hello""\nagain",,"{""ok"":true}"\r\nplain,"line\rreturn",,"[1,2]"');
});

test('toCsv serializes numbers and booleans without a BOM', () => {
  assert.strictEqual(toCsv([{ n: 12.5, yes: true, no: false }], [
    { key: 'n', header: 'number' },
    { key: 'yes', header: 'yes' },
    { key: 'no', header: 'no' }
  ]), 'number,yes,no\r\n12.5,true,false');
});
