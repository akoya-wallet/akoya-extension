# Security Policy

## Reporting a vulnerability

**Do not open a public issue for an undisclosed vulnerability.**

Report privately through GitHub's **Private Vulnerability Reporting**
(repository → Security → "Report a vulnerability"). If that is not possible, email
**contact@akoyawallet.app** with "SECURITY" in the subject.

<!-- TODO(maintainer): add a dedicated security@ alias and a PGP key. -->

| Stage | Target |
|---|---|
| Acknowledge receipt | within 72 hours |
| Initial assessment | within 7 days |
| Fix or mitigation for critical issues | as fast as possible; coordinated disclosure after release |

## Scope

In scope:

- Key material handling: mnemonic generation, vault encryption, unlock/session, signing
- Derivation and address correctness (any drift from the official oyster wallet)
- Transaction construction (wrong amount/fee/recipient/change, signature over unintended data)
- Trust in indexer responses (balance/UTXO spoofing leading to loss, chain confusion)
- Extension surface: CSP, permissions, storage areas, clipboard

Out of scope:

- A compromised operating system, browser, or malicious extensions with higher privileges
- Phishing clones of this extension (report them, but they are not a bug in this code)
- Denial of service by a malicious or unavailable indexer (the wallet fails closed)

## Handling rules for contributors

- Never commit a real, funded mnemonic or key — not in tests, docs, screenshots or history.
  Test vectors use the public `abandon … about` phrase and fixtures from the official Pearl repo.
- Any change under `src/core/` (`hd.ts`, `account.ts`, `keystore.ts`, `tx.ts`, `networks.ts`)
  requires line-by-line maintainer review and green CI on derivation vectors and security gates.
