#!/usr/bin/env node
// Audits the built extension (dist/) before it can be packaged or released:
//   - manifest permissions/CSP are exactly what PERMISSIONS.md documents
//   - no source maps, no unexpected file types, no inline or remote scripts
//   - the JS bundle has no eval / new Function / remote script loading / dev hooks / local paths
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const errors = [];
const fail = msg => errors.push(msg);
const same = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());

// ---- manifest policy
const m = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
if (m.manifest_version !== 3) fail('manifest_version must be 3');
if (!same(m.permissions, ['storage'])) fail(`permissions must be exactly ["storage"], got ${JSON.stringify(m.permissions)}`);
if (!same(m.host_permissions, ['https://blockbook.pearlresearch.ai/*', 'https://blockbook.testnet.pearlresearch.ai/*'])) {
  fail(`host_permissions changed: ${JSON.stringify(m.host_permissions)} — update PERMISSIONS.md and this audit together`);
}
if (!same(m.optional_host_permissions, ['https://*/*'])) fail(`optional_host_permissions changed: ${JSON.stringify(m.optional_host_permissions)}`);
for (const key of ['content_scripts', 'background', 'externally_connectable', 'web_accessible_resources', 'declarative_net_request', 'sandbox', 'chrome_url_overrides', 'devtools_page', 'oauth2', 'key', 'update_url']) {
  if (key in m) fail(`manifest must not declare "${key}"`);
}
const csp = m.content_security_policy?.extension_pages ?? '';
if (!csp) fail('missing content_security_policy.extension_pages');
for (const bad of ["'unsafe-eval'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'http:', ' * ', "'unsafe-hashes'"]) {
  if (csp.includes(bad)) fail(`CSP contains ${bad}`);
}
const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1]?.trim();
if (scriptSrc !== "'self'") fail(`CSP script-src must be exactly 'self', got "${scriptSrc}"`);
if (!/object-src 'none'/.test(csp)) fail("CSP must set object-src 'none'");

// ---- files
const files = [];
const walk = d => readdirSync(d).forEach(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(DIST);
const ALLOWED_EXT = new Set(['.html', '.js', '.css', '.json', '.png']);
for (const f of files) {
  if (!ALLOWED_EXT.has(extname(f))) fail(`unexpected file type in dist: ${f}`);
  if (f.endsWith('.map')) fail(`source map in dist: ${f}`);
}

// ---- html: only the bundled module script, no inline code, no remote resources
// Parsed by opening tag (no closing-tag regex): every <script …> must be exactly the Vite module
// entry, immediately closed, and nothing else may load code or remote resources.
const ENTRY = /^<script type="module" crossorigin src="\.\/assets\/[\w.-]+\.js">$/;
for (const f of files.filter(f => f.endsWith('.html'))) {
  const html = readFileSync(f, 'utf8');
  const lower = html.toLowerCase();
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!ENTRY.test(m[0])) fail(`${f}: unexpected script tag ${m[0].slice(0, 100)}`);
    if (!lower.startsWith('</script>', m.index + m[0].length)) fail(`${f}: script tag is not empty`);
  }
  for (const tag of ['<iframe', '<object', '<embed', '<base', '<meta http-equiv="refresh"']) {
    if (lower.includes(tag)) fail(`${f}: contains ${tag}`);
  }
  if (/\s(src|href|action)\s*=\s*["']?\s*(https?:)?\/\//i.test(html)) fail(`${f}: references a remote resource`);
  if (/\son[a-z]+\s*=/i.test(html)) fail(`${f}: inline event handler`);
  if (/javascript:/i.test(html)) fail(`${f}: javascript: URL`);
}

// ---- js bundle
const JS_RULES = [
  [/\beval\s*\(/, 'eval('],
  [/\bnew\s+Function\s*\(/, 'new Function('],
  [/\bimportScripts\s*\(/, 'importScripts('],
  [/createElement\(\s*["'`]script["'`]\s*\)/g, 'dynamic <script> creation'],
  [/sourceMappingURL=/, 'sourceMappingURL'],
  [/__bb\//, 'dev indexer proxy path'],
  [/localhost:\d+/, 'localhost URL'],
  [/\/Users\/|\/home\/runner\/|C:\\\\Users\\\\/, 'absolute local path'],
  [/https?:\/\/(?!www\.w3\.org\/|blockbook\.pearlresearch\.ai|blockbook\.testnet\.pearlresearch\.ai|github\.com\/akoya-wallet\/|reactjs\.org\/docs\/error-decoder|react\.dev\/errors\/|[a-z0-9-]+\.example\b)[a-z0-9.-]+\.[a-z]{2,}/i, 'unexpected remote URL'],
];
// Known, reviewed occurrences inside third-party code. A ratchet: any *new* occurrence fails.
const ALLOWED_COUNTS = new Map([
  // react-dom 19 `hoistableScripts` (preinit, preinitModule, <script async> hoisting) — 3 sites.
  // Unused by the app and inert under script-src 'self'. Re-review when upgrading React.
  ['dynamic <script> creation', 3],
]);
let jsBytes = 0;
for (const f of files.filter(f => f.endsWith('.js'))) {
  const js = readFileSync(f, 'utf8');
  jsBytes += js.length;
  for (const [re, what] of JS_RULES) {
    const hits = [...js.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
    if (hits.length > (ALLOWED_COUNTS.get(what) ?? 0)) {
      const h = hits[hits.length - 1];
      fail(`${f}: ${what} ×${hits.length} — …${js.slice(Math.max(0, h.index - 40), h.index + 60)}…`);
    }
  }
}
if (jsBytes > 1_500_000) fail(`JS bundle grew to ${jsBytes} bytes (limit 1.5 MB) — review new dependencies`);

if (errors.length) {
  console.error(`✖ dist audit: ${errors.length} issue(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ dist audit (${files.length} files, ${(jsBytes / 1024).toFixed(0)} KiB JS)`);
