// Seed handling mirrors oyster's walletsetup.go:
//   * BIP39 English mnemonic -> bip39.NewSeed(mnemonic, "")  (PBKDF2-SHA512, 2048 rounds)
//   * or a raw hex seed of 16..64 bytes used directly as the BIP32 seed
// Account path: m/86'/<coin>'/0', receive branch 0, change branch 1.

import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HARDENED, HDKey, deriveChild, divergesAtHardenedChild, masterFromSeed, neuter, type DerivationMode } from './hd.ts';
import { taprootAddress } from './address.ts';
import { fromHex } from './encoding.ts';
import { ACCOUNT, PURPOSE_BIP86, bip32Versions, type PearlNetwork } from './networks.ts';

export const VALID_WORD_COUNTS = [12, 15, 18, 21, 24];
/** Hard upper bound for any address index we derive (guards against indexer-supplied paths). */
export const MAX_ADDRESS_INDEX = 100_000;

export type ParsedSeed =
  | { kind: 'mnemonic'; normalized: string; wordCount: number }
  | { kind: 'hex'; normalized: string }
  | { kind: 'invalid'; reason: string };

export const normalizeMnemonic = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');

export function parseSeed(raw: string): ParsedSeed {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'invalid', reason: '请输入助记词' };

  if (!/\s/.test(trimmed)) {
    const h = trimmed.toLowerCase().replace(/^0x/, '');
    if (/^[0-9a-f]+$/.test(h)) {
      if (h.length % 2) return { kind: 'invalid', reason: 'Hex 种子长度必须为偶数' };
      if (h.length / 2 < 16 || h.length / 2 > 64) return { kind: 'invalid', reason: 'Hex 种子必须为 128~512 位' };
      return { kind: 'hex', normalized: h };
    }
    return { kind: 'invalid', reason: '请输入 12/15/18/21/24 个英文助记词，或 hex 种子' };
  }

  const normalized = normalizeMnemonic(trimmed);
  const words = normalized.split(' ');
  if (!VALID_WORD_COUNTS.includes(words.length)) {
    return { kind: 'invalid', reason: `助记词应为 12/15/18/21/24 个单词（当前 ${words.length} 个）` };
  }
  const unknown = words.findIndex(w => !wordlist.includes(w));
  // report the position, never echo the word itself
  if (unknown >= 0) return { kind: 'invalid', reason: `第 ${unknown + 1} 个单词不在 BIP39 英文词表中` };
  if (!validateMnemonic(normalized, wordlist)) {
    return { kind: 'invalid', reason: '助记词校验和不正确，请检查单词顺序和拼写' };
  }
  return { kind: 'mnemonic', normalized, wordCount: words.length };
}

/** CSPRNG-backed (crypto.getRandomValues via @noble/hashes). Oyster creates 12 words. */
export function newMnemonic(words: 12 | 24 = 12): string {
  return generateMnemonic(wordlist, words === 24 ? 256 : 128);
}

/** Caller owns the returned buffer and should zero it after use. */
export async function seedBytes(secret: string, passphrase = ''): Promise<Uint8Array> {
  const p = parseSeed(secret);
  if (p.kind === 'mnemonic') return mnemonicToSeed(p.normalized, passphrase);
  if (p.kind === 'hex') return fromHex(p.normalized);
  throw new Error(p.reason);
}

export const accountPath = (net: PearlNetwork) => [PURPOSE_BIP86 + HARDENED, net.coinType + HARDENED, ACCOUNT + HARDENED];
export const accountPathString = (net: PearlNetwork) => `m/${PURPOSE_BIP86}'/${net.coinType}'/${ACCOUNT}'`;

export interface AccountKeys {
  /** account-level private key — wipe with wipePrivateData() when done */
  accountPriv: HDKey;
  accountPub: HDKey;
  xpub: string;
  /** whether oyster's non-standard derivation diverged from BIP32 for this seed */
  divergesFromBip32: boolean;
}

export function deriveAccount(seed: Uint8Array, net: PearlNetwork, mode: DerivationMode): AccountKeys {
  const master = masterFromSeed(seed, bip32Versions(net));
  let k = master;
  let diverges = false;
  const chain: HDKey[] = [];
  for (const i of accountPath(net)) {
    if (divergesAtHardenedChild(k)) diverges = true;
    k = deriveChild(k, i, mode);
    chain.push(k);
  }
  const accountPub = neuter(k);
  master.wipePrivateData();
  chain.slice(0, -1).forEach(c => c.wipePrivateData());
  return { accountPriv: k, accountPub, xpub: accountPub.publicExtendedKey, divergesFromBip32: mode === 'oyster' && diverges };
}

export interface DerivedAddress {
  address: string;
  script: Uint8Array;
  /** 33-byte compressed internal key */
  pub: Uint8Array;
}

/** Derives receive/change addresses from the account xpub only. Non-hardened, so mode does not matter here. */
export class AddressBook {
  private branches = new Map<number, HDKey>();
  private cache = new Map<string, DerivedAddress>();
  private accountPub: HDKey;
  private net: PearlNetwork;
  constructor(xpubOrKey: string | HDKey, net: PearlNetwork) {
    this.net = net;
    this.accountPub = typeof xpubOrKey === 'string' ? HDKey.fromExtendedKey(xpubOrKey, bip32Versions(net)) : xpubOrKey;
    if (this.accountPub.privateKey) throw new Error('AddressBook must be built from a public key');
  }

  get(branch: number, index: number): DerivedAddress {
    if ((branch !== 0 && branch !== 1) || !Number.isInteger(index) || index < 0 || index > MAX_ADDRESS_INDEX) {
      throw new Error(`refusing to derive path ${branch}/${index}`);
    }
    const key = `${branch}/${index}`;
    let hit = this.cache.get(key);
    if (!hit) {
      let b = this.branches.get(branch);
      if (!b) this.branches.set(branch, (b = this.accountPub.deriveChild(branch)));
      const pub = b.deriveChild(index).publicKey!;
      hit = { ...taprootAddress(pub, this.net), pub };
      this.cache.set(key, hit);
    }
    return hit;
  }
}

/** Private key for branch/index (32 bytes). Caller must zero it. */
export function privateKeyAt(accountPriv: HDKey, branch: number, index: number): Uint8Array {
  const br = accountPriv.deriveChild(branch);
  const leaf = br.deriveChild(index);
  const out = Uint8Array.from(leaf.privateKey!);
  leaf.wipePrivateData();
  br.wipePrivateData();
  return out;
}
