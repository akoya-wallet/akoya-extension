// Fiat value & daily P&L: the math, the price-feed parsers (untrusted input), and the service flow
// end to end against a stubbed indexer + stubbed CoinGecko — including the local daily log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { dailyPnl, localDay, prl } from '../src/core/pnl.ts';
import { WalletError } from '../src/core/errors.ts';
import { nearestPrice, parseSpot } from '../src/ext/price.ts';
import { formatFiat } from '../src/ext/format.ts';
import * as W from '../src/ext/wallet.ts';
import { localStore } from '../src/ext/platform.ts';
import { AddressBook, deriveAccount, seedBytes } from '../src/core/account.ts';
import { NETWORKS } from '../src/core/networks.ts';
import type { VaultEntry } from '../src/core/keystore.ts';
import { ABANDON } from './vectors.ts';

const PRL = 100_000_000n;
const isPriceError = (e: unknown) => e instanceof WalletError && e.code === 'price.unavailable';

test('daily P&L: price move on the midnight balance + mining income; transfers excluded', () => {
  // 100 PRL at midnight, then +10 mined and +20 received; price 1.5 → 2.0
  const r = dailyPnl({ holdingsNow: 130n * PRL, netFlowToday: 30n * PRL, minedToday: 10n * PRL, priceNow: 2, priceOpen: 1.5 });
  assert.equal(r.balanceOpen, 100n * PRL);
  assert.equal(r.valueNow, 260);
  assert.equal(r.valueOpen, 150);
  assert.equal(r.pnlPrice, 50);
  assert.equal(r.pnlMined, 20);
  assert.equal(r.pnl, 70);
  assert.ok(Math.abs(r.pnlPct! - 46.6667) < 1e-3);

  // a send out is not a loss
  const s = dailyPnl({ holdingsNow: 40n * PRL, netFlowToday: -60n * PRL, minedToday: 0n, priceNow: 1, priceOpen: 1 });
  assert.equal(s.pnl, 0);
  // empty at midnight: no percentage
  assert.equal(dailyPnl({ holdingsNow: 5n * PRL, netFlowToday: 5n * PRL, minedToday: 5n * PRL, priceNow: 2, priceOpen: 1 }).pnlPct, null);
  // incomplete history can't produce a negative opening balance
  assert.equal(dailyPnl({ holdingsNow: 1n * PRL, netFlowToday: 9n * PRL, minedToday: 0n, priceNow: 2, priceOpen: 1 }).balanceOpen, 0n);
});

test('daily P&L identity: P&L = Δvalue − non-mining inflow at today’s price', () => {
  const g = fc.bigInt({ min: 0n, max: 10_000_000n * PRL });
  const p = fc.double({ min: 0.0001, max: 10_000, noNaN: true });
  fc.assert(
    fc.property(g, g, g, p, p, (open, inflow, minedRaw, pNow, pOpen) => {
      const mined = minedRaw > inflow ? inflow : minedRaw; // mining is part of today's inflow
      const r = dailyPnl({ holdingsNow: open + inflow, netFlowToday: inflow, minedToday: mined, priceNow: pNow, priceOpen: pOpen });
      assert.equal(r.balanceOpen, open);
      const expect = r.valueNow - r.valueOpen - prl(inflow - mined) * pNow;
      assert.ok(Math.abs(r.pnl - expect) <= 1e-6 * Math.max(1, Math.abs(r.valueNow) + Math.abs(r.valueOpen)));
    }),
    { numRuns: 2000 },
  );
});

test('price feed: well-formed responses parse, anything else is a typed error', () => {
  const ok = parseSpot({ 'pearl-2': { usd: 1.89, usd_24h_change: 5.5, usd_market_cap: 6.5e8 }, bitcoin: { usd_market_cap: 1.6e12 } }, 'usd', 1);
  assert.equal(ok.price, 1.89);
  assert.equal(ok.change24h, 5.5);
  assert.ok(Math.abs(ok.flip! - 6.5e8 / 1.6e12) < 1e-15);
  assert.equal(parseSpot({ 'pearl-2': { sats: 2324.48 } }, 'sats', 1).flip, null);

  for (const bad of [null, [], {}, { 'pearl-2': {} }, { 'pearl-2': { usd: '1.89' } }, { 'pearl-2': { usd: -1 } }, { 'pearl-2': { usd: 0 } }, { 'pearl-2': { usd: 1e9 } }, { 'pearl-2': { cny: 12 } }]) {
    assert.throws(() => parseSpot(bad, 'usd', 1), isPriceError, JSON.stringify(bad));
  }
  // garbage in optional fields is dropped, not trusted
  const odd = parseSpot({ 'pearl-2': { usd: 2, usd_24h_change: 'x', usd_market_cap: -5 }, bitcoin: { usd_market_cap: 1e12 } }, 'usd', 1);
  assert.equal(odd.change24h, null);
  assert.equal(odd.flip, null);

  const t0 = 1_791_936_000_000;
  assert.equal(nearestPrice({ prices: [[t0 - 600_000, 1.1], [t0 + 120_000, 1.2], [t0 + 900_000, 1.3]] }, t0), 1.2);
  assert.equal(nearestPrice({ prices: [['x', 9], [t0, 'y'], [t0 + 60_000, 1.4]] }, t0), 1.4);
  assert.throws(() => nearestPrice({ prices: [[t0 - 2 * 3_600_000, 1.1]] }, t0), isPriceError); // too far away
  assert.throws(() => nearestPrice({ prices: [] }, t0), isPriceError);
  assert.throws(() => nearestPrice('nope', t0), isPriceError);
});

