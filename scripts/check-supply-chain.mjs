#!/usr/bin/env node
// Supply-chain policy for package.json / package-lock.json. Fails CI on any violation.
//   1. every direct dependency is pinned to an exact version
//   2. every locked package comes from registry.npmjs.org with a sha512 integrity hash
//   3. lifecycle scripts are disabled (.npmrc) and packages that declare install scripts are allow-listed
//   4. licences: production deps must be permissive; nothing copyleft anywhere
import { readFileSync } from 'node:fs';

const errors = [];
const fail = msg => errors.push(msg);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const npmrc = readFileSync('.npmrc', 'utf8');

// 1. exact pins
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const [name, range] of Object.entries(pkg[field] ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(range)) fail(`${field}.${name} must be an exact version, got "${range}"`);
  }
}

// 2. provenance of every locked package
if (lock.lockfileVersion !== 3) fail(`lockfileVersion must be 3, got ${lock.lockfileVersion}`);
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path || meta.link) continue;
  if (!meta.resolved?.startsWith('https://registry.npmjs.org/')) fail(`${path}: not resolved from registry.npmjs.org (${meta.resolved})`);
  if (!meta.integrity?.startsWith('sha512-')) fail(`${path}: missing sha512 integrity`);
}

// 3. install scripts
if (!/^ignore-scripts=true$/m.test(npmrc)) fail('.npmrc must set ignore-scripts=true');
// These ship install scripts that never run here (ignore-scripts); they work without them:
const INSTALL_SCRIPT_ALLOWLIST = new Map([
  ['node_modules/fsevents', 'optional macOS file watcher used by Vite in dev only'],
  ['node_modules/vite/node_modules/esbuild', 'postinstall only validates the platform binary, which npm installs as an optional dependency'],
]);
for (const [path, meta] of Object.entries(lock.packages)) {
  if (meta.hasInstallScript && !INSTALL_SCRIPT_ALLOWLIST.has(path)) fail(`${path} declares an install script and is not allow-listed`);
}

// 4. licences
const PERMISSIVE = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|CC0-1\.0|Unlicense|BlueOak-1\.0\.0|\(MIT OR Apache-2\.0\)|MIT OR Apache-2\.0)$/;
const DEV_EXTRA = /^(CC-BY-4\.0|Python-2\.0)$/; // data-only licences seen in build tooling (caniuse-lite, argparse)
const COPYLEFT = /GPL|AGPL|LGPL|SSPL|EUPL|MPL|CDDL|OSL|EPL/i;
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path) continue;
  const lic = meta.license ?? 'UNKNOWN';
  if (COPYLEFT.test(lic)) fail(`${path}: copyleft licence ${lic}`);
  else if (!meta.dev && !PERMISSIVE.test(lic)) fail(`${path}: production dependency licence "${lic}" is not on the allow-list`);
  else if (meta.dev && !PERMISSIVE.test(lic) && !DEV_EXTRA.test(lic)) fail(`${path}: dev dependency licence "${lic}" is not on the allow-list`);
}

const prod = Object.entries(lock.packages).filter(([p, m]) => p && !m.dev).map(([p]) => p.replace(/^.*node_modules\//, ''));
console.log(`production packages (${prod.length}): ${prod.join(', ')}`);

if (errors.length) {
  console.error(`✖ supply-chain policy: ${errors.length} violation(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('✔ supply-chain policy');
