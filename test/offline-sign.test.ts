// Signing must need zero network access. CI additionally runs this file inside
// `docker run --network none`. Here we also make any fetch attempt fail loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressBook, deriveAccount, privateKeyAt, seedBytes } from '../src/core/account.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { planTransaction, signPlan } from '../src/core/tx.ts';

test('derive + plan + sign with networking disabled', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error('network access attempted during signing');
  }) as typeof fetch;
  try {
    const net = NETWORKS.mainnet;
    const seed = await seedBytes('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const acct = deriveAccount(seed, net, 'oyster');
    seed.fill(0);
    const book = new AddressBook(acct.xpub, net);
    const plan = planTransaction(
      [{ txid: 'ab'.repeat(32), vout: 1, value: 5_000_000n, confirmations: 6, branch: 0, index: 0, address: book.get(0, 0).address }],
      { to: book.get(0, 7).address, amount: 1_000_000n, feeRate: 5 },
      net,
    );
    const signed = signPlan(
      plan,
      net,
      (b, i) => ({ priv: privateKeyAt(acct.accountPriv, b, i), pub: book.get(b, i).pub, script: book.get(b, i).script }),
      book.get(1, 0).script,
    );
    acct.accountPriv.wipePrivateData();
    assert.match(signed.txid, /^[0-9a-f]{64}$/);
    assert.equal(signed.fee, plan.fee);
  } finally {
    globalThis.fetch = realFetch;
  }
});
