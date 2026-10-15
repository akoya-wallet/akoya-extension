# Chrome Web Store — copy & answers to paste

Everything the Developer Dashboard asks for, ready to paste. Keep this file in sync with the live
listing so changes are reviewed like code.

---

## Store listing tab

**Name** (comes from the manifest): `Akoya — Pearl (PRL) Wallet`

**Summary** (≤ 132 characters — taken from the manifest description, `public/_locales/*/messages.json`):

> Open-source self-custody wallet for Pearl (PRL). Your keys never leave your device. Not affiliated with Pearl Research Labs.

> Pearl (PRL) 开源自托管钱包，私钥永不离开你的设备。由 PRLFlipBTC 开发，非 Pearl Research Labs 官方产品。

**Category:** Tools (or the closest "Tools / Developer Tools / Productivity" option offered)

**Language:** English (default) · add a 简体中文 localized listing below

**Description — English**

```
Akoya is an open-source, self-custodial wallet for Pearl (PRL), the Proof-of-Useful-Work blockchain.

• Create a new wallet or import your recovery phrase (BIP39) — including phrases from the official Pearl Wallet / oyster. Akoya derives exactly the same addresses, including oyster's non-standard derivation.
• Receive with a QR code, send to Taproot or post-quantum P2MR addresses, and review the complete transaction (recipient, amount, fee, change) before you sign.
• Built for miners: pool payouts and coinbase rewards are labelled as mining income, with a daily total and maturity tracking.
• Optional: Nockchain (NOCK), read-only — the same recovery phrase shows your NOCK balance and receive address.
• Optional: link your Pearlhash pool account to see your rigs, per-GPU hashrate (slow cards highlighted) and pending rewards.
• Optional: see your holdings' value and today's profit/loss (price move + mining income) in USD, CNY, EUR and more — or in sats. Off by default; prices come from CoinGecko and no wallet data is sent.
• Multiple wallets, Mainnet and Testnet2, English and 简体中文.
• Choose your own RPC node and block explorer.

Security
• Your recovery phrase is encrypted on your device (Argon2id + AES-256-GCM) and never leaves it.
• Private keys exist only for the moment a transaction is signed; signing works fully offline.
• No analytics, no tracking, no remote code, minimal permissions. The only optional third party is the CoinGecko price feed, and only if you turn it on.
• Open source (MIT). Every release is built reproducibly in public CI with signed build provenance and an SBOM, so you can verify the package you install: https://github.com/akoya-wallet/akoya-extension

Akoya will never ask for your recovery phrase. Only enter it when importing a wallet.

Akoya is developed by PRLFlipBTC, an independent team, and is not affiliated with Pearl Research Labs.
```

**Description — 简体中文**

```
Akoya 是 Pearl (PRL) 的开源自托管钱包。

• 创建新钱包，或导入 BIP39 助记词——包括官方 Pearl Wallet / oyster 的助记词。Akoya 的地址与官方钱包完全一致（含 oyster 的非标准派生）。
• 二维码收款；发送到 Taproot 或抗量子 P2MR 地址；签名前完整展示收款地址、金额、手续费和找零。
• 为矿工设计：矿池结算和出块奖励显示为挖矿收益，并统计今日收益、跟踪成熟度。
• 可选：Nockchain (NOCK) 只读——同一套助记词查看 NOCK 余额和收款地址。
• 可选：关联 Pearlhash 矿池账户，查看矿机、每张 GPU 的算力（自动标出偏慢的卡）和待结算收益。
• 可选：显示持仓价值和今日盈亏（价格涨跌 + 挖矿收益），支持美元、人民币、欧元等，也可以用 sats 计价。默认关闭；价格来自 CoinGecko，不发送任何钱包数据。
• 多钱包、主网 / Testnet2、英文 / 简体中文。
• 可自选 RPC 节点和区块浏览器。

安全
• 助记词在本机加密（Argon2id + AES-256-GCM），永不离开你的设备。
• 私钥只在签名瞬间存在，签名完全离线。
• 无统计、无追踪、无远程代码、最小权限。唯一可选的第三方是 CoinGecko 价格源，且仅在你开启后使用。
• 开源（MIT）。每个版本都在公开 CI 中可复现构建，并附带签名的构建来源证明和 SBOM：https://github.com/akoya-wallet/akoya-extension

Akoya 永远不会向你索要助记词。只在导入钱包时输入它。

Akoya 由独立团队 PRLFlipBTC 开发，非 Pearl Research Labs 官方产品。
```

