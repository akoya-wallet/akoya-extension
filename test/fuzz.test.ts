// Property-based fuzzing (fast-check) of every parser that sees untrusted input:
// addresses and amounts typed or pasted by the user, recovery phrases, and indexer responses.
// Invariants: never crash with anything but a typed error, never accept garbage, round-trip exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { decodeAddress, isValidAddress } from '../src/core/address.ts';
import { parseSeed } from '../src/core/account.ts';
import { Blockbook, BlockbookError, parseTokenPath } from '../src/core/blockbook.ts';
import { WalletError } from '../src/core/errors.ts';
import { bech32m } from '../src/core/encoding.ts';
import { NETWORKS } from '../src/core/networks.ts';
import { formatPrl, parsePrl } from '../src/ext/format.ts';

const RUNS = { numRuns: 2000 };
const net = NETWORKS.mainnet;
const typedOnly = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof WalletError, `untyped error: ${String(e)}`);
  }
};

test('fuzz: decodeAddress only throws WalletError, and accepts only canonical 32-byte v1/v2 programs', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 120 }), s => {
      typedOnly(() => decodeAddress(s, net));
    }),
    RUNS,
  );
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 16 }), fc.uint8Array({ minLength: 0, maxLength: 40 }), (v, prog) => {
      const addr = bech32m.encode('prl', [v, ...bech32m.toWords(prog)], 120);
      const ok = (v === 1 || v === 2) && prog.length === 32;
      assert.equal(isValidAddress(addr, net), ok);
      if (ok) assert.deepEqual(decodeAddress(addr, net).program, prog);
    }),
    RUNS,
  );
});

test('fuzz: a single-character change to a valid address is always rejected', () => {
  const valid = 'prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na';
  const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  fc.assert(
    fc.property(fc.integer({ min: 4, max: valid.length - 1 }), fc.constantFrom(...charset), (i, c) => {
      fc.pre(valid[i] !== c);
      assert.equal(isValidAddress(valid.slice(0, i) + c + valid.slice(i + 1), net), false);
    }),
    RUNS,
  );
});

test('fuzz: parsePrl / formatPrl round-trip exactly and reject everything else', () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: 21_000_000_000n * 100_000_000n }), g => {
      assert.equal(parsePrl(formatPrl(g, { group: false })), g);
      assert.equal(parsePrl(formatPrl(g)), g); // with thousands separators
    }),
    RUNS,
  );
  fc.assert(
    fc.property(fc.string({ maxLength: 40 }), s => {
      typedOnly(() => parsePrl(s));
    }),
    RUNS,
  );
  for (const bad of ['-1', '1e5', '0x10', '1.123456789', 'Infinity', 'NaN', '１', '1..2', ' . ']) {
    assert.throws(() => parsePrl(bad), WalletError, bad);
  }
});

test('fuzz: formatPrl with maxDecimals never rounds up', () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: 10n ** 18n }), fc.integer({ min: 0, max: 8 }), (g, d) => {
      const shown = parsePrl(formatPrl(g, { group: false, maxDecimals: d }));
      assert.ok(shown <= g);
      assert.ok(g - shown < 10n ** BigInt(8 - d));
    }),
    RUNS,
  );
});

test('fuzz: parseSeed never throws and never echoes input words in its reason', () => {
  fc.assert(
    fc.property(fc.array(fc.stringMatching(/^[a-z]{3,10}$/), { minLength: 1, maxLength: 26 }), words => {
      const r = parseSeed(words.join(' '));
      if (r.kind === 'invalid') assert.ok(!words.some(w => JSON.stringify(r.reason).includes(w)));
    }),
    RUNS,
  );
  fc.assert(fc.property(fc.string({ maxLength: 300 }), s => void parseSeed(s)), RUNS);
});

test('fuzz: token paths outside our account prefix or range are rejected', () => {
  const pre = "m/86'/808276'/0'";
  fc.assert(
    fc.property(fc.string({ maxLength: 40 }), tail => {
      const p = parseTokenPath(pre + tail, pre);
      if (p) assert.ok(p.branch >= 0 && p.branch < 100 && p.index >= 0 && p.index < 1_000_000);
    }),
    RUNS,
  );
});

test('fuzz: hostile indexer JSON is rejected with BlockbookError, never crashes', async () => {
  const json = fc.jsonValue({ maxDepth: 4 });
  await fc.assert(
    fc.asyncProperty(json, async body => {
      const bb = new Blockbook('https://indexer.example', async () => new Response(JSON.stringify(body), { status: 200 }));
      for (const call of [() => bb.status(), () => bb.utxos('x'), () => bb.xpub('x', {}), () => bb.estimateFee(1), () => bb.broadcast('00')]) {
        try {
          await call();
        } catch (e) {
          assert.ok(e instanceof BlockbookError, `untyped error: ${String(e)}`);
        }
      }
    }),
    { numRuns: 500 },
  );
});
