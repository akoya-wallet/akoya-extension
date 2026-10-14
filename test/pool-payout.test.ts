// Pool payouts (incoming payments funded by coinbase outputs) are labelled as mining income,
// and the paying address is remembered so later payouts need no lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../src/ext/wallet.ts';
import { localStore } from '../src/ext/platform.ts';
import { AddressBook } from '../src/core/account.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { ABANDON } from './vectors.ts';

const POOL = 'prl1p50ltku2jjcwdxh4nzjrw98nwdswdn25qdkr2fdtw8hsq3qu9cdhscchnnm';
const OTHER = 'prl1p65h6kqgvvwh0eae8tr23dcjhuc2sqqt7zm579dp6zfmj4sfhtrysm3mpad';
const h = (c: string) => c.repeat(64);
const now = Math.floor(Date.now() / 1000);

test('pool payouts are tagged, summed for today, and the pool is remembered', async () => {
  const s = await W.createWallet({ secret: ABANDON, passphrase: '', network: 'mainnet', mode: 'oyster', name: 'Rig', password: 'test-password-1' });
  assert.equal(s.network, 'mainnet');
  const [entry] = (await localStore.get('vault.v1')) as { xpub: string }[];
  const me = new AddressBook(entry.xpub, NETWORKS.mainnet).get(0, 0).address;
  let txLookups = 0;
  const tx = (id: string, from: string, prev: string | undefined, value: string, time: number) => ({
    txid: id,
    vin: [{ n: 0, txid: prev, vout: 0, addresses: [from], isAddress: true, value: '9000000000' }],
    vout: [{ n: 0, value, addresses: [me], isAddress: true, isOwn: true }, { n: 1, value: '1', addresses: [OTHER], isAddress: true }],
    blockHeight: 100, confirmations: 6, blockTime: time, value, valueIn: '9000000000', fees: '1000',
  });
  const history = [
    tx(h('a'), POOL, h('c'), '2841342563', now - 60), // funded by a coinbase tx → payout
    tx(h('b'), OTHER, h('d'), '100000000', now - 120), // funded by a regular tx → plain receive
  ];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    let body: unknown = { error: 'unexpected' };
    if (u.endsWith('/api/v2')) body = { blockbook: { coin: 'Pearl', bestHeight: 200, inSync: true }, backend: { chain: 'mainnet' } };
    else if (u.includes('/api/v2/xpub/')) body = { balance: '0', unconfirmedBalance: '0', txs: 2, page: 1, totalPages: 1, tokens: [], transactions: history };
    else if (u.includes('/api/v2/utxo/')) body = [];
    else if (u.includes(`/api/v2/tx/${h('c')}`)) { txLookups++; body = { txid: h('c'), vin: [{ n: 0, isAddress: false }], vout: [], blockHeight: 90, confirmations: 110, blockTime: now - 9999, fees: '0' }; }
    else if (u.includes(`/api/v2/tx/${h('d')}`)) { txLookups++; body = { txid: h('d'), vin: [{ n: 0, txid: h('e'), vout: 0, addresses: [OTHER], isAddress: true, value: '5' }], vout: [], blockHeight: 90, confirmations: 110, blockTime: now - 9999, fees: '0' }; }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  const ov = await W.overview();
  assert.equal(ov.history[0].poolPayout, true);
  assert.equal(ov.history[0].counterparty, POOL);
  assert.equal(ov.history[1].poolPayout, false);
  assert.equal(ov.minedToday, '2841342563');
  assert.deepEqual(await localStore.get('miningSenders.v1'), [POOL]);

  // second load: the pool is remembered and lookups are cached — no further queries
  const before = txLookups;
  const again = await W.overview();
  assert.equal(again.history[0].poolPayout, true);
  assert.equal(again.history[1].poolPayout, false);
  assert.equal(txLookups - before, 0);
});