test('price feed parsers never crash or accept junk (fuzz)', () => {
  fc.assert(
    fc.property(fc.anything(), body => {
      try {
        const s = parseSpot(body, 'usd', 0);
        assert.ok(Number.isFinite(s.price) && s.price > 0 && s.price < 1e7);
      } catch (e) {
        assert.ok(isPriceError(e));
      }
      try {
        const v = nearestPrice(body, 0);
        assert.ok(Number.isFinite(v) && v > 0);
      } catch (e) {
        assert.ok(isPriceError(e));
      }
    }),
    { numRuns: 3000 },
  );
});

test('display currencies format sensibly', () => {
  assert.equal(formatFiat(661.6, 'usd', 'en-US'), '$661.60');
  assert.equal(formatFiat(12.345, 'usd', 'en-US', { sign: true }), '+$12.35');
  assert.equal(formatFiat(1.8912, 'usd', 'en-US', { price: true }), '$1.8912');
  assert.equal(formatFiat(-1203.4, 'krw', 'en-US', { sign: true }), '-₩1,203');
  assert.equal(formatFiat(2324.48, 'sats', 'en-US', { price: true }), '2,324 sats');
  assert.equal(formatFiat(-3.1e8, 'sats', 'en-US', { sign: true }), '-₿3.1000');
});

// ------------------------------------------------------------------ service flow

const net = NETWORKS.mainnet;
// the public "abandon … about" test wallet, oyster mode
const book = new AddressBook(deriveAccount(await seedBytes(ABANDON), net, 'oyster').xpub, net);
const r0 = book.get(0, 0).address;
const r1 = book.get(0, 1).address;
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
const nowS = Math.floor(Date.now() / 1000);
const h64 = (n: number) => n.toString(16).padStart(64, 'b');
const FOREIGN = 'prl1p50ltku2jjcwdxh4nzjrw98nwdswdn25qdkr2fdtw8hsq3qu9cdhscchnnm';

