# Threat Model (one page)

## Assets

1. **Mnemonic / seed / private keys** — total loss if disclosed.
2. **Vault password** — unlocks (1) on this device.
3. **Transaction intent** — recipient, amount, fee the user approved.
4. **Privacy** — the account xpub reveals every address and balance. It is stored in clear (like MetaMask/Phantom store account addresses), so someone with access to the browser profile can see balances and history — but cannot move funds.

## Where key material lives

| State | Location | Form |
|---|---|---|
| At rest | `chrome.storage.local` | Argon2id (64 MiB, t=3) → AES-256-GCM; id/network/mode bound as AAD |
| Unlocked session | `chrome.storage.session` (memory-only, trusted contexts) | **xpub + wallet id only**, no private material |
| Wallet list | `chrome.storage.local` | name, network, derivation mode and the **account xpub in clear** — public, cannot spend; used to list wallets and offer your other wallets as recipients. Re-derived from the seed and corrected on every unlock. |
| Signing / backup | extension page memory | decrypted on demand, private keys zeroed after `signIdx`, HD nodes wiped |

The password is required for every send and every mnemonic reveal. JS strings (the mnemonic
itself) cannot be zeroed; their lifetime is kept to a single flow and they never reach logs,
storage, URLs or the network.

## Adversaries and mitigations

| Adversary | Capability | Mitigations |
|---|---|---|
| **Malicious / compromised indexer** (Blockbook) | lie about balances, UTXOs, fees, chain; withhold data | Chain name must match local config (`backendChain`) or the endpoint is rejected. All responses schema-validated and size-bounded. Every UTXO/token path is re-derived locally; mismatches are dropped and surfaced. BIP341 sighash commits to every input amount and script, so fake UTXO values only make signing invalid. Fee rates clamped to 1–20 000 grain/vB; fee > 10 % of amount warns. Change and receive addresses always derived locally. Broadcast txid must equal the locally computed txid. |
| **Malicious dependency** (supply chain) | run code in the extension page | Exact-pinned versions + lockfile, `ignore-scripts=true`, `npm ci` in CI, `npm audit`, 8 production packages (audited `@noble/*` / `@scure/*`, zero-dependency `@paulmillr/qr`). CI: npm audit + signature/provenance verification + OSV-Scanner + lockfile/licence policy + Dependency Review + egress-blocked runners. MV3 CSP forbids remote code. |
| **XSS / injected content** | run script in the extension origin | No content scripts, no page-facing provider, no `innerHTML`/`dangerouslySetInnerHTML`, React text rendering only, strict CSP (`script-src 'self'`, `object-src 'none'`). Indexer strings never rendered as HTML. |
| **Device theft (browser closed)** | copy `chrome.storage.local` | Only the encrypted vault; offline Argon2id brute force is the cost. |
| **Device theft (browser open, unlocked)** | use the open browser | Session holds no keys; sending/revealing still needs the password; auto-lock after inactivity. |
| **Phishing clone of the extension** | trick users into entering their mnemonic | Publish the official extension ID; Akoya never asks for the mnemonic except in import. |
| **Price feed (CoinGecko), opt-in** | wrong price; learn the user's IP and that they hold PRL | Off by default; enabled only by an explicit user action. Requests carry only coin ids + currency (no wallet data, `credentials: 'omit'`, `no-referrer`). Responses validated (finite, positive, bounded) — a wrong price can only mislead the displayed fiat value/P&L; it never reaches fee, amount or signing logic. |
| **Mining pool API, opt-in** (Pearlhash) | wrong stats; learn the user's IP ↔ mining address; inject text via worker names (anyone can point a rig at an address) | Off by default; linked per wallet by an explicit user action, with a runtime permission for that single origin. Only the mining address is sent. Responses validated and bounded; strings stripped of control/bidi characters, length-capped and rendered as plain text; worker IPs dropped at parse time. Pool data is display-only — it never reaches balance, fee, amount or signing logic. |
| **Nockchain helper (WebAssembly), opt-in** | bad crypto or a malicious build deriving a wrong NOCK address | Built from `nock/` + NockBox iris-rs at a pinned commit; CI rebuilds it and requires byte-identical output; `audit:dist` allows exactly that one module. Addresses tested against the official `nockchain-wallet` (12- and 24-word vectors). Read-only: it never signs. CSP gains `'wasm-unsafe-eval'` (WebAssembly compilation only). |
| **NOCK address derivation** | seed/private key lingering in memory | Derivation runs in a dedicated worker that receives the seed by transfer (the page keeps no copy) and is terminated after replying; only the public address is stored. Like the xpub, the stored address is re-derived and repaired on every unlock (or dropped if it can't be verified). |
| **Nockchain node** (default `rpc.nockbox.org`, user-configurable) | wrong balances; learn the NOCK address | Responses parsed by a bounded protobuf reader (fuzzed); display-only. Only note first-names (hashes of the address' spend conditions) are sent. |
| **Cross-network confusion** | send mainnet funds to a testnet address (or vice versa) | HRP checked on every address; network fixed per wallet; indexer chain verified. |

## Non-goals

- Protection against a compromised OS, browser, or a higher-privileged malicious extension.
- Network-level privacy from the indexer (it learns the xpub). Users can self-host Blockbook.
- Hiding the daily P&L log from someone with access to the browser profile — like the xpub, it is stored in clear (balances are already derivable from the xpub).
- Cloud backup, cross-device sync, server-side custody, remote config, or auto-update outside the store.
