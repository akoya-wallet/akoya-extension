// "Export private key": one address's key as WIF + hex, behind the password, never stored or logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeed } from '@scure/bip39';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as W from '../src/ext/wallet.ts';
import { localStore, sessionStore } from '../src/ext/platform.ts';
import { encodePrivateKey } from '../src/core/account.ts';
import { base58check, toHex } from '../src/core/encoding.ts';
import { taprootAddress } from '../src/core/address.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { ABANDON } from './vectors.ts';

const PW = 'test-password-1';

// Minimal Blockbook: testnet2 chain, no used addresses.
globalThis.fetch = (async (url: string) => {
  const u = String(url);
  const body = u.endsWith('/api/v2')
    ? { blockbook: { coin: 'Pearl Testnet2', bestHeight: 1, inSync: true }, backend: { chain: 'testnet2' } }
    : u.includes('/api/v2/xpub/')
      ? { balance: '0', unconfirmedBalance: '0', txs: 0, tokens: [], transactions: [] }
      : { error: 'unexpected' };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

test('WIF encoding: known vectors for private key 1, compressed, per network', () => {
  const one = new Uint8Array(32);
  one[31] = 1;
  const main = encodePrivateKey(one, NETWORKS.mainnet);
  assert.equal(main.wif, 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn');
  assert.equal(main.hex, '0000000000000000000000000000000000000000000000000000000000000001');
  assert.equal(encodePrivateKey(one, NETWORKS.testnet2).wif, 'cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA');
  assert.throws(() => encodePrivateKey(new Uint8Array(31), NETWORKS.mainnet));
});

test('exports the key that controls the chosen address, and only that one', async () => {
  const net = NETWORKS.testnet2;
  await W.createWallet({ secret: ABANDON, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'A', password: PW });

  // independent derivation with plain BIP32 (no oyster divergence for this seed)
  const root = HDKey.fromMasterSeed(await mnemonicToSeed(ABANDON));
  for (const [branch, index] of [[0, 0], [0, 7], [1, 2]]) {
    const path = `m/86'/1'/0'/${branch}/${index}`;
    const k = await W.exportPrivateKey(PW, path);
    const want = root.derive(path).privateKey!;
    assert.equal(k.path, path);
    assert.equal(k.hex, toHex(want));
    // WIF = version byte || key || 0x01 (compressed)
    const raw = base58check.decode(k.wif);
    assert.equal(raw.length, 34);
    assert.equal(raw[0], net.signerNet.wif);
    assert.equal(raw[33], 0x01);
    assert.equal(toHex(raw.subarray(1, 33)), k.hex);
    // the key's BIP86 taproot address is the address we display
    assert.equal(taprootAddress(secp256k1.getPublicKey(want, true), net).address, k.address);
  }
  assert.equal((await W.exportPrivateKey(PW, "m/86'/1'/0'/0/0")).address, 'tprl1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqm5v93u');
  // offline fallback offered when the indexer is down points at the same address/path
  assert.deepEqual(await W.localAddress(0, 0), { address: 'tprl1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqm5v93u', path: "m/86'/1'/0'/0/0" });
});

test('wrong password, foreign or malformed paths are refused without leaking key material', async () => {
  await W.createWallet({ secret: ABANDON, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'B', password: PW });
  const ok = await W.exportPrivateKey(PW, "m/86'/1'/0'/0/0");

  await assert.rejects(W.exportPrivateKey('nope-nope-nope', "m/86'/1'/0'/0/0"), (e: Error & { code?: string }) => {
    assert.equal(e.code, 'vault.wrong_password');
    assert.ok(!e.message.includes(ok.hex) && !e.message.includes(ok.wif));
    return true;
  });
  for (const bad of ["m/86'/0'/0'/0/0", "m/86'/1'/1'/0/0", "m/86'/1'/0'/2/0", "m/86'/1'/0'/0/0'", "m/86'/1'/0'/0/999999", "m/86'/1'/0'/0", '', 'garbage']) {
    await assert.rejects(W.exportPrivateKey(PW, bad), (e: Error & { code?: string }) => e.code === 'export.bad_path', bad);
  }

  await W.lock();
  await assert.rejects(W.exportPrivateKey(PW, "m/86'/1'/0'/0/0"), W.LockedError);
});

test('nothing is written to storage or the console during an export', async () => {
  await W.createWallet({ secret: ABANDON, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'C', password: PW });
  const writes: string[] = [];
  const spy = (area: typeof localStore) => {
    const set = area.set;
    area.set = async (k, v) => {
      writes.push(JSON.stringify([k, v]));
      return set(k, v);
    };
    return () => void (area.set = set);
  };
  const logged: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const orig = methods.map(m => console[m]);
  methods.forEach(m => (console[m] = (...a: unknown[]) => void logged.push(a.map(String).join(' '))));
  const undo = [spy(localStore), spy(sessionStore)];
  let k: Awaited<ReturnType<typeof W.exportPrivateKey>>;
  try {
    k = await W.exportPrivateKey(PW, "m/86'/1'/0'/1/3");
  } finally {
    undo.forEach(f => f());
    methods.forEach((m, i) => (console[m] = orig[i]));
  }
  for (const line of [...writes, ...logged]) {
    assert.ok(!line.includes(k.hex) && !line.includes(k.wif), 'key material escaped');
  }
});
