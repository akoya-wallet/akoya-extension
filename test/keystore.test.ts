import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KDF, WrongPassword, decryptWallet, encryptWallet, reencryptWallet } from '../src/core/keystore.ts';

const FAST = { m: 1024, t: 1, p: 1 };
const meta = { name: 'w', network: 'mainnet' as const, mode: 'oyster' as const };
const secret = { secret: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', passphrase: '' };

test('vault: round-trip, wrong password, metadata tamper, re-encrypt', async () => {
  const f = await encryptWallet(meta, secret, 'correct horse', FAST);
  const json = JSON.stringify(f);
  assert.ok(!json.includes('abandon'), 'ciphertext must not contain plaintext');
  assert.equal(f.kdf.name, 'argon2id');
  assert.equal(f.cipher.name, 'AES-GCM');
  assert.deepEqual(await decryptWallet(f, 'correct horse'), secret);
  await assert.rejects(decryptWallet(f, 'nope'), WrongPassword);
  // clear-text metadata is bound as AEAD associated data
  await assert.rejects(decryptWallet({ ...f, network: 'testnet2' }, 'correct horse'), WrongPassword);
  await assert.rejects(decryptWallet({ ...f, mode: 'standard' }, 'correct horse'), WrongPassword);
  await assert.rejects(decryptWallet({ ...f, id: crypto.randomUUID() }, 'correct horse'), WrongPassword);
  const g = await reencryptWallet(f, 'correct horse', 'new pass 123');
  assert.equal(g.id, f.id);
  assert.notEqual(g.kdf.salt, f.kdf.salt);
  assert.deepEqual(await decryptWallet(g, 'new pass 123'), secret);
  await assert.rejects(decryptWallet(g, 'correct horse'), WrongPassword);
});

test('vault: default KDF is Argon2id with >= 64 MiB', () => {
  assert.ok(DEFAULT_KDF.m >= 64 * 1024 && DEFAULT_KDF.t >= 3);
});