const calls: string[] = [];
globalThis.fetch = (async (input: string) => {
  const u = String(input);
  calls.push(u);
  let body: unknown = { error: 'unexpected' };
  if (u.endsWith('/api/v2')) body = { blockbook: { coin: 'Pearl', bestHeight: 1000, inSync: true }, backend: { chain: 'mainnet' } };
  else if (u.includes('/api/v2/xpub/')) {
    body = {
      balance: '13000000000', unconfirmedBalance: '0', txs: 3, page: 1, totalPages: 1,
      tokens: [{ name: r0, path: "m/86'/808276'/0'/0/0", transfers: 2, balance: '12000000000' }, { name: r1, path: "m/86'/808276'/0'/0/1", transfers: 1, balance: '1000000000' }],
      transactions: [
        // today: block reward 10 PRL (coinbase), and an ordinary 20 PRL transfer in
        { txid: h64(1), vin: [{ n: 0, isAddress: false }], vout: [{ n: 0, value: '1000000000', addresses: [r1], isAddress: true, isOwn: true }], blockHeight: 996, confirmations: 5, blockTime: nowS, fees: '0' },
        { txid: h64(2), vin: [{ n: 0, txid: h64(9), vout: 0, addresses: [FOREIGN], isAddress: true, value: '2500000000' }], vout: [{ n: 0, value: '2000000000', addresses: [r0], isAddress: true, isOwn: true }], blockHeight: 998, confirmations: 3, blockTime: nowS, fees: '1000' },
        // yesterday
        { txid: h64(3), vin: [{ n: 0, txid: h64(8), vout: 0, addresses: [FOREIGN], isAddress: true, value: '20000000000' }], vout: [{ n: 0, value: '10000000000', addresses: [r0], isAddress: true, isOwn: true }], blockHeight: 500, confirmations: 501, blockTime: Math.floor(midnight.getTime() / 1000) - 3600, fees: '1000' },
      ],
    };
  } else if (u.includes('/api/v2/utxo/')) {
    body = [
      { txid: h64(3), vout: 0, value: '10000000000', confirmations: 501, path: "m/86'/808276'/0'/0/0", address: r0 },
      { txid: h64(2), vout: 0, value: '2000000000', confirmations: 3, path: "m/86'/808276'/0'/0/0", address: r0 },
      { txid: h64(1), vout: 0, value: '1000000000', confirmations: 5, path: "m/86'/808276'/0'/0/1", address: r1 },
    ];
  } else if (u.includes('/api/v2/tx/')) {
    const id = u.split('/api/v2/tx/')[1];
    body = id === h64(1)
      ? { txid: id, vin: [{ n: 0, isAddress: false }], vout: [], blockHeight: 996, confirmations: 5, blockTime: nowS, fees: '0' }
      : { txid: id, vin: [{ n: 0, txid: h64(7), vout: 0, addresses: [FOREIGN], isAddress: true, value: '1' }], vout: [], blockHeight: 900, confirmations: 101, blockTime: nowS - 9000, fees: '0' };
  } else if (u.startsWith('https://api.coingecko.com/api/v3/simple/price?')) {
    body = { 'pearl-2': { usd: 2, usd_24h_change: 12.5, usd_market_cap: 6.5e8 }, bitcoin: { usd_market_cap: 1.6e12 } };
  } else if (u.startsWith('https://api.coingecko.com/api/v3/coins/pearl-2/market_chart?')) {
    body = { prices: [[midnight.getTime() - 300_000, 1.4], [midnight.getTime() + 60_000, 1.5], [Date.now(), 2]] };
  }
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

test('service: off by default and makes no price request; opt-in gives value, P&L and a local log', async () => {
  const w = await W.createWallet({ secret: ABANDON, passphrase: '', network: 'mainnet', mode: 'oyster', name: 'Rig', password: 'test-password-1' });
  const o = await W.overview();
  assert.equal(o.spendable, '12000000000');
  assert.equal(o.immature, '1000000000');
  assert.equal(o.netToday, '3000000000');
  assert.equal(o.minedToday, '1000000000');
  assert.equal(o.todayComplete, true);

  assert.equal((await W.getSettings()).fiat, 'off');
  assert.equal(await W.pnlToday(o), 'off');
  assert.ok(!calls.some(u => u.includes('coingecko')), 'no third-party request while the feature is off');

  await W.setSettings({ fiat: 'usd' });
  const v = await W.pnlToday(o);
  assert.ok(typeof v === 'object');
  assert.equal(v.holdings, '13000000000');
  assert.equal(v.balanceOpen, '10000000000');
  assert.equal(v.priceOpen, 1.5);
  assert.equal(v.valueNow, 260);
  assert.equal(v.pnlPrice, 50);
  assert.equal(v.pnlMined, 20);
  assert.equal(v.pnl, 70);
  assert.equal(v.change24h, 12.5);
  assert.ok(v.flip! > 0 && v.flip! < 0.001);

  // CoinGecko requests carry only the coin ids and the currency — never wallet data
  const cg = calls.filter(u => u.includes('coingecko'));
  for (const u of cg) {
    assert.ok(!u.includes(r0) && !u.includes(r1) && !u.includes('xpub') && !u.includes('130') && !u.includes('tr('), u);
  }
  // cached: spot for a minute, midnight price for the day
  await W.pnlToday(o);
  assert.equal(calls.filter(u => u.includes('coingecko')).length, cg.length);

  const log = await W.pnlHistory();
  assert.equal(log.length, 1);
  assert.equal(log[0].day, localDay());
  assert.equal(log[0].pnl, 70);
  assert.equal(log[0].bal, '13000000000');

  // tampered log rows are dropped on read
  const raw = (await localStore.get('pnl.v1')) as Record<string, Record<string, unknown>>;
  raw[`${w.walletId}:usd`]['2020-01-01'] = { day: '2020-01-01', pnl: 'lots', value: 1, open: 1, close: 1, bal: '1', balOpen: '1', mined: '0' };
  await localStore.set('pnl.v1', raw);
  assert.equal((await W.pnlHistory()).length, 1);

  // deleting the wallet deletes its log
  await W.deleteWallet(w.walletId, 'test-password-1');
  const left = (await localStore.get('pnl.v1')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(left), []);
  assert.equal(((await localStore.get('vault.v1')) as VaultEntry[]).length, 0);
});

test('service: no price on test networks', async () => {
  await W.createWallet({ secret: ABANDON, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'T', password: 'test-password-1' });
  const o = { spendable: '0', immature: '0', netToday: '0', minedToday: '0', todayComplete: true } as Parameters<typeof W.pnlToday>[0];
  assert.equal(await W.pnlToday(o), 'unsupported');
});
