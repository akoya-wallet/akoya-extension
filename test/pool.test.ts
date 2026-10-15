// Mining-pool link: parsing the pool's (untrusted) account data, and the per-wallet service flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { WalletError } from '../src/core/errors.ts';
import { epochRange, formatHashrate, parseAccount } from '../src/ext/pool.ts';
import * as W from '../src/ext/wallet.ts';
import { localStore } from '../src/ext/platform.ts';
import { AddressBook, deriveAccount, seedBytes } from '../src/core/account.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { ABANDON } from './vectors.ts';

const isPoolError = (e: unknown) => e instanceof WalletError && e.code === 'pool.invalid_data';
const ADDR = 'prl1p50ltku2jjcwdxh4nzjrw98nwdswdn25qdkr2fdtw8hsq3qu9cdhscchnnm';

// shaped like a real Pearlhash /api/account response (documentation IPs, made-up names)
const gpu = (h: number) => ({ name: 'NVIDIA GeForce RTX 4090 D', hashrate: h });
const SAMPLE = {
  connected_workers: [
    { ip: '192.0.2.10', worker_name: 'rig-a', worker_id: '13722564136804223058', version: 'WildRig_0.51.4', gpu_info: [gpu(3e14), gpu(3e14), gpu(2.1e14)] },
    { ip: '192.0.2.11', worker_name: 'rig-b‮\u0007', worker_id: '13722564136804223059', version: 'WildRig_0.51.4', gpu_info: [gpu(3e14)] },
  ],
  estimated_hashrate_15s: 34.1,
  balance_transactions: [
    { amount: 0.39, reason: 'Epoch 2026-10-11 07:00:00 UTC .. 2026-10-11 08:00:00 UTC credit', timestamp: 1791720000000, coin_type: 'pearl' },
    { amount: -16.87, reason: 'Auto Payment', timestamp: 1791728534712, coin_type: 'pearl' },
    { amount: 5, reason: 'Epoch 2026-10-11 07:00:00 UTC .. 2026-10-11 08:00:00 UTC credit', timestamp: 1791720000001, coin_type: 'nock' },
  ],
  pending_rewards: {
    total_pending_prl: 44.43,
    total_pending_mdl: 0,
    epochs: [{ epoch_label: '2026-10-14 22:00:00 UTC .. 2026-10-14 23:00:00 UTC', amount: 14.16, share: 0.0009, immature_tx: 3, coin_type: 'pearl' }],
  },
  nock_payout_address: 'x',
};

test('pool account: parsed, summed, labelled — and worker IPs are dropped', () => {
  const s = parseAccount(SAMPLE, 'pearlhash', ADDR, 1);
  assert.equal(s.workers.length, 2);
  assert.equal(s.gpus, 4);
  assert.equal(s.hashrate, 3e14 * 3 + 2.1e14);
  assert.equal(s.workers[0].hashrate, 8.1e14);
  assert.equal(s.workers[1].name, 'rig-b'); // bidi override + control chars stripped
  assert.equal(s.pending, 44.43);
  assert.deepEqual(s.epochs.map(e => [e.start, e.end, e.immatureTx]), [[Date.UTC(2026, 9, 14, 22), Date.UTC(2026, 9, 14, 23), 3]]);
  // newest first; other coins skipped
  assert.deepEqual(s.activity.map(a => [a.kind, a.amount]), [['payout', -16.87], ['credit', 0.39]]);
  assert.equal(s.activity[1].start, Date.UTC(2026, 9, 11, 7));
  assert.ok(!JSON.stringify(s).includes('192.0.2.'), 'IP addresses must not be kept');

  assert.deepEqual(parseAccount({ connected_workers: [], balance_transactions: [] }, 'pearlhash', ADDR, 1).workers, []); // unknown address
  for (const bad of [null, [], 'x', { connected_workers: [{ gpu_info: [{ hashrate: -1 }] }] }, { connected_workers: [{ gpu_info: [{ hashrate: 'fast' }] }] },
    { connected_workers: [1] }, { pending_rewards: { total_pending_prl: 1e12 } }, { balance_transactions: [{ amount: 1, reason: 'x', timestamp: 'now' }] }]) {
    assert.throws(() => parseAccount(bad, 'pearlhash', ADDR, 1), isPoolError, JSON.stringify(bad));
  }
});

test('pool account parser never crashes or accepts junk (fuzz)', () => {
  fc.assert(
    fc.property(fc.anything({ withObjectString: true }), body => {
      try {
        const s = parseAccount(body, 'pearlhash', ADDR, 0);
        assert.ok(Number.isFinite(s.hashrate) && s.hashrate >= 0 && Number.isFinite(s.pending));
      } catch (e) {
        assert.ok(isPoolError(e));
      }
    }),
    { numRuns: 3000 },
  );
  // and with the right shape but random values
  const worker = fc.record({ worker_name: fc.string(), worker_id: fc.string(), version: fc.string(), gpu_info: fc.array(fc.record({ name: fc.string(), hashrate: fc.double() })) });
  fc.assert(
    fc.property(fc.record({ connected_workers: fc.array(worker, { maxLength: 5 }), pending_rewards: fc.record({ total_pending_prl: fc.double() }) }), body => {
      try {
        const s = parseAccount(body, 'pearlhash', ADDR, 0);
        for (const w of s.workers) for (const g of w.gpus) assert.ok(Number.isFinite(g.hashrate) && g.hashrate >= 0);
      } catch (e) {
        assert.ok(isPoolError(e));
      }
    }),
    { numRuns: 2000 },
  );
});

