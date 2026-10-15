// Nockchain (NOCK), read-only: address derivation against the official wallet, the gRPC-web /
// protobuf parser (untrusted input), and the per-wallet service flow incl. unlock-time repair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { initSync } from '../src/nock/wasm/akoya_nock.js';
import { deriveAddress, firstNames, formatNock } from '../src/nock/index.ts';
import { decodeBalanceResponse, encodeBalanceRequest, frame, unframe } from '../src/ext/nockrpc.ts';
import { seedBytes } from '../src/core/account.ts';
import { WalletError } from '../src/core/errors.ts';
import * as W from '../src/ext/wallet.ts';
import { localStore } from '../src/ext/platform.ts';
import { ABANDON } from './vectors.ts';

initSync({ module: readFileSync(new URL('../src/nock/wasm/akoya_nock_bg.wasm', import.meta.url)) });

// `nockchain-wallet --new --data-dir <tmp> import-keys --seedphrase "<phrase>" --version 1` →
// "Master Key (Imported) - Address: …" (official CLI, run 2026-10-15)
const CLUTCH = 'clutch inmate mango seek attract credit illegal popular term loyal fiber output trumpet lucky garbage merge menu certain dynamic aim trip fantasy master unveil';
const OFFICIAL = [
  [ABANDON, '3zxKWhhd8HY9pT2ZCZNUSEz2XWwSk15P2sD3atnnnxRtHa2Ta1H4jRy'],
  [CLUTCH, '3b3eG8WgWHfXTeAMJzNDWxM3b6WFadxQiiJRQrY6zPJ4J2F5QtHjZRQ'],
] as const;
const ADDR = OFFICIAL[0][1];

test('NOCK address matches the official nockchain-wallet (12 and 24 words)', async () => {
  for (const [phrase, address] of OFFICIAL) {
    const seed = await seedBytes(phrase, '');
    assert.equal(await deriveAddress(seed), address);
    assert.ok(seed.every(b => b === 0), 'seed is wiped after use');
  }
  await assert.rejects(deriveAddress(new Uint8Array(32)));
});

test('first names: deterministic, distinct, and reject junk', async () => {
  const [simple, coinbase] = await firstNames(ADDR);
  assert.notEqual(simple, coinbase);
  assert.deepEqual(await firstNames(ADDR), [simple, coinbase]);
  assert.notDeepEqual(await firstNames(OFFICIAL[1][1]), [simple, coinbase]);
  await assert.rejects(firstNames('not an address'));
  await assert.rejects(firstNames(''));
});

test('NOCK amounts: 65,536 nicks per NOCK, truncated', () => {
  assert.equal(formatNock(24164767n), '368.725'); // 368.72508…
  assert.equal(formatNock(65536n * 1234567n), '1,234,567');
  assert.equal(formatNock(1n), '0');
  assert.equal(formatNock(65535n), '0.9999');
});

// ------------------------------------------------------------------ protobuf / gRPC-web

const vint = (n: bigint | number) => {
  let v = BigInt(n);
  const out: number[] = [];
  while (v > 0x7fn) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
};
const len = (no: number, body: number[]) => [...vint((no << 3) | 2), ...vint(body.length), ...body];
const u64 = (no: number, v: bigint | number) => [...vint(no << 3), ...vint(v)];
const str = (no: number, s: string) => len(no, [...new TextEncoder().encode(s)]);
const wrap = (no: number, v: bigint | number) => len(no, u64(1, v));
// v2 Note: v1 = 2 → NoteV1 { origin_page = 2, assets = 5 }; legacy = 1 → v1.Note { origin_page = 1, assets = 6 }
const noteV1 = (nicks: bigint, page: number) => len(2, [...len(1, []), ...len(2, [...wrap(2, page), ...len(3, []), ...wrap(5, nicks)])]);
const noteLegacy = (nicks: bigint, page: number) => len(2, [...len(1, []), ...len(1, [...wrap(1, page), ...wrap(6, nicks)])]);
const balance = (notes: number[][], height: number, token = '') =>
  Uint8Array.from(len(1, [...notes.flatMap(n => len(1, n)), ...wrap(2, height), ...(token ? len(4, str(1, token)) : [])]));

test('balance response: legacy and v1 notes, height, pagination; node errors surface', () => {
  const p = decodeBalanceResponse(balance([noteV1(24164767n, 164936), noteLegacy(65536n, 100)], 165579, 'next'));
  assert.deepEqual(p.notes, [{ nicks: 24164767n, originPage: 164936n }, { nicks: 65536n, originPage: 100n }]);
  assert.equal(p.height, 165579n);
  assert.equal(p.nextPageToken, 'next');
  assert.equal(decodeBalanceResponse(balance([], 7)).notes.length, 0);

  const err = Uint8Array.from(len(2, [...u64(1, 3), ...str(2, 'bad first name\u0007')]));
  assert.throws(() => decodeBalanceResponse(err), (e: unknown) => e instanceof WalletError && e.code === 'nock.rpc_error' && !String(e.params?.detail).includes('\u0007'));
  assert.throws(() => decodeBalanceResponse(new Uint8Array()), (e: unknown) => e instanceof WalletError && e.code === 'nock.invalid_data');
  assert.throws(() => decodeBalanceResponse(Uint8Array.from([0x0a, 0x05, 1])), (e: unknown) => e instanceof WalletError && e.code === 'nock.invalid_data'); // truncated

  // request: first_name (2) → Base58Hash.hash (1); page (3) → limit (1) = 1000
  const req = encodeBalanceRequest('abc');
  assert.deepEqual([...req], [0x12, 0x05, 0x0a, 0x03, 0x61, 0x62, 0x63, 0x1a, 0x03, 0x08, 0xe8, 0x07]);

  // gRPC-web frames: data + trailer
  const body = Uint8Array.from([...frame(Uint8Array.from([1, 2, 3])), ...frame(new TextEncoder().encode('grpc-status: 5\r\ngrpc-message: not%20found\r\n'))]);
  body[8] = 0x80; // mark second frame as trailer
  const u = unframe(body);
  assert.deepEqual([...u.message!], [1, 2, 3]);
  assert.equal(u.status, '5');
  assert.equal(u.statusMessage, 'not found');
  assert.throws(() => unframe(Uint8Array.from([0, 0, 0, 0, 9, 1])), (e: unknown) => e instanceof WalletError);
});

