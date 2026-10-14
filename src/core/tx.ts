// Coin selection, fee math and Taproot key-path signing. No network access in this module:
// signing works fully offline given a plan (see test/offline-sign.test.ts).
//
// Pearl uses BIP341 sighash + BIP340 Schnorr unchanged (node/txscript/sighash.go),
// so @scure/btc-signer produces valid witnesses. Transactions use version 1 and
// final sequences, like the ones oyster broadcasts. BIP341 commits to every input's
// amount and script, so an indexer lying about UTXOs can only make signing fail —
// it cannot trick the wallet into paying a different fee.

import { Transaction } from '@scure/btc-signer';
import { decodeAddress } from './address.ts';
import { MAX_SANE_FEE_PER_VB, MIN_RELAY_FEE_PER_VB, type PearlNetwork } from './networks.ts';

export interface WalletUtxo {
  txid: string;
  vout: number;
  value: bigint;
  confirmations: number;
  branch: number;
  index: number;
  address: string;
}

export interface PlanRequest {
  to: string;
  /** grains; ignored when sendMax */
  amount: bigint;
  /** grain per vbyte */
  feeRate: number;
  sendMax?: boolean;
  /** spend unconfirmed outputs too (default true: change from own txs is safe) */
  includeUnconfirmed?: boolean;
}

export interface TxPlan {
  inputs: WalletUtxo[];
  to: string;
  amount: bigint;
  change: bigint;
  fee: bigint;
  vsize: number;
  feeRate: number;
}

/** Conservative dust limit. Pearl's policy gives 333 grains for P2TR at the 1 grain/vB minimum relay fee. */
export const DUST_LIMIT = 546n;

const varIntSize = (n: number) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5);

/** Exact vsize for n P2TR key-path inputs (64-byte sig, SIGHASH_DEFAULT) and m 34-byte-script outputs. */
export function estimateVsize(nIn: number, nOut: number): number {
  const base = 4 + varIntSize(nIn) + nIn * 41 + varIntSize(nOut) + nOut * 43 + 4;
  const witness = 2 + nIn * 66;
  return Math.ceil((base * 4 + witness) / 4);
}

const feeFor = (vsize: number, rate: number) => BigInt(Math.ceil(vsize * rate));

export class InsufficientFunds extends Error {
  needed: bigint;
  available: bigint;
  constructor(needed: bigint, available: bigint) {
    super('余额不足');
    this.needed = needed;
    this.available = available;
  }
}

export function planTransaction(utxos: WalletUtxo[], req: PlanRequest, net: PearlNetwork): TxPlan {
  decodeAddress(req.to, net);
  if (!Number.isFinite(req.feeRate) || req.feeRate > MAX_SANE_FEE_PER_VB) throw new Error(`费率异常（>${MAX_SANE_FEE_PER_VB} grain/vB）`);
  const feeRate = Math.max(req.feeRate, MIN_RELAY_FEE_PER_VB);
  const pool = utxos
    .filter(u => req.includeUnconfirmed !== false || u.confirmations > 0)
    .sort((a, b) => (b.confirmations > 0 ? 1 : 0) - (a.confirmations > 0 ? 1 : 0) || (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  const available = pool.reduce((s, u) => s + u.value, 0n);

  if (req.sendMax) {
    if (!pool.length) throw new InsufficientFunds(DUST_LIMIT, 0n);
    const vsize = estimateVsize(pool.length, 1);
    const fee = feeFor(vsize, feeRate);
    const amount = available - fee;
    if (amount < DUST_LIMIT) throw new InsufficientFunds(fee + DUST_LIMIT, available);
    return { inputs: pool, to: req.to, amount, change: 0n, fee, vsize, feeRate };
  }

  if (req.amount < DUST_LIMIT) throw new Error(`金额过小，最少 ${DUST_LIMIT} grains`);

  const inputs: WalletUtxo[] = [];
  let total = 0n;
  for (const u of pool) {
    inputs.push(u);
    total += u.value;
    // try with change first
    const vWith = estimateVsize(inputs.length, 2);
    const feeWith = feeFor(vWith, feeRate);
    if (total >= req.amount + feeWith + DUST_LIMIT) {
      return { inputs: [...inputs], to: req.to, amount: req.amount, change: total - req.amount - feeWith, fee: feeWith, vsize: vWith, feeRate };
    }
    // otherwise without change, leftover goes to the miner
    const vNo = estimateVsize(inputs.length, 1);
    const feeNo = feeFor(vNo, feeRate);
    if (total >= req.amount + feeNo) {
      return { inputs: [...inputs], to: req.to, amount: req.amount, change: 0n, fee: total - req.amount, vsize: vNo, feeRate };
    }
  }
  throw new InsufficientFunds(req.amount + feeFor(estimateVsize(Math.max(pool.length, 1), 2), feeRate), available);
}

export interface SignedTx {
  hex: string;
  txid: string;
  vsize: number;
  fee: bigint;
}

/**
 * Build and sign. `keyFor` returns the 32-byte private key (zeroed here after use), the 33-byte
 * internal public key and the output script for a wallet path; `changeScript` is only used if plan.change > 0.
 */
export function signPlan(
  plan: TxPlan,
  net: PearlNetwork,
  keyFor: (branch: number, index: number) => { priv: Uint8Array; pub: Uint8Array; script: Uint8Array },
  changeScript: Uint8Array | null,
): SignedTx {
  const tx = new Transaction({ version: 1, lockTime: 0, allowUnknownOutputs: true });
  const keys: Uint8Array[] = [];
  try {
    for (const u of plan.inputs) {
      const k = keyFor(u.branch, u.index);
      keys.push(k.priv);
      tx.addInput({
        txid: u.txid,
        index: u.vout,
        sequence: 0xffffffff,
        witnessUtxo: { script: k.script, amount: u.value },
        tapInternalKey: k.pub.slice(1),
      });
    }
    tx.addOutput({ script: decodeAddress(plan.to, net).script, amount: plan.amount });
    if (plan.change > 0n) {
      if (!changeScript) throw new Error('missing change script');
      tx.addOutput({ script: changeScript, amount: plan.change });
    }
    keys.forEach((k, i) => {
      if (!tx.signIdx(k, i)) throw new Error(`无法签名输入 #${i}`);
    });
  } finally {
    keys.forEach(k => k.fill(0));
  }
  tx.finalize();

  const fee = tx.fee;
  if (fee !== plan.fee) throw new Error(`fee mismatch: ${fee} != ${plan.fee}`);
  if (tx.vsize !== plan.vsize) throw new Error(`vsize mismatch: ${tx.vsize} != ${plan.vsize}`);
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize, fee };
}
