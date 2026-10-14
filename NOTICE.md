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

## Brand assets

The Akoya logo, icons and wordmark (`brand/`, `public/icons/`, `src/ui/assets/`) are © PRLFlipBTC,
all rights reserved, and are excluded from the MIT License. See [TRADEMARKS.md](TRADEMARKS.md).

## Runtime dependencies

| Package | License | Purpose |
|---|---|---|
| `@noble/curves`, `@noble/hashes` | MIT | secp256k1/Schnorr, SHA-2, HMAC, Argon2id |
| `@scure/bip32`, `@scure/bip39`, `@scure/base`, `@scure/btc-signer` | MIT | HD keys, mnemonics, bech32m/base58, transaction signing |
| `react`, `react-dom` | MIT | UI |
| `qrcode` | MIT | local QR code rendering |
