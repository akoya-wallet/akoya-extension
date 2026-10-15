<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/png/lockup-white.png">
    <img src="brand/png/lockup-ink.png" alt="Akoya" width="360">
  </picture>
</p>

# Akoya — an open-source wallet for Pearl (PRL)

_by PRLFlipBTC · [akoyawallet.app](https://akoyawallet.app)_

[中文说明](README.zh-CN.md)

Akoya is a self-custodial **Chrome extension wallet for [Pearl](https://github.com/pearl-research-labs/pearl) (PRL)**,
the Proof-of-Useful-Work L1. Think "open-source MetaMask, for Pearl": your keys never leave your browser,
and every line that touches them is public and reviewable.

> **Status: alpha, unaudited.** Use small amounts. Akoya is built by PRLFlipBTC, an independent team;
> it is **not** affiliated with Pearl Research Labs.

**Official source:** <https://github.com/akoya-wallet/akoya-extension> · **Official extension ID:** _not published yet_ — anything claiming to be Akoya before this line is filled
in is not us. See [TRADEMARKS.md](TRADEMARKS.md).

## Features

- Create a wallet or import a BIP39 recovery phrase (or an oyster hex seed)
- **Same addresses as the official Pearl Wallet / oyster**, including oyster's non-standard derivation quirk
- Receive with QR code, send to Taproot or P2MR addresses, full transaction review before signing
- Transaction history, mining-reward (coinbase) maturity tracking, pool payouts labelled as mining income
- Optional fiat value and daily P&L (USD, CNY, HKD, EUR, JPY, KRW or BTC/sats), with a local daily log — off by default, uses CoinGecko, sends no wallet data
- Multiple wallets, Mainnet and Testnet2, user-configurable Blockbook indexers
- Keys exist in memory only while signing; signing works fully offline

## Install (developer mode)

```bash
npm ci
```

```bash
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/`.
On first use the onboarding opens in a full tab so the popup can't close in the middle of a backup.

## How Pearl works (for wallet developers)

Facts below come from the official [`pearl-research-labs/pearl`](https://github.com/pearl-research-labs/pearl) monorepo.

| | Value | Source |
|---|---|---|
| Chain | btcd fork, UTXO model | `node/` |
| Addresses | SegWit v1 Taproot and v2 P2MR only, bech32m (`prl1p…` / `tprl1p…`) | `node/btcutil/address.go`, `node/txscript/standard.go` |
| Recovery phrase | BIP39 English, `bip39.NewSeed(m, "")` (no passphrase) | `wallet/walletsetup.go` |
| Path | `m/86'/808276'/0'/{0,1}/i` (coin type `1` on testnets) | `node/chaincfg/params.go`, `wallet/waddrmgr/scoped_manager.go` |
| Signatures | BIP340 Schnorr + BIP341 sighash, unmodified | `node/txscript/sighash.go` |
| Units | 1 PRL = 10⁸ grain; min relay fee 1 grain/vB | `node/mempool/policy.go` |
| Indexer | Blockbook (understands Pearl zpub/vpub) | `apps/apps/pearl-desktop-wallet/src/main/clients/blockbook-client.ts` |

### The oyster derivation quirk

oyster (Pearl's btcwallet fork) derives every level with `hdkeychain.DeriveNonStandard`. When a parent
private key starts with a `0x00` byte, the hardened-child HMAC input is left-aligned instead of
right-aligned. For roughly **1% of recovery phrases**, oyster's addresses therefore differ from every
standard BIP32/BIP86 wallet. Akoya reproduces the quirk by default (`src/core/hd.ts`, ~20 lines on top of
`@scure/bip32`) and offers standard BIP32 under *Advanced* during import. Both behaviours are pinned by
test vectors taken from Pearl's own Go tests.

## Security

- [THREAT_MODEL.md](THREAT_MODEL.md) — assets, adversaries, mitigations, non-goals
- [SECURITY.md](SECURITY.md) — private vulnerability reporting
- [PERMISSIONS.md](PERMISSIONS.md) — why each manifest permission exists

Highlights: Argon2id + AES-256-GCM vault; only the xpub is kept while unlocked; the password is required
for every send and every phrase reveal; no content scripts, no page-facing provider, strict CSP;
indexer responses are validated and every path is re-derived locally; reproducible, checksummed builds
with SLSA provenance.

## Development

```bash
npm test
```

```bash
npm run dev
```

`npm run dev` serves the UI at http://localhost:5199/popup.html as a normal web page
(in-memory storage, wiped on reload; the default indexers are reached through a dev-only Vite middleware).

| Command | What it does |
|---|---|
| `npm test` | derivation vectors, signing, vault, indexer validation, offline signing |
| `npm run typecheck` | strict TypeScript |
| `npm run security:gates` | key-leak / weak-RNG / eval / raw-HTML gates |
| `npm run check:supply-chain` | lockfile provenance, exact pins, install scripts, licences |
| `npm run audit:dist` | manifest permissions/CSP and bundle scan of `dist/` |
| `npm run package` | build + `release/akoya-<ver>.zip` + SHA-256 |
| `npm run release -- X.Y.Z` | bump version, run checks, commit, tag and push → CI publishes the release |

```
src/core/      protocol layer — pure TS, no browser or network deps, tested in Node
  networks.ts  every chain constant (HRP, coin type, version bytes, default indexers)
  hd.ts        @scure/bip32 + the oyster-compatibility step
  account.ts   phrase parsing, account derivation, address book
  address.ts   bech32m encode/decode/validation
  tx.ts        coin selection, fees, signing (offline)
  keystore.ts  Argon2id + AES-256-GCM vault
  blockbook.ts indexer client (all responses treated as untrusted)
src/ext/       extension service layer (chrome.storage, session, send flow)
src/ui/        React UI
test/          vectors use public test phrases only
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR, [docs/CI.md](docs/CI.md) for the CI/CD security pipeline,
and [ROADMAP.md](ROADMAP.md) for what's next.

## Reproducible builds

Node `24.11.1`, `npm ci` against the committed lockfile, lifecycle scripts disabled, no source maps.
`npm run package` produces a deterministic zip; two builds of the same commit give the same SHA-256.
Tagged releases are built in CI and carry a signed build-provenance attestation
(`gh attestation verify akoya-<ver>.zip -R <owner>/<repo>`).

## License

Code: [MIT](LICENSE). The Akoya name, logo and everything under [`brand/`](brand/) are **not** covered by
the license — forks must rename and replace the icons (see [TRADEMARKS.md](TRADEMARKS.md)). Third-party notices: [NOTICE.md](NOTICE.md).
