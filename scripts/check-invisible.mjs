#!/usr/bin/env node
// Gate: no invisible or bidirectional-control characters in source ("Trojan Source", CVE-2021-42574).
// Such characters can make code read differently from what it does, or hide in strings and regexes.
// Write them as explicit escapes or build them from code points (String.fromCodePoint) instead.
//
// Checked by code point, so this file needs none of the characters it looks for.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const ROOTS = ['src', 'test', 'scripts', 'nock/src', 'store/shots', 'public', '.github', 'vite.config.ts'];
const TEXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.sh', '.yml', '.yaml', '.toml', '.rs']);
// C0/C1 controls (except tab, LF, CR), zero-width and bidi controls, word joiner…invisible operators, BOM
const RANGES = [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];

function find(text) {
  const hits = [];
  let line = 1;
  let col = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    col++;
    if (cp === 0x0a) {
      line++;
      col = 0;
    } else if (RANGES.some(([a, b]) => cp >= a && cp <= b)) hits.push({ line, col, cp });
  }
  return hits;
}

// self-test: a broken gate must fail loudly, not pass silently
if (find(`ok${String.fromCodePoint(0x202e)}`).length !== 1 || find('plain\ttext\r\n').length !== 0) {
  console.error('GATE BROKEN: invisible-character check failed its self-test');
  process.exit(2);
}

const files = [];
const walk = p => {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) readdirSync(p).forEach(f => walk(join(p, f)));
  else if (TEXT.has(extname(p))) files.push(p);
};
ROOTS.forEach(walk);

let bad = 0;
for (const f of files) {
  for (const h of find(readFileSync(f, 'utf8'))) {
    console.error(`✖ ${f}:${h.line}:${h.col} invisible character U+${h.cp.toString(16).toUpperCase().padStart(4, '0')}`);
    bad++;
  }
}
if (bad) process.exit(1);
console.log(`✔ no invisible / bidi control characters (${files.length} files)`);
