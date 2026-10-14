# Contributing to Akoya

Thanks for helping! Akoya holds people's money, so the bar for changes is higher than usual.
Please read [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md) first.

## Ground rules

1. **Never commit a real recovery phrase, private key, xprv or password** — not in code, tests, docs,
   screenshots, issues or commit history. Use the public `abandon … about` phrase or fixtures from the
   official Pearl repo.
2. **Never report vulnerabilities in public issues.** Use GitHub Private Vulnerability Reporting.
3. **No hand-rolled cryptography.** Use the existing audited `@noble/*` / `@scure/*` primitives.
   The only exception is the documented oyster-compatibility step in `src/core/hd.ts`.
4. **No new runtime dependency without a one-line justification** in the PR description. Crypto-adjacent
   dependencies must be exact-pinned.
5. **No telemetry, analytics, remote config, or "phone home".** The only outbound traffic is user-initiated
   indexer RPC.
6. Chain constants (HRP, coin type, version bytes, indexer defaults) live **only** in
   `src/core/networks.ts`.

## Setup

Requires Node ≥ 22.18 (CI uses 24.11.1). Lifecycle scripts are disabled via `.npmrc`.

```bash
npm ci
```

```bash
npm test
```

```bash
npm run dev
```

Load `dist/` (after `npm run build`) as an unpacked extension in `chrome://extensions` to test the real extension.

## Before opening a PR

```bash
npm run typecheck && npm test && npm run security:gates && npm run build
```

- Derivation drift fails `test/derivation.test.ts`. If a vector changes, explain why in the PR — it almost
  certainly means user funds would move to different addresses.
- New behaviour in `src/core/` needs tests. Signing code must keep working offline (`test/offline-sign.test.ts`).
- UI text must never render indexer-supplied strings as HTML.

## Review policy

- Changes to `src/core/**`, `public/manifest.json`, `.npmrc`, `package-lock.json`, `.github/workflows/**`
  require maintainer review (enforced by `CODEOWNERS`) and green CI.
- Code generated with AI assistance is welcome but gets the same line-by-line review as any other code;
  "the tests pass" is not sufficient for key, derivation or signing paths.
- Dependabot PRs are reviewed by a human and never auto-merged.

## Commit style

Small, focused commits with an imperative subject line (`fix: reject indexer tokens outside account path`).
Sign off your commits (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/).

By contributing you agree that your contributions are licensed under the MIT License.
