// Mining-pool link: parsing each pool's (untrusted) account data, telling which pool pays a wallet,
// and the per-wallet service flow incl. switching pools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { WalletError } from '../src/core/errors.ts';
import { isValidAddress } from '../src/core/address.ts';
import { POOLS, epochRange, formatHashrate, parsePearlhash, parsePeryn, poolBySender } from '../src/ext/pool.ts';
import * as W from '../src/ext/wallet.ts';
import { localStore } from '../src/ext/platform.ts';
import { AddressBook, deriveAccount, seedBytes } from '../src/core/account.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { ABANDON } from './vectors.ts';

const isPoolError = (e: unknown) => e instanceof WalletError && e.code === 'pool.invalid_data';
const ADDR = 'prl1p50ltku2jjcwdxh4nzjrw98nwdswdn25qdkr2fdtw8hsq3qu9cdhscchnnm';
// right-to-left override + a control character, as someone naming a rig to spoof the list might use
const SPOOF = String.fromCharCode(0x202e, 0x07);

// ------------------------------------------------------------------ Pearlhash

// shaped like a real Pearlhash /api/account response (documentation IPs, made-up names)
const gpu = (h: number) => ({ name: 'NVIDIA GeForce RTX 4090 D', hashrate: h });
const PEARLHASH = {
  connected_workers: [
    { ip: '192.0.2.10', worker_name: 'rig-a', worker_id: '13722564136804223058', version: 'WildRig_0.51.4', gpu_info: [gpu(3e14), gpu(3e14), gpu(2.1e14)] },
    { ip: '192.0.2.11', worker_name: `rig-b${SPOOF}`, worker_id: '13722564136804223059', version: 'WildRig_0.51.4', gpu_info: [gpu(3e14)] },
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

test('Pearlhash: parsed, summed, labelled — and worker IPs are dropped', () => {
  const s = parsePearlhash(PEARLHASH, ADDR, 1);
  assert.equal(s.pool, 'pearlhash');
  assert.equal(s.workers.length, 2);
  assert.ok(s.workers.every(w => w.online));
  assert.equal(s.gpus, 4);
  assert.equal(s.rigWindow, 'live');
  assert.equal(s.hashrate, 3e14 * 3 + 2.1e14);
  assert.equal(s.workers[0].hashrate, 8.1e14);
  assert.equal(s.workers[1].name, 'rig-b'); // bidi override + control chars stripped
  assert.equal(s.pending, 44.43);
  assert.equal(s.maturingBlocks, 3);
  assert.deepEqual(s.days, []);
  assert.deepEqual(s.epochs.map(e => [e.start, e.end, e.immatureTx]), [[Date.UTC(2026, 9, 14, 22), Date.UTC(2026, 9, 14, 23), 3]]);
  // newest first; other coins skipped
  assert.deepEqual(s.activity.map(a => [a.kind, a.amount]), [['payout', -16.87], ['credit', 0.39]]);
  assert.equal(s.activity[1].start, Date.UTC(2026, 9, 11, 7));
  assert.ok(!JSON.stringify(s).includes('192.0.2.'), 'IP addresses must not be kept');

  assert.deepEqual(parsePearlhash({ connected_workers: [], balance_transactions: [] }, ADDR, 1).workers, []); // unknown address
  for (const bad of [null, [], 'x', { connected_workers: [{ gpu_info: [{ hashrate: -1 }] }] }, { connected_workers: [{ gpu_info: [{ hashrate: 'fast' }] }] },
    { connected_workers: [1] }, { pending_rewards: { total_pending_prl: 1e12 } }, { balance_transactions: [{ amount: 1, reason: 'x', timestamp: 'now' }] }]) {
    assert.throws(() => parsePearlhash(bad, ADDR, 1), isPoolError, JSON.stringify(bad));
  }
});

// ------------------------------------------------------------------ Peryn

// shaped like a real Peryn /api/pool/address response (made-up rigs and amounts)
const PERYN_TXID = 'ab15e430a1d3a1c9ad5384405be9790b7f85ebe1c5c939dceddc5b4cc7caf000';
const perynBody = (address: string) => ({
  address,
  network: 'mainnet',
  known: true,
  hashrate: { lastHour: 5.3e15, last24h: 3e15 },
  windows: { '1h': { hashrate: 5.3e15, relSigma: 0.01 } },
  shares: { acceptedLastHour: 200, accepted24h: 2000, rejected24h: 3, rejectedByReason: { stale: 3 } },
  prl: { pendingGrains: '150000000', pendingBlocks: 2, owedGrains: '7944045368', confirmedGrains: '176287319732', paidGrains: '168343274364', minPayoutGrains: '100000000', heldGrains: '0', ppsDayGrains: '148786506572' },
  prlDays: [
    { day: '2026-11-11T00:00:00.000Z', predictedGrains: '88076953019', actualGrains: '87118584691' },
    { day: '2026-11-10T00:00:00.000Z', predictedGrains: '5586476019', actualGrains: '5423331543' },
  ],
  workers: [
    // measured for 11 h: the 24 h average is used rather than the noisy last hour
    { name: 'rig-01', kind: 'stratum', online: true, lastShareAt: '2026-11-12T04:41:11.664Z', hashrate1h: 3.5e15, hashrate24h: 2.7e15, span1h: 3500, span24h: 40000, mode: null },
    // only an hour of data so far: last hour it is
    { name: 'rig-02', kind: 'stratum', online: true, lastShareAt: '2026-11-12T04:40:00.000Z', hashrate1h: 2.6e15, hashrate24h: 2.0e15, span1h: 3500, span24h: 3600, mode: null },
    { name: `rig-03${SPOOF}`, kind: 'stratum', online: false, lastShareAt: 'a while ago', hashrate1h: 0, hashrate24h: 1e15, span24h: 50000, mode: 'pplns' },
  ],
  workerCounts: { online: 2, offline: 1 },
  payouts: [
    { amountGrains: '27138486366', status: 'sent', at: '2026-11-12T04:07:09.777Z', txids: [{ txid: PERYN_TXID, href: `https://explorer.pearlresearch.ai/tx/${PERYN_TXID}` }], networkFeeGrains: '53950' },
    { amountGrains: '100000000', status: 'queued', at: '2026-11-12T05:00:00.000Z', txids: [] },
  ],
  generatedAt: '2026-11-12T04:41:22.818Z',
});

test('Peryn: rigs without GPU detail, grain-string balances, daily credits, payouts', () => {
  const s = parsePeryn(perynBody(ADDR), ADDR, 7);
  assert.equal(s.pool, 'peryn');
  assert.equal(s.gpus, null);
  assert.equal(s.rigWindow, '24h');
  assert.equal(s.hashrate, 5.3e15);
  assert.deepEqual(s.workers.map(w => [w.name, w.online, w.hashrate, w.gpus.length]), [['rig-01', true, 2.7e15, 0], ['rig-02', true, 2.6e15, 0], ['rig-03', false, 1e15, 0]]);
  assert.equal(s.workers[0].lastShareAt, Date.UTC(2026, 10, 12, 4, 41, 11, 664));
  assert.equal(s.workers[2].lastShareAt, null);
  assert.equal(s.pending, 79.44045368 + 1.5); // owed + still-maturing
  assert.equal(s.maturingBlocks, 2);
  assert.deepEqual(s.days, [{ day: '2026-11-10', amount: 54.23331543 }, { day: '2026-11-11', amount: 871.18584691 }]); // oldest first
  assert.deepEqual(s.activity.map(a => [a.kind, a.amount, a.label]), [['other', -1, 'queued'], ['payout', -271.38486366, 'sent']]);
  assert.deepEqual(s.epochs, []);
  assert.ok(!JSON.stringify(s).includes(PERYN_TXID), 'nothing beyond what is shown is kept');

  // an address the pool has never seen
  const none = parsePeryn({ address: ADDR, network: 'mainnet', known: false, hashrate: { lastHour: 0, last24h: 0 }, prl: { pendingGrains: '0', owedGrains: '0' }, workers: [], payouts: [], prlDays: [] }, ADDR, 1);
  assert.deepEqual([none.workers.length, none.hashrate, none.pending], [0, 0, 0]);
  // no top-level hashrate: fall back to the rigs that are online
  assert.equal(parsePeryn({ workers: perynBody(ADDR).workers }, ADDR, 1).hashrate, 2.7e15 + 2.6e15);

  const base = perynBody(ADDR);
  for (const bad of [
    null, [], 'x',
    { ...base, address: 'prl1psomeoneelse' }, // an answer about another address
    { ...base, network: 'testnet2' },
    { workers: [1] }, { workers: [{ hashrate1h: 'fast' }] }, { workers: [{ hashrate1h: -1 }] }, { workers: [{ hashrate24h: 1e30 }] },
    { hashrate: { lastHour: 'x' } },
    { prl: { owedGrains: 79.4 } }, { prl: { owedGrains: '1e9' } }, { prl: { owedGrains: '-5' } }, { prl: { pendingGrains: '9'.repeat(19) } }, { prl: { pendingBlocks: -1 } },
    { prlDays: [{ day: 'yesterday', actualGrains: '1' }] }, { prlDays: [{ day: '2026-11-10', actualGrains: 1 }] },
    { payouts: [{ at: 'never', amountGrains: '1' }] }, { payouts: [{ at: '2026-11-12T04:07:09.777Z', amountGrains: 'lots' }] },
  ]) {
    assert.throws(() => parsePeryn(bad, ADDR, 1), isPoolError, JSON.stringify(bad));
  }
});

test('pool parsers never crash or accept junk (fuzz)', () => {
  const finite = (...xs: number[]) => xs.every(x => Number.isFinite(x) && x >= 0);
  for (const parse of [parsePearlhash, parsePeryn]) {
    fc.assert(
      fc.property(fc.anything({ withObjectString: true }), body => {
        try {
          const s = parse(body, ADDR, 0);
          assert.ok(finite(s.hashrate, s.pending, s.maturingBlocks));
        } catch (e) {
          assert.ok(isPoolError(e));
        }
      }),
      { numRuns: 3000 },
    );
  }
  // the right shapes with random values
  const phWorker = fc.record({ worker_name: fc.string(), worker_id: fc.string(), version: fc.string(), gpu_info: fc.array(fc.record({ name: fc.string(), hashrate: fc.double() })) });
  fc.assert(
    fc.property(fc.record({ connected_workers: fc.array(phWorker, { maxLength: 5 }), pending_rewards: fc.record({ total_pending_prl: fc.double() }) }), body => {
      try {
        for (const w of parsePearlhash(body, ADDR, 0).workers) for (const g of w.gpus) assert.ok(finite(g.hashrate));
      } catch (e) {
        assert.ok(isPoolError(e));
      }
    }),
    { numRuns: 2000 },
  );
  const anyNum = fc.oneof(fc.double(), fc.constant(null), fc.string());
  const peWorker = fc.record({ name: fc.string(), online: fc.oneof(fc.boolean(), fc.string()), hashrate1h: anyNum, hashrate24h: anyNum, span24h: anyNum, lastShareAt: fc.string() }, { requiredKeys: [] });
  const grainStr = fc.oneof(fc.bigInt({ min: 0n, max: 10n ** 20n }).map(String), fc.string(), fc.double());
  fc.assert(
    fc.property(
      fc.record({
        workers: fc.array(peWorker, { maxLength: 6 }),
        hashrate: fc.record({ lastHour: anyNum }, { requiredKeys: [] }),
        prl: fc.record({ owedGrains: grainStr, pendingGrains: grainStr, pendingBlocks: anyNum }, { requiredKeys: [] }),
        prlDays: fc.array(fc.record({ day: fc.string(), actualGrains: grainStr }), { maxLength: 4 }),
        payouts: fc.array(fc.record({ at: fc.string(), amountGrains: grainStr, status: fc.string() }), { maxLength: 4 }),
      }, { requiredKeys: [] }),
      body => {
        try {
          const s = parsePeryn(body, ADDR, 0);
          assert.ok(finite(s.hashrate, s.pending, s.maturingBlocks));
          for (const w of s.workers) assert.ok(finite(w.hashrate) && typeof w.online === 'boolean');
          for (const d of s.days) assert.ok(finite(d.amount) && /^\d{4}-\d{2}-\d{2}$/.test(d.day));
          for (const a of s.activity) assert.ok(Number.isFinite(a.amount) && a.amount <= 0 && Number.isFinite(a.at));
        } catch (e) {
          assert.ok(isPoolError(e));
        }
      },
    ),
    { numRuns: 3000 },
  );
});

test('epoch labels, hashrate units, and the pool registry', () => {
  assert.deepEqual(epochRange('2026-10-14 23:00:00 UTC .. 2026-10-15 00:00:00 UTC'), [Date.UTC(2026, 9, 14, 23), Date.UTC(2026, 9, 15, 0)]);
  assert.equal(epochRange('yesterday'), null);
  assert.equal(epochRange('2026-10-15 00:00:00 UTC .. 2026-10-14 23:00:00 UTC'), null);
  assert.equal(formatHashrate(1.416e16), '14.16 PH/s');
  assert.equal(formatHashrate(2.85372e17), '285.37 PH/s');
  assert.equal(formatHashrate(0), '0 H/s');

  const senders = POOLS.flatMap(p => p.payoutSenders);
  assert.equal(new Set(senders).size, senders.length, 'a sender address identifies one pool');
  for (const p of POOLS) {
    for (const u of [p.api, p.web]) {
      assert.equal(u.split('{address}').length, 2);
      assert.equal(new URL(u.replace('{address}', 'x')).protocol, 'https:');
    }
    for (const a of p.payoutSenders) {
      assert.ok(isValidAddress(a, NETWORKS.mainnet), a);
      assert.equal(poolBySender(a)?.id, p.id);
    }
  }
  assert.equal(poolBySender('prl1pr6yuq8u2r95wjzzgpdy8cpnncpl7l8zgy6x5q0367pnc53s2famqg7pt74'), undefined);
});

// ------------------------------------------------------------------ service flow

const net = NETWORKS.mainnet;
const book = new AddressBook(deriveAccount(await seedBytes(ABANDON), net, 'oyster').xpub, net);
const r0 = book.get(0, 0).address;
const r3 = book.get(0, 3).address;
const h64 = (n: number) => n.toString(16).padStart(64, 'c');
const PERYN_SENDER = POOLS.find(p => p.id === 'peryn')!.payoutSenders[0];
const calls: string[] = [];
let perynPays = false;

globalThis.fetch = (async (input: string) => {
  const u = String(input);
  calls.push(u);
  let body: unknown = { error: 'unexpected' };
  if (u.endsWith('/api/v2')) body = { blockbook: { coin: 'Pearl', bestHeight: 1000, inSync: true }, backend: { chain: 'mainnet' } };
  else if (u.includes('/api/v2/xpub/')) {
    // a block reward paid to receive address #3 …
    const reward = { txid: h64(1), vin: [{ n: 0, isAddress: false }], vout: [{ n: 0, value: '500000000', addresses: [r3], isAddress: true, isOwn: true }], blockHeight: 500, confirmations: 501, blockTime: 1791720000, fees: '0' };
    // … and, later, a payout from Peryn's payout address
    const payout = { txid: h64(2), vin: [{ n: 0, txid: h64(9), vout: 0, addresses: [PERYN_SENDER], isAddress: true, value: '90000000000' }], vout: [{ n: 0, value: '27138486366', addresses: [r3], isAddress: true, isOwn: true }], blockHeight: 900, confirmations: 101, blockTime: 1791800000, fees: '53950' };
    const txs = perynPays ? [payout, reward] : [reward];
    body = {
      balance: '500000000', unconfirmedBalance: '0', txs: txs.length, page: 1, totalPages: 1,
      tokens: [{ name: r3, path: "m/86'/808276'/0'/0/3", transfers: txs.length, balance: '500000000' }],
      transactions: txs,
    };
  } else if (u.includes('/api/v2/utxo/')) body = [];
  else if (u.startsWith('https://pearlhash.xyz/api/account/')) body = PEARLHASH;
  else if (u.startsWith('https://app.peryn.ai/api/pool/address/')) body = perynBody(decodeURIComponent(u.split('/address/')[1]));
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

test('service: suggests the address that receives mining income; link is per wallet and validated', async () => {
  const w = await W.createWallet({ secret: ABANDON, passphrase: '', network: 'mainnet', mode: 'oyster', name: 'Rig', password: 'test-password-1' });
  assert.equal(await W.poolStats(), null); // off by default
  assert.ok(!calls.some(u => u.includes('pearlhash') || u.includes('peryn')), 'no pool request until the user links one');

  const o = await W.overview();
  assert.deepEqual(o.payoutAddresses, [r3]);
  assert.equal(o.recentPool, null); // solo block reward: no pool we know
  const c = await W.poolConfig();
  assert.equal(c.pool, null);
  assert.deepEqual(c.candidates, [r3, r0]);
  assert.deepEqual(c.detected, [r3]);

  await assert.rejects(W.setPool({ pool: 'pearlhash', address: 'tprl1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqm5v93u' }), (e: unknown) => e instanceof WalletError && e.code === 'pool.bad_address');
  await assert.rejects(W.setPool({ pool: 'nope', address: r3 }), (e: unknown) => e instanceof WalletError && e.code === 'pool.unknown');

  await W.setPool({ pool: 'pearlhash', address: r3 });
  const s = await W.poolStats();
  assert.equal(s?.workers.length, 2);
  assert.deepEqual(calls.filter(u => u.includes('pearlhash')), [`https://pearlhash.xyz/api/account/${r3}`]); // only the mining address is sent
  await W.poolStats();
  assert.equal(calls.filter(u => u.includes('pearlhash')).length, 1); // cached

  // the rigs move to Peryn: its payouts are recognised by sender (no extra lookups) and name the pool
  perynPays = true;
  const before = calls.length;
  const moved = await W.overview();
  assert.equal(moved.recentPool, 'peryn');
  assert.equal(moved.history[0].poolPayout, true);
  assert.ok(!calls.slice(before).some(u => u.includes('/api/v2/tx/')), 'a known pool sender needs no coinbase lookup');
  assert.ok(!calls.some(u => u.includes('peryn.ai')), 'detection is local: the new pool is not contacted until the user switches');

  // "not now" is remembered per pool; unknown ids are refused
  assert.equal((await W.poolConfig()).switchDismissed, null);
  await assert.rejects(W.dismissPoolSwitch('nope'), (e: unknown) => e instanceof WalletError && e.code === 'pool.unknown');
  await W.dismissPoolSwitch('peryn');
  const dismissed = await W.poolConfig();
  assert.deepEqual([dismissed.pool, dismissed.switchDismissed], ['pearlhash', 'peryn']);

  // switching keeps the mining address and asks only the new pool
  await W.setPool({ pool: 'peryn', address: r3 });
  const p = await W.poolStats();
  assert.deepEqual([p?.pool, p?.workers.length, p?.gpus], ['peryn', 3, null]);
  assert.deepEqual(calls.filter(u => u.includes('peryn.ai')), [`https://app.peryn.ai/api/pool/address/${r3}`]);

  // turning it off stops requests and keeps the suggestion dismissed
  const off = await W.setPool(null);
  assert.equal(off.pool, null);
  assert.equal(off.dismissed, true);
  assert.equal(await W.poolStats(), null);

  // tampered storage is ignored
  await localStore.set('pool.v1', { [w.walletId]: { pool: 'pearlhash', address: 'javascript:alert(1)', switchDismissed: 'nope' } });
  const tampered = await W.poolConfig();
  assert.deepEqual([tampered.pool, tampered.switchDismissed], [null, null]);

  await W.setPool({ pool: 'pearlhash', address: r3 });
  await W.deleteWallet(w.walletId, 'test-password-1');
  assert.deepEqual(await localStore.get('pool.v1'), {});
});

test('service: pools are mainnet-only', async () => {
  await W.createWallet({ secret: ABANDON, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'T', password: 'test-password-1' });
  await assert.rejects(W.setPool({ pool: 'pearlhash', address: ADDR }), (e: unknown) => e instanceof WalletError && e.code === 'pool.mainnet_only');
});