test('epoch labels and hashrate units', () => {
  assert.deepEqual(epochRange('2026-10-14 23:00:00 UTC .. 2026-10-15 00:00:00 UTC'), [Date.UTC(2026, 9, 14, 23), Date.UTC(2026, 9, 15, 0)]);
  assert.equal(epochRange('yesterday'), null);
  assert.equal(epochRange('2026-10-15 00:00:00 UTC .. 2026-10-14 23:00:00 UTC'), null);
  assert.equal(formatHashrate(1.416e16), '14.16 PH/s');
  assert.equal(formatHashrate(2.99e14), '299.00 TH/s');
  assert.equal(formatHashrate(0), '0 H/s');
});

// ------------------------------------------------------------------ service flow

const net = NETWORKS.mainnet;
const book = new AddressBook(deriveAccount(await seedBytes(ABANDON), net, 'oyster').xpub, net);
const r0 = book.get(0, 0).address;
const r3 = book.get(0, 3).address;
const h64 = (n: number) => n.toString(16).padStart(64, 'c');
const calls: string[] = [];

globalThis.fetch = (async (input: string) => {
  const u = String(input);
  calls.push(u);
  let body: unknown = { error: 'unexpected' };
  if (u.endsWith('/api/v2')) body = { blockbook: { coin: 'Pearl', bestHeight: 1000, inSync: true }, backend: { chain: 'mainnet' } };
  else if (u.includes('/api/v2/xpub/')) {
    body = {
      balance: '500000000', unconfirmedBalance: '0', txs: 1, page: 1, totalPages: 1,
      tokens: [{ name: r3, path: "m/86'/808276'/0'/0/3", transfers: 1, balance: '500000000' }],
      // a block reward paid to receive address #3
      transactions: [{ txid: h64(1), vin: [{ n: 0, isAddress: false }], vout: [{ n: 0, value: '500000000', addresses: [r3], isAddress: true, isOwn: true }], blockHeight: 500, confirmations: 501, blockTime: 1791720000, fees: '0' }],
    };
  } else if (u.includes('/api/v2/utxo/')) body = [];
  else if (u.startsWith('https://pearlhash.xyz/api/account/')) body = SAMPLE;
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

test('service: suggests the address that receives mining income; link is per wallet and validated', async () => {
  const w = await W.createWallet({ secret: ABANDON, passphrase: '', network: 'mainnet', mode: 'oyster', name: 'Rig', password: 'test-password-1' });
  assert.equal(await W.poolStats(), null); // off by default
  assert.ok(!calls.some(u => u.includes('pearlhash')), 'no pool request until the user links one');

  const o = await W.overview();
  assert.deepEqual(o.payoutAddresses, [r3]);
  const c = await W.poolConfig();
  assert.equal(c.pool, null);
  assert.deepEqual(c.candidates, [r3, r0]);
  assert.deepEqual(c.detected, [r3]);

  await assert.rejects(W.setPool({ pool: 'pearlhash', address: 'tprl1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqm5v93u' }), (e: unknown) => e instanceof WalletError && e.code === 'pool.bad_address');
  await assert.rejects(W.setPool({ pool: 'nope', address: r3 }), (e: unknown) => e instanceof WalletError && e.code === 'pool.unknown');

  await W.setPool({ pool: 'pearlhash', address: r3 });
  const s = await W.poolStats();
  assert.equal(s?.workers.length, 2);
  const poolCalls = calls.filter(u => u.includes('pearlhash'));
  assert.deepEqual(poolCalls, [`https://pearlhash.xyz/api/account/${r3}`]); // only the mining address is sent
  await W.poolStats();
  assert.equal(calls.filter(u => u.includes('pearlhash')).length, 1); // cached

  // turning it off stops requests and keeps the suggestion dismissed
  const off = await W.setPool(null);
  assert.equal(off.pool, null);
  assert.equal(off.dismissed, true);
  assert.equal(await W.poolStats(), null);

  // tampered storage is ignored
  await localStore.set('pool.v1', { [w.walletId]: { pool: 'pearlhash', address: 'javascript:alert(1)' } });
  assert.equal((await W.poolConfig()).pool, null);

  await W.setPool({ pool: 'pearlhash', address: r3 });
  await W.deleteWallet(w.walletId, 'test-password-1');
  assert.deepEqual(await localStore.get('pool.v1'), {});
});

test('service: pools are mainnet-only', async () => {
  await W.createWallet({ secret: ABANDON, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'T', password: 'test-password-1' });
  await assert.rejects(W.setPool({ pool: 'pearlhash', address: ADDR }), (e: unknown) => e instanceof WalletError && e.code === 'pool.mainnet_only');
});
