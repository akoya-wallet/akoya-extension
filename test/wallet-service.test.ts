// Service-layer flows that guard funds: xpub metadata repair, password change, own-wallet recipients.
// Runs against the in-memory storage fallback and a stubbed indexer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../src/ext/wallet.ts';
import { localStore } from '../src/ext/platform.ts';
import { AddressBook } from '../src/core/account.ts';
import { NETWORKS } from '../src/core/networks.ts';
import type { VaultEntry } from '../src/core/keystore.ts';
import { ABANDON } from './vectors.ts';

const ZOO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
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

test('own wallets, xpub repair on unlock, xpub kept across password change', async () => {
  const net = NETWORKS.testnet2;
  const a = await W.createWallet({ secret: ABANDON, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'Savings', password: PW });
  const b = await W.createWallet({ secret: ZOO, passphrase: '', network: 'testnet2', mode: 'oyster', name: 'Mining', password: PW });

  // session is wallet B; wallet A is offered with its first unused receive address
  const own = await W.ownRecipients();
  assert.equal(own.length, 1);
  assert.equal(own[0].walletId, a.walletId);
  const vault = (await localStore.get('vault.v1')) as VaultEntry[];
  const xa = vault.find(e => e.id === a.walletId)!.xpub!;
  assert.equal(own[0].address, new AddressBook(xa, net).get(0, 0).address);
  assert.equal(own[0].address, 'tprl1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqm5v93u');

  // tamper with A's clear-text xpub (swap in B's) → unlocking A must repair it
  const xb = vault.find(e => e.id === b.walletId)!.xpub!;
  await localStore.set('vault.v1', vault.map(e => (e.id === a.walletId ? { ...e, xpub: xb } : e)));
  await W.unlock(a.walletId, PW);
  const repaired = ((await localStore.get('vault.v1')) as VaultEntry[]).find(e => e.id === a.walletId)!;
  assert.equal(repaired.xpub, xa);

  // password change keeps the xpub and the new password works
  await W.changePassword(PW, 'another-password-2');
  const after = ((await localStore.get('vault.v1')) as VaultEntry[]).find(e => e.id === a.walletId)!;
  assert.equal(after.xpub, xa);
  await W.lock();
  await W.unlock(a.walletId, 'another-password-2');

  // never offers wallets from another network
  await W.createWallet({ secret: ZOO, passphrase: '', network: 'mainnet', mode: 'oyster', name: 'Main', password: PW });
  await W.unlock(a.walletId, 'another-password-2');
  assert.deepEqual((await W.ownRecipients()).map(o => o.name), ['Mining']);
});