**Official URL:** `https://akoyawallet.app` (needs the domain verified in Search Console — see the setup guide)
**Homepage URL:** `https://akoyawallet.app`
**Support URL:** `https://github.com/akoya-wallet/akoya-extension/issues`

**Graphics** (in `store/assets/`; regenerate with the harness in `store/shots/` — demo data only, see its header):

| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 PNG | `public/icons/akoya-128.png` (already in the package) |
| Screenshots (store takes up to 5) | 1280×800, 24-bit PNG | `store/assets/screenshot-{1-mining,2-receive,3-review,4-nodes,5-chinese,6-pnl,7-rigs}.png` — suggested set: 1, 7, 6, 3, 5 |
| Small promo tile (required) | 440×280, 24-bit PNG | `store/assets/promo-small-440x280.png` |
| Marquee (optional) | 1400×560, 24-bit PNG | `store/assets/promo-marquee-1400x560.png` |

---

## Privacy practices tab

**Single purpose**

```
Akoya is a self-custody cryptocurrency wallet for Pearl (PRL): create or import a wallet, view balance and transaction history, and receive and send PRL. Optionally, the same recovery phrase can show a read-only Nockchain (NOCK) balance and receive address.
```

**Permission justifications**

`storage`
```
Stores the user's wallet on the device: the recovery phrase encrypted with the user's password (Argon2id + AES-256-GCM), wallet names and settings. The unlocked session (public key only) is kept in memory-only session storage.
```

Host permission `https://blockbook.pearlresearch.ai/*`, `https://blockbook.testnet.pearlresearch.ai/*`
```
These are the official Pearl RPC (Blockbook) servers. The wallet uses them to read the user's balance, unspent outputs, transaction history and fee estimates, and to broadcast transactions the user has signed locally. The API sends no CORS headers, so host access is required.
```

Optional host permission `https://*/*`
```
Never granted at install. Requested at runtime only when the user adds their own RPC node or links their mining pool (Pearlhash) in Settings, and only for that single origin (chrome.permissions.request with that origin). The pool is asked for the stats of the user's mining address (rigs, hashrate, pending rewards); its API sends no CORS headers, so host access is required.
```

**Remote code:** `No, I am not using remote code.` (The Nockchain helper is WebAssembly bundled
inside the package — built from the open-source `nock/` directory — not loaded from anywhere.)

**Data usage** — tick:

- ☑ **Financial and payment information** — the wallet's public addresses, balances and transaction
  history are requested from, and signed transactions are sent to, the Pearl RPC node the user
  selects. (Nothing is sent to PRLFlipBTC; nothing is collected by us.)
- ☐ everything else (personally identifiable info, health, authentication information, personal
  communications, location, web history, user activity, website content)

The optional CoinGecko price request (Price & P&L, off by default) contains no user data — only the
coin ids and the chosen currency. The optional mining-pool link sends the user's mining address to the
pool they chose, to show that address's own stats — covered by "Financial and payment information"
above (public address, sent to a service the user selects).

Certify all three statements:

- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://akoyawallet.app/privacy` (content: `PRIVACY.md`)

---

## Distribution tab

- **Payment:** Free
- **Visibility:** start with **Unlisted** (only people with the link can install) for a first round
  of testing, then switch to **Public**.
- **Regions:** All regions

## Test instructions tab (for reviewers)

```
No account or login is needed. To test: open the extension, choose "Import recovery phrase", paste the public BIP39 test phrase
"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", select Testnet2, and set any password.
The wallet shows a small Testnet2 balance and its history. Mainnet works the same way with the user's own phrase.
```
