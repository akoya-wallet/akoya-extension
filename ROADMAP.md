# Roadmap

Ordered roughly by priority. Items touching keys or signing follow the review policy in CONTRIBUTING.md.

## Before a public 1.0

- [ ] **English UI + i18n** — the UI is Chinese-only today; extract strings, ship `en` and `zh-CN`.
- [ ] **`.pns` name-coin protection** — a third-party Pearl naming scheme (`.pns`) appears to bind names to
      specific UTXOs. Until its spec is known, ordinary sends could spend a name-carrying UTXO. Needs:
      spec → detection → exclude from coin selection by default.
- [ ] **Independent security audit** of `src/core/` and the send flow.
- [ ] **Chrome Web Store** listing; publish the official extension ID in README and to the Pearl community.
- [ ] Coin control (choose UTXOs manually), address labels, CSV export of history.
- [ ] Multiple accounts per recovery phrase (`m/86'/808276'/n'`).

## Later

- [ ] **dApp provider (`window.pearl`)** — only with the controls in the security requirements (§10):
      origin-validated messaging, extension-owned approval UI, per-origin allowlist shown to the user,
      no auto-approval, no page strings rendered unsanitised.
- [ ] Hardware wallet signing (once a device supports Pearl Taproot/BIP86 paths).
- [ ] PSBT import/export for watch-only + offline-signer workflows.
- [ ] P2MR (post-quantum, purpose 222) receive support, mirroring oyster's `--pq` addresses.
- [ ] Firefox (MV3) build.

## Explicit non-goals

No cloud backup of recovery phrases, no cross-device sync, no server-side custody, no remote config that
can change signing behaviour, no auto-update outside the browser store.
