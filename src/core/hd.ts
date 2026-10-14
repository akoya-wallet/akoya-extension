// BIP32 via the audited @scure/bip32, plus the one deviation needed to match oyster.
//
// Oyster (Pearl's btcwallet fork, wallet/waddrmgr/manager.go) derives with
// hdkeychain.DeriveNonStandard. For a hardened child it builds the HMAC input as
// 0x00 || key || ser32(i) where `key` is the parent private key with leading zero
// bytes stripped (big.Int.Bytes()) and copied at offset 1 — i.e. left-aligned.
// That only differs from BIP32 when a non-master parent private key starts with
// 0x00 (~1/256 per hardened level). Non-hardened steps are identical.
// See node/btcutil/hdkeychain/extendedkey.go (DeriveNonStandard, TestLeadingZero).

import { HDKey, HARDENED_OFFSET, type Versions } from '@scure/bip32';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';

export type DerivationMode = 'oyster' | 'standard';
export { HDKey, HARDENED_OFFSET as HARDENED };

const N = secp256k1.Point.Fn.ORDER;

/** True when oyster's derivation of a hardened child of `parent` diverges from BIP32. */
export const divergesAtHardenedChild = (parent: HDKey) =>
  parent.depth > 0 && parent.privateKey !== null && parent.privateKey[0] === 0;

function nonStandardHardenedChild(parent: HDKey, index: number): HDKey {
  const priv = parent.privateKey!;
  let z = 0;
  while (z < priv.length && priv[z] === 0) z++;
  const data = new Uint8Array(37);
  data.set(priv.subarray(z), 1); // left-aligned stripped key, trailing slot bytes stay zero
  new DataView(data.buffer).setUint32(33, index >>> 0, false);
  const I = hmac(sha512, parent.chainCode!, data);
  try {
    const il = bytesToNumberBE(I.subarray(0, 32));
    if (il === 0n || il >= N) throw new Error(`invalid child at index ${index}`);
    const child = (il + bytesToNumberBE(priv)) % N;
    if (child === 0n) throw new Error(`invalid child at index ${index}`);
    return new HDKey({
      versions: parent.versions,
      depth: parent.depth + 1,
      index,
      parentFingerprint: parent.fingerprint,
      chainCode: I.slice(32),
      privateKey: numberToBytesBE(child, 32),
    });
  } finally {
    I.fill(0);
    data.fill(0);
  }
}

export function deriveChild(parent: HDKey, index: number, mode: DerivationMode): HDKey {
  if (mode === 'oyster' && index >= HARDENED_OFFSET && divergesAtHardenedChild(parent)) {
    return nonStandardHardenedChild(parent, index);
  }
  return parent.deriveChild(index);
}

export function masterFromSeed(seed: Uint8Array, versions: Versions): HDKey {
  return HDKey.fromMasterSeed(seed, versions);
}

/** Public-only copy (the private key never leaves the original object). */
export const neuter = (k: HDKey) => HDKey.fromExtendedKey(k.publicExtendedKey, k.versions);
