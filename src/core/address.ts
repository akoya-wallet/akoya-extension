// Pearl addresses are all segwit v1+ and bech32m encoded (node/btcutil/address.go).
// Standard output types (node/txscript/standard.go GetScriptClass):
//   v1 + 32 bytes  -> Taproot           script: OP_1 OP_DATA_32 <x-only key>
//   v2 + 32 bytes  -> P2MR (BIP 360)    script: OP_2 OP_DATA_32 <merkle root>
// Wallet addresses are BIP86 key-path-only Taproot, like oyster's default scope.

import { p2tr } from '@scure/btc-signer';
import { bech32m } from './encoding.ts';
import { WalletError } from './errors.ts';
import type { PearlNetwork } from './networks.ts';

export interface DecodedAddress {
  version: 1 | 2;
  program: Uint8Array;
  script: Uint8Array;
  type: 'taproot' | 'p2mr';
}

/** BIP86 address for a 33-byte compressed internal public key. */
export function taprootAddress(internalPub33: Uint8Array, net: PearlNetwork): { address: string; script: Uint8Array } {
  const pay = p2tr(internalPub33.slice(1), undefined, net.signerNet);
  return { address: pay.address!, script: pay.script };
}

export function decodeAddress(addr: string, net: PearlNetwork): DecodedAddress {
  const s = addr.trim();
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) throw new WalletError('address.mixed_case');
  let dec;
  try {
    dec = bech32m.decode(s.toLowerCase() as `${string}1${string}`, 120);
  } catch {
    throw new WalletError('address.invalid');
  }
  if (dec.prefix !== net.hrp) throw new WalletError('address.wrong_network', { hrp: net.hrp, network: net.label });
  const [version, ...rest] = dec.words;
  const program = bech32m.fromWords(rest);
  if (version !== 1 && version !== 2) throw new WalletError('address.unsupported_version', { version });
  if (program.length !== 32) throw new WalletError('address.bad_length');
  const script = new Uint8Array(34);
  script[0] = version === 1 ? 0x51 : 0x52; // OP_1 / OP_2
  script[1] = 0x20;
  script.set(program, 2);
  return { version, program, script, type: version === 1 ? 'taproot' : 'p2mr' };
}

export function isValidAddress(addr: string, net: PearlNetwork): boolean {
  try {
    decodeAddress(addr, net);
    return true;
  } catch {
    return false;
  }
}
