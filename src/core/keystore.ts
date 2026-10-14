// Encrypted vault entry. Password -> Argon2id (@noble/hashes) -> AES-256-GCM (WebCrypto).
// Works in extension pages, service workers and Node (globalThis.crypto).
// Nothing about the wallet — secret, passphrase, xpub — is readable without the password;
// only name/network/mode stay in clear so the wallet picker can render.

import { argon2idAsync } from '@noble/hashes/argon2.js';
import { base64 } from '@scure/base';
import { WalletError } from './errors.ts';
import type { DerivationMode } from './hd.ts';
import type { NetworkId } from './networks.ts';

export interface WalletSecret {
  /** normalized BIP39 mnemonic or hex seed */
  secret: string;
  /** optional BIP39 passphrase ("25th word"); oyster always uses "" */
  passphrase: string;
}

export interface KdfParams {
  m: number; // KiB
  t: number;
  p: number;
}

export interface VaultEntry {
  version: 1;
  id: string;
  name: string;
  network: NetworkId;
  mode: DerivationMode;
  createdAt: string;
  kdf: { name: 'argon2id'; salt: string } & KdfParams;
  cipher: { name: 'AES-GCM'; iv: string; data: string };
}

/** RFC 9106 §4 second recommended option, with p=1 for single-threaded JS. */
export const DEFAULT_KDF: KdfParams = { m: 64 * 1024, t: 3, p: 1 };

const te = new TextEncoder();
const td = new TextDecoder();
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
/** decode into a fresh ArrayBuffer-backed view (WebCrypto's BufferSource type) */
const b64 = (s: string) => Uint8Array.from(base64.decode(s));

async function deriveAesKey(password: string, salt: Uint8Array, kdf: KdfParams): Promise<CryptoKey> {
  const pw = te.encode(password.normalize('NFKC'));
  const raw = await argon2idAsync(pw, salt, { ...kdf, dkLen: 32 });
  pw.fill(0);
  try {
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

/** Associated data binds the clear-text metadata to the ciphertext. */
const aad = (e: Pick<VaultEntry, 'id' | 'network' | 'mode'>) => te.encode(`pearl-wallet/vault/v1/${e.id}/${e.network}/${e.mode}`);

export async function encryptWallet(
  meta: { name: string; network: NetworkId; mode: DerivationMode; id?: string; createdAt?: string },
  secret: WalletSecret,
  password: string,
  kdf: KdfParams = DEFAULT_KDF,
): Promise<VaultEntry> {
  const salt = rand(16);
  const iv = rand(12);
  const id = meta.id ?? crypto.randomUUID();
  const key = await deriveAesKey(password, salt, kdf);
  const plain = te.encode(JSON.stringify(secret));
  try {
    const data = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad({ id, ...meta }) }, key, plain),
    );
    return {
      version: 1,
      id,
      name: meta.name,
      network: meta.network,
      mode: meta.mode,
      createdAt: meta.createdAt ?? new Date().toISOString(),
      kdf: { name: 'argon2id', salt: base64.encode(salt), ...kdf },
      cipher: { name: 'AES-GCM', iv: base64.encode(iv), data: base64.encode(data) },
    };
  } finally {
    plain.fill(0);
  }
}

export class WrongPassword extends WalletError {
  constructor() {
    super('vault.wrong_password');
    this.name = 'WrongPassword';
  }
}

export async function decryptWallet(entry: VaultEntry, password: string): Promise<WalletSecret> {
  const key = await deriveAesKey(password, b64(entry.kdf.salt), entry.kdf);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64(entry.cipher.iv), additionalData: aad(entry) },
        key,
        b64(entry.cipher.data),
      ),
    );
  } catch {
    throw new WrongPassword();
  }
  try {
    return JSON.parse(td.decode(plain)) as WalletSecret;
  } finally {
    plain.fill(0);
  }
}

export async function reencryptWallet(entry: VaultEntry, oldPassword: string, newPassword: string): Promise<VaultEntry> {
  const secret = await decryptWallet(entry, oldPassword);
  return encryptWallet(entry, secret, newPassword, { m: entry.kdf.m, t: entry.kdf.t, p: entry.kdf.p });
}

/** Minimal password policy for the vault. Returns an error code or null. */
export function passwordProblem(pw: string): 'password.too_short' | 'password.too_simple' | null {
  if (pw.length < 8) return 'password.too_short';
  if (/^(.)\1+$/.test(pw)) return 'password.too_simple';
  return null;
}