test('protobuf / framing parsers never crash with anything but a typed error (fuzz)', () => {
  const typed = (e: unknown) => e instanceof WalletError && (e.code === 'nock.invalid_data' || e.code === 'nock.rpc_error');
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 512 }), bytes => {
      for (const f of [() => decodeBalanceResponse(bytes), () => unframe(bytes)]) {
        try {
          f();
        } catch (e) {
          assert.ok(typed(e), String(e));
        }
      }
    }),
    { numRuns: 5000 },
  );
  // structured: random notes round-trip exactly
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), fc.nat(), fc.boolean()), { maxLength: 20 }), fc.nat(), (ns, h) => {
      const p = decodeBalanceResponse(balance(ns.map(([v, pg, legacy]) => (legacy ? noteLegacy(v, pg) : noteV1(v, pg))), h));
      assert.deepEqual(p.notes.map(n => n.nicks), ns.map(([v]) => v));
    }),
    { numRuns: 500 },
  );
});

// ------------------------------------------------------------------ service flow

const rpcCalls: string[] = [];
let names: [string, string];
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const u = String(input);
  if (u.startsWith('https://rpc.nockbox.org/')) {
    const req = new Uint8Array(init!.body as ArrayBuffer);
    const text = new TextDecoder().decode(req);
    rpcCalls.push(text);
    // plain payments: 2 notes; mining rewards: one matured, one still timelocked (height 1000)
    const notes = text.includes(names[0]) ? [noteV1(65536n * 10n, 10), noteV1(32768n, 900)] : [noteV1(65536n * 3n, 800), noteV1(65536n * 2n, 950)];
    const trailer = frame(new TextEncoder().encode('grpc-status: 0\r\n'));
    trailer[0] = 0x80;
    return new Response(Uint8Array.from([...frame(balance(notes, 1000)), ...trailer]), { status: 200 });
  }
  const body = u.endsWith('/api/v2')
    ? { blockbook: { coin: 'Pearl', bestHeight: 1, inSync: true }, backend: { chain: u.includes('testnet') ? 'testnet2' : 'mainnet' } }
    : u.includes('/api/v2/xpub/') ? { balance: '0', unconfirmedBalance: '0', txs: 0, tokens: [], transactions: [] } : [];
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

test('service: off by default; password → address; balance with coinbase maturity; repaired on unlock', async () => {
  names = await firstNames(ADDR);
  const w = await W.createWallet({ secret: ABANDON, passphrase: 'pearl-only passphrase', network: 'mainnet', mode: 'oyster', name: 'Rig', password: 'test-password-1' });
  assert.equal((await W.nockConfig()).address, null);
  assert.equal(await W.nockOverview(), null);
  assert.equal(rpcCalls.length, 0, 'no Nockchain traffic until turned on');

  await assert.rejects(W.enableNock('wrong-password'));
  // the BIP39 passphrase is not used for NOCK (matches the official wallet / Iris)
  assert.equal((await W.enableNock('test-password-1')).address, ADDR);

  const ov = (await W.nockOverview())!;
  assert.equal(ov.spendable, String(65536n * 10n + 32768n + 65536n * 3n)); // 2 plain + matured coinbase
  assert.equal(ov.immature, String(65536n * 2n)); // 950 + 100 > 1000
  assert.equal(ov.notes, 4);
  assert.equal(formatNock(ov.spendable), '13.5');
  for (const c of rpcCalls) assert.ok(!c.includes('abandon') && c.length < 200, 'only first-names are sent');

  // a tampered address is repaired on the next unlock
  await localStore.set('nock.v1', { [w.walletId]: { address: OFFICIAL[1][1] } });
  assert.equal((await W.nockConfig()).address, OFFICIAL[1][1]);
  await W.lock();
  await W.unlock(w.walletId, 'test-password-1');
  assert.equal((await W.nockConfig()).address, ADDR);

  await W.disableNock();
  assert.equal((await W.nockConfig()).address, null);
  await W.enableNock('test-password-1');
  await W.deleteWallet(w.walletId, 'test-password-1');
  assert.deepEqual(await localStore.get('nock.v1'), {});
});

test('service: mainnet only; needs a recovery phrase; node URL must be https', async () => {
  await W.createWallet({ secret: ABANDON, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'T', password: 'test-password-1' });
  await assert.rejects(W.enableNock('test-password-1'), (e: unknown) => e instanceof WalletError && e.code === 'nock.mainnet_only');
  await W.createWallet({ secret: '000102030405060708090a0b0c0d0e0f', passphrase: '', network: 'mainnet', mode: 'oyster', name: 'Hex', password: 'test-password-1' });
  await assert.rejects(W.enableNock('test-password-1'), (e: unknown) => e instanceof WalletError && e.code === 'nock.needs_mnemonic');
  await assert.rejects(W.setNockRpc('http://rpc.example'), (e: unknown) => e instanceof WalletError && e.code === 'nock.bad_rpc');
  assert.equal((await W.setNockRpc('https://node.example/grpc/')).nockRpc, 'https://node.example/grpc');
});
