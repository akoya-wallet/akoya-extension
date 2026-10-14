// Indexer responses are untrusted input: malformed or hostile data must be rejected, not rendered or used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Blockbook, BlockbookError, parseTokenPath } from '../src/core/blockbook.ts';

const fake = (body: unknown, status = 200) =>
  new Blockbook('https://indexer.example', async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

const TXID = 'ab'.repeat(32);

test('rejects non-https indexers', () => {
  assert.throws(() => new Blockbook('http://indexer.example'), BlockbookError);
});

test('utxo: accepts well-formed, rejects bad txid / amount / types', async () => {
  const ok = await fake([{ txid: TXID, vout: 1, value: '1000', confirmations: 3, path: "m/86'/808276'/0'/0/1" }]).utxos('tr(x)');
  assert.equal(ok[0].value, '1000');
  await assert.rejects(fake([{ txid: 'zz', vout: 1, value: '1', confirmations: 1 }]).utxos('x'), BlockbookError);
  await assert.rejects(fake([{ txid: TXID, vout: 1, value: '-5', confirmations: 1 }]).utxos('x'), BlockbookError);
  await assert.rejects(fake([{ txid: TXID, vout: 1, value: '1e9', confirmations: 1 }]).utxos('x'), BlockbookError);
  await assert.rejects(fake([{ txid: TXID, vout: '1', value: '1', confirmations: 1 }]).utxos('x'), BlockbookError);
  await assert.rejects(fake({ not: 'an array' }).utxos('x'), BlockbookError);
});

test('xpub: bounds token/tx lists and string lengths', async () => {
  const base = { balance: '0', unconfirmedBalance: '-10', txs: 0, tokens: [], transactions: [] };
  const r = await fake(base).xpub('x', {});
  assert.equal(r.unconfirmedBalance, '-10');
  await assert.rejects(fake({ ...base, tokens: [{ name: 'x'.repeat(500), path: 'm/0', transfers: 1 }] }).xpub('x', {}), BlockbookError);
  await assert.rejects(fake({ ...base, transactions: new Array(1001).fill({}) }).xpub('x', {}), BlockbookError);
  await assert.rejects(fake({ ...base, balance: 12 }).xpub('x', {}), BlockbookError);
});

test('surfaces indexer error messages, truncated', async () => {
  await assert.rejects(fake({ error: 'x'.repeat(5000) }, 400).broadcast('00'), (e: BlockbookError) => e.code === 'indexer.rejected' && String(e.params.detail).length <= 300);
  await assert.rejects(fake('<html>oops</html>', 502).status(), (e: BlockbookError) => e.code === 'indexer.non_json' && e.params.status === 502);
});

test('broadcast must return a txid', async () => {
  assert.equal(await fake({ result: TXID }).broadcast('00ff'), TXID);
  await assert.rejects(fake({ result: '<script>' }).broadcast('00ff'), BlockbookError);
  await assert.rejects(fake({ result: TXID }).broadcast('not hex'), BlockbookError);
});

test('estimateFee parses PRL/kB into grain/vB and ignores junk', async () => {
  assert.equal(await fake({ result: '0.00002016' }).estimateFee(6), 2.016);
  assert.equal(await fake({ result: '-1' }).estimateFee(6), null);
  assert.equal(await fake({ result: 'NaN' }).estimateFee(6), null);
});

test('token paths are only accepted under our account prefix', () => {
  const pre = "m/86'/808276'/0'";
  assert.deepEqual(parseTokenPath(`${pre}/1/7`, pre), { branch: 1, index: 7 });
  assert.equal(parseTokenPath("m/86'/1'/0'/0/1", pre), null);
  assert.equal(parseTokenPath(`${pre}/0/1/2`, pre), null);
  assert.equal(parseTokenPath(`${pre}/0/99999999`, pre), null);
  assert.equal(parseTokenPath(undefined, pre), null);
});
