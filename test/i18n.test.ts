// Every error code thrown by core/ext must have a translation, in every language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/i18n/en.ts';
import zhCN from '../src/i18n/zh-CN.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? sourceFiles(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [join(dir, d.name)] : [],
  );
}

test('every WalletError / SeedProblem / passwordProblem code has en + zh-CN text', () => {
  const codes = new Set<string>();
  for (const f of sourceFiles('src')) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:WalletError|BlockbookError)\(\s*'([a-z_]+\.[a-z_]+)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/super\('([a-z_]+\.[a-z_]+)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/code: '([a-z_]+\.[a-z_]+)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/return '(password\.[a-z_]+)'/g)) codes.add(m[1]);
    for (const m of s.matchAll(/new WalletError\(c\.immature > 0n \? '([a-z_.]+)' : '([a-z_.]+)'/g)) { codes.add(m[1]); codes.add(m[2]); }
  }
  assert.ok(codes.size > 30, `found ${codes.size} codes`);
  const missing = [...codes].filter(c => !(`err.${c}` in en) || !(`err.${c}` in zhCN));
  assert.deepEqual(missing, []);
});

test('no UI source file contains hard-coded CJK text (all copy lives in src/i18n)', () => {
  const offenders = sourceFiles('src')
    .filter(f => !f.startsWith(join('src', 'i18n')))
    .filter(f => /[一-鿿]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('placeholders match between languages', () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  const bad = (Object.keys(en) as (keyof typeof en)[]).filter(k => vars(en[k]) !== vars(zhCN[k]));
  assert.deepEqual(bad, []);
});
