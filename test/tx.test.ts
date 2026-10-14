import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RawTx, Transaction } from '@scure/btc-signer';
import { schnorr } from '@noble/curves/secp256k1.js';
import { AddressBook, deriveAccount, privateKeyAt } from '../src/core/account.ts';
import { decodeAddress } from '../src/core/address.ts';
import { bech32m, fromHex } from '../src/core/encoding.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { WADDRMGR_SEED } from './vectors.ts';
import { DUST_LIMIT, InsufficientFunds, estimateVsize, planTransaction, signPlan, type WalletUtxo } from '../src/core/tx.ts';

const net = NETWORKS.mainnet;

// A real mainnet transaction (block 127629) signed by a Pearl wallet. If btc-signer's
// BIP341 sighash matches Pearl consensus, its Schnorr signatures verify against our preimage.
test('BIP341 sighash matches a live Pearl mainnet transaction', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/mainnet-tx-04ba3565.json', import.meta.url), 'utf8'));
  const tx = Transaction.fromRaw(fromHex(fx.hex), { allowUnknownOutputs: true });
  assert.equal(tx.id, fx.txid);
  const raw = RawTx.decode(fromHex(fx.hex));
  const scripts = fx.prevouts.map((p: { address: string }) => decodeAddress(p.address, net).script);
  const amounts = fx.prevouts.map((p: { value: string }) => BigInt(p.value));
  for (let i = 0; i < tx.inputsLength; i++) {
    const witness = raw.witnesses![i];
    assert.equal(witness.length, 1);
    const sig = witness[0];
    assert.equal(sig.length, 64, 'SIGHASH_DEFAULT signature');
    const msg = tx.preimageWitnessV1(i, scripts, 0, amounts);
    const outputKey = scripts[i].slice(2);
    assert.ok(schnorr.verify(sig, msg, outputKey), `input ${i} signature must verify`);
  }
});

const SEED = fromHex(WADDRMGR_SEED);
const acct = deriveAccount(SEED, net, 'oyster');
const book = new AddressBook(acct.xpub, net);
const keyFor = (b: number, i: number) => {
  const a = book.get(b, i);
  return { priv: privateKeyAt(acct.accountPriv, b, i), pub: a.pub, script: a.script };
};
const utxo = (value: bigint, b = 0, i = 0, conf = 3, n = 0): WalletUtxo => ({
  txid: (n + 1).toString(16).padStart(64, 'a'),
  vout: n,
  value,
  confirmations: conf,
  branch: b,
  index: i,
  address: book.get(b, i).address,
});
const DEST = 'prl1p65h6kqgvvwh0eae8tr23dcjhuc2sqqt7zm579dp6zfmj4sfhtrysm3mpad';

test('sign: produces valid Schnorr witnesses for every input (incl. leading-zero privkey 0/0)', () => {
  const utxos = [utxo(50_000_000n, 0, 0, 3, 0), utxo(30_000_000n, 1, 2, 1, 1), utxo(10_000n, 0, 3, 0, 2)];
  const plan = planTransaction(utxos, { to: DEST, amount: 60_000_000n, feeRate: 20 }, net);
  assert.equal(plan.inputs.length, 2);
  const change = book.get(1, 5);
  const signed = signPlan(plan, net, keyFor, change.script);
  const tx = Transaction.fromRaw(fromHex(signed.hex), { allowUnknownOutputs: true });
  const raw = RawTx.decode(fromHex(signed.hex));
  assert.equal(raw.version, 1);
  const scripts = plan.inputs.map(u => book.get(u.branch, u.index).script);
  const amounts = plan.inputs.map(u => u.value);
  for (let i = 0; i < plan.inputs.length; i++) {
    const msg = tx.preimageWitnessV1(i, scripts, 0, amounts);
    assert.ok(schnorr.verify(raw.witnesses![i][0], msg, scripts[i].slice(2)));
  }
  assert.equal(raw.outputs[0].amount, 60_000_000n);
  assert.equal(raw.outputs[1].amount, plan.change);
  assert.deepEqual(raw.outputs[1].script, change.script);
  assert.equal(plan.inputs.reduce((s, u) => s + u.value, 0n), plan.amount + plan.change + plan.fee);
  assert.equal(signed.vsize, estimateVsize(2, 2));
});

test('plan: send max uses every utxo and leaves no change', () => {
  const utxos = [utxo(1_000_000n, 0, 0, 1, 0), utxo(2_000_000n, 0, 1, 0, 1)];
  const plan = planTransaction(utxos, { to: DEST, amount: 0n, feeRate: 10, sendMax: true }, net);
  assert.equal(plan.inputs.length, 2);
  assert.equal(plan.change, 0n);
  assert.equal(plan.amount + plan.fee, 3_000_000n);
  const signed = signPlan(plan, net, keyFor, null);
  assert.equal(signed.fee, plan.fee);
});

test('plan: dust change is folded into the fee', () => {
  const vNo = estimateVsize(1, 1);
  const amount = 1_000_000n - BigInt(vNo) - 100n; // leftover 100 grains < dust
  const plan = planTransaction([utxo(1_000_000n)], { to: DEST, amount, feeRate: 1 }, net);
  assert.equal(plan.change, 0n);
  assert.equal(plan.fee, BigInt(vNo) + 100n);
});

test('plan: insufficient funds and dust amounts are rejected', () => {
  assert.throws(() => planTransaction([utxo(1000n)], { to: DEST, amount: 5000n, feeRate: 1 }, net), InsufficientFunds);
  assert.throws(() => planTransaction([utxo(1_000_000n)], { to: DEST, amount: DUST_LIMIT - 1n, feeRate: 1 }, net));
  assert.throws(() => planTransaction([utxo(1_000_000n)], { to: 'tprl1pmxa4c2w8cp6dq0j65sm4ha5qglr83xuwqhjlnzgr9etj8l9n5rrqgkhc6a', amount: 10_000n, feeRate: 1 }, net));
});

test('plan: can pay to a P2MR (witness v2) address', () => {
  const addr = bech32m.encode('prl', [2, ...bech32m.toWords(new Uint8Array(32).fill(7))]);
  const plan = planTransaction([utxo(1_000_000n)], { to: addr, amount: 100_000n, feeRate: 2 }, net);
  const signed = signPlan(plan, net, keyFor, book.get(1, 0).script);
  const raw = RawTx.decode(fromHex(signed.hex));
  assert.equal(raw.outputs[0].script[0], 0x52);
});
