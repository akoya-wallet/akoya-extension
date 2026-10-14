import { sha256 } from '@noble/hashes/sha2.js';
import { createBase58check, bech32m, hex } from '@scure/base';

export const base58check = createBase58check(sha256);
export { bech32m, hex };

export const toHex = (b: Uint8Array) => hex.encode(b);
export const fromHex = (s: string) => hex.decode(s);

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
