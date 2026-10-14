// Derivation test vectors. Drift here must fail CI.
// Only public, well-known test seeds are used — never a real funded phrase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressBook, deriveAccount, parseSeed, privateKeyAt, seedBytes } from '../src/core/account.ts';
import { HARDENED, deriveChild, masterFromSeed } from '../src/core/hd.ts';
import { decodeAddress, taprootAddress } from '../src/core/address.ts';
import { fromHex, toHex } from '../src/core/encoding.ts';
import { NETWORKS, type PearlNetwork } from '../src/core/networks.ts';
import { ABANDON, ABANDON_VECTORS, LEADING_ZERO, WADDRMGR, WADDRMGR_SEED } from './vectors.ts';

test('vector: oyster waddrmgr fixture (mainnet m/86\'/808276\'/0\')', () => {
  const net = NETWORKS.mainnet;
  const acct = deriveAccount(fromHex(WADDRMGR_SEED), net, 'oyster');
  const book = new AddressBook(acct.xpub, net);
  for (const e of WADDRMGR) {
    assert.equal(book.get(e.b, e.i).address, e.addr, `address ${e.b}/${e.i}`);
    assert.equal(toHex(privateKeyAt(acct.accountPriv, e.b, e.i)), e.priv, `privkey ${e.b}/${e.i}`);
  }
});

for (const id of ['mainnet', 'testnet2'] as const) {
  test(`vector: "abandon … about" on ${id}`, async () => {
    const net = NETWORKS[id];
    const v = ABANDON_VECTORS[id];
    const acct = deriveAccount(await seedBytes(ABANDON), net, 'oyster');
    assert.equal(acct.xpub, v.xpub);
    assert.equal(acct.divergesFromBip32, false);
    const book = new AddressBook(acct.xpub, net);
    assert.equal(toHex(book.get(0, 0).pub), v.pub00);
    assert.equal(book.get(0, 0).address, v.r0);
    assert.equal(book.get(0, 1).address, v.r1);
    assert.equal(book.get(1, 0).address, v.c0);
  });
}

// 3) node/btcutil/hdkeychain/extendedkey_test.go TestLeadingZero — pins the DeriveNonStandard quirk.
test('vector: DeriveNonStandard vs BIP32 on a leading-zero key (hdkeychain TestLeadingZero)', () => {
  const seed = new Uint8Array(32);
  new DataView(seed.buffer).setUint32(28, 399, false);
  const versions = { public: NETWORKS.mainnet.xpubVersion, private: NETWORKS.mainnet.xprvVersion };
  const child0 = masterFromSeed(seed, versions).deriveChild(HARDENED);
  assert.equal(child0.privateKey![0], 0, 'child0 must have a leading zero byte');
  assert.equal(toHex(deriveChild(child0, HARDENED, 'standard').privateKey!), LEADING_ZERO.standard);
  assert.equal(toHex(deriveChild(child0, HARDENED, 'oyster').privateKey!), LEADING_ZERO.oyster);
});

test('vector: seed where oyster diverges from BIP32 on the Pearl account path', () => {
  const seed = new Uint8Array(32);
  new DataView(seed.buffer).setUint32(28, 273, false);
  const net = NETWORKS.mainnet;
  const oy = deriveAccount(seed, net, 'oyster');
  const std = deriveAccount(seed, net, 'standard');
  assert.equal(oy.divergesFromBip32, true);
  assert.equal(new AddressBook(oy.xpub, net).get(0, 0).address, 'prl1pef027x2phhwfannvfl3hmx4hg6w74vdg99uqgsghmnmm0q0zvh2qvs5443');
  assert.equal(new AddressBook(std.xpub, net).get(0, 0).address, 'prl1p46635ycpw7d32agc0ssqurjp9u2nq03laa0gh5m7n60g7y2fvt5qa9xpv7');
});

// 4) BIP86 reference vector with Bitcoin parameters — validates the generic pipeline.
test('vector: BIP86 (bitcoin params)', async () => {
  const btc: PearlNetwork = {
    ...NETWORKS.mainnet,
    hrp: 'bc',
    coinType: 0,
    xpubVersion: 0x0488b21e,
    xprvVersion: 0x0488ade4,
    signerNet: { bech32: 'bc', pubKeyHash: 0, scriptHash: 5, wif: 0x80 },
  };
  const acct = deriveAccount(await seedBytes(ABANDON), btc, 'standard');
  assert.equal(acct.xpub, 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ');
  const book = new AddressBook(acct.xpub, btc);
  assert.equal(book.get(0, 0).address, 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
  assert.equal(book.get(0, 1).address, 'bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh');
  assert.equal(book.get(1, 0).address, 'bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7');
});

test('seed parsing: hex seeds, normalization, bad input', () => {
  assert.equal(parseSeed(WADDRMGR_SEED).kind, 'hex');
  assert.equal(parseSeed(`  Abandon abandon\tabandon abandon abandon abandon\nabandon abandon abandon abandon abandon ABOUT `).kind, 'mnemonic');
  assert.equal(parseSeed(ABANDON.replace('about', 'abandon')).kind, 'invalid'); // checksum
  assert.equal(parseSeed('abandon abandon abandon').kind, 'invalid');
  const r = parseSeed('foo bar baz qux quux corge grault garply waldo fred plugh xyzzy');
  assert.equal(r.kind, 'invalid');
  assert.ok(r.kind === 'invalid' && !r.reason.includes('foo'), 'error messages must not echo seed words');
});

test('AddressBook refuses private keys and out-of-range paths', () => {
  const acct = deriveAccount(fromHex(WADDRMGR_SEED), NETWORKS.mainnet, 'oyster');
  assert.throws(() => new AddressBook(acct.accountPriv, NETWORKS.mainnet));
  const book = new AddressBook(acct.xpub, NETWORKS.mainnet);
  assert.throws(() => book.get(2, 0));
  assert.throws(() => book.get(0, 1e9));
});

test('address decoding validates checksum, hrp and witness version', () => {
  const net = NETWORKS.mainnet;
  const d = decodeAddress('prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na', net);
  assert.equal(d.type, 'taproot');
  assert.equal(d.script[0], 0x51);
  assert.throws(() => decodeAddress('tprl1pmxa4c2w8cp6dq0j65sm4ha5qglr83xuwqhjlnzgr9etj8l9n5rrqgkhc6a', net), /前缀/);
  assert.throws(() => decodeAddress('prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4nb', net)); // checksum
  assert.equal(decodeAddress('tprl1pmxa4c2w8cp6dq0j65sm4ha5qglr83xuwqhjlnzgr9etj8l9n5rrqgkhc6a', NETWORKS.testnet2).type, 'taproot');
  const { address } = taprootAddress(fromHex('02af08f3d1bb1ccaed1659e88b5a8d73f412628e44ddcbcbdc54b6b81f20c31375'), net);
  assert.equal(address, 'prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na');
});
