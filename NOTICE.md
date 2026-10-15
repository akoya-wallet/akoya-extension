# Notices & Acknowledgements

Akoya is developed by PRLFlipBTC, an independent team. It is **not** affiliated with or endorsed by
Pearl Research Labs.

## Pearl protocol

Protocol parameters, derivation behaviour and several test vectors were taken from the official
Pearl monorepo, <https://github.com/pearl-research-labs/pearl> (ISC License,
Copyright (c) 2025-2026 The Pearl Research Labs):

- `node/chaincfg/params.go` — HRPs, coin types, HD version bytes, coinbase maturity
- `wallet/waddrmgr/common_test.go` — seed → address/private-key fixture used in `test/derivation.test.ts`
- `node/btcutil/hdkeychain/extendedkey_test.go` — `TestLeadingZero` vector for `DeriveNonStandard`
- `wallet/wallet/import_test.go` — Testnet address fixture

No Pearl source code is copied into this repository; the `DeriveNonStandard`-compatible step in
`src/core/hd.ts` is an independent reimplementation of the documented behaviour.

## Standards & vectors

- BIP32 / BIP39 / BIP86 / BIP340 / BIP341 / BIP350 — BIP86 reference vectors in `test/derivation.test.ts`
- The well-known public test mnemonic `abandon … about`. **No test vector in this repository controls real funds that belong to the project.**

## Nockchain (NOCK)

`src/nock/wasm/` is WebAssembly compiled from `nock/` (Akoya, MIT), which uses the Nockchain
cryptography from NockBox's **iris-rs** — <https://github.com/nockbox/iris-rs>, MIT License,
Copyright (c) NockBox Inc. — at commit `a0a213790cfbd154c11570f2ea6fba540234b0cc`
(crates `iris-crypto`, `iris-ztd`, `iris-nockchain-types`: Cheetah curve, Tip5 hash, SLIP-10-style
key derivation, note first-names). The other Rust crates compiled into it are listed with their
licences in `nock/Cargo.lock` (all MIT, Apache-2.0, BSD, Zlib, CC0 or Unicode-3.0).
Address vectors in `test/nock.test.ts` were produced with the official `nockchain-wallet`
(<https://github.com/zorp-corp/nockchain>, MIT).

## Brand assets

The Akoya logo, icons and wordmark (`brand/`, `public/icons/`, `src/ui/assets/`) are © PRLFlipBTC,
all rights reserved, and are excluded from the MIT License. See [TRADEMARKS.md](TRADEMARKS.md).

## Runtime dependencies

| Package | License | Purpose |
|---|---|---|
| `@noble/curves`, `@noble/hashes` | MIT | secp256k1/Schnorr, SHA-2, HMAC, Argon2id |
| `@scure/bip32`, `@scure/bip39`, `@scure/base`, `@scure/btc-signer` | MIT | HD keys, mnemonics, bech32m/base58, transaction signing |
| `@paulmillr/qr` | MIT OR Apache-2.0 | local QR code rendering (zero dependencies) |
| `micro-packed` | MIT | binary encoding (dependency of `@scure/btc-signer`) |
| `react`, `react-dom` | MIT | UI (bundled at build time) |
