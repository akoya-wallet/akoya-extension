# CI/CD security pipeline

Every push to `main`, every pull request, a weekly schedule, and every release tag run the full
gate in [`.github/workflows/security.yml`](../.github/workflows/security.yml). A release is only
published if the gate passes **and** the release build is byte-identical to the gate's build.

```
push / PR / weekly ─► ci.yml ─────────┐
                                       ├─► security.yml ─► workflow-lint · supply-chain · secrets · verify ─► reproducible (macOS)
tag vX.Y.Z ────────► release.yml ─────┘                                                             │
                         └─► publish (needs security) ─► rebuild == gate zip ─► SBOM ─► provenance + SBOM attestations ─► GitHub release
PR ────────────────► dependency-review.yml      push / PR / weekly ─► codeql.yml      push / weekly ─► scorecard.yml
```

| Job | What it enforces |
|---|---|
| **workflow-lint** | `actionlint` (+ shellcheck) and `zizmor --persona=pedantic` on every workflow: no template injection, no excessive permissions, no credential persistence, no unpinned actions, documented permissions, concurrency limits |
| **supply-chain** | `scripts/check-supply-chain.mjs` (exact pins, registry-only + sha512 lockfile, install-script allow-list, licence allow-list) · `npm audit --audit-level=low` · `npm audit signatures` (registry signatures + provenance) · OSV-Scanner |
| **secrets** | gitleaks over **all refs and full history** (public test vectors are allow-listed in `.gitleaks.toml`) |
| **verify** | security grep gates · strict typecheck · derivation vectors + all unit tests · signing tests inside a **network namespace with no network** · build · `scripts/audit-dist.mjs` (exact manifest permissions, CSP without unsafe-*, no source maps / eval / remote scripts / dev hooks / local paths) · deterministic zip + SHA-256 · test build uploaded as an artifact |
| **reproducible** | rebuild on macOS; the zip must be byte-identical to the Linux build |
| **codeql** | CodeQL `security-extended` + `security-and-quality` for TypeScript and GitHub Actions |
| **dependency-review** | PRs may not add a dependency with any known vulnerability or a non-allow-listed licence |
| **scorecard** | OpenSSF Scorecard supply-chain posture, published + uploaded to code scanning |
| **publish** (release only) | tag == manifest == package version · rebuild must equal the gate's zip · CycloneDX SBOM · SLSA build provenance + SBOM attestations (Sigstore) · pre-release for 0.x |

Hardening applied to every job:

- **Egress blocked** by Harden-Runner — each job lists the only hosts it may reach.
- `permissions: {}` at workflow level; each job gets the minimum, with a comment explaining why.
- Actions pinned to full commit SHAs; tool binaries (actionlint, zizmor, OSV-Scanner, gitleaks)
  downloaded at fixed versions and **checksum-verified** before running.
- No dependency caches (prevents cache poisoning); `npm ci` with lifecycle scripts disabled.
- Tool and action versions are chosen ≥ 2 weeks after release; Dependabot proposes updates, a human merges.

Verify a release yourself:

```bash
gh attestation verify akoya-<version>.zip -R akoya-wallet/akoya-extension
```

```bash
gh attestation verify akoya-<version>.zip -R akoya-wallet/akoya-extension --predicate-type https://cyclonedx.org/bom
```
