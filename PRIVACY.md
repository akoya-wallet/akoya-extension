# Akoya Privacy Policy

_Last updated: 2026-10-15_

Akoya is an open-source, self-custodial browser extension wallet for Pearl (PRL), published by
PRLFlipBTC. This policy explains exactly what data the extension handles. The source code that
implements everything below is public at <https://github.com/akoya-wallet/akoya-extension>.

## Summary

- **We do not collect, receive, store, sell or share any of your data.** PRLFlipBTC operates no
  server that the extension talks to.
- There is **no analytics, telemetry, advertising, tracking or crash reporting**.
- Your recovery phrase and private keys **never leave your device**.

## Data stored on your device

| Data | Where | Protection |
|---|---|---|
| Recovery phrase / seed and optional BIP39 passphrase | `chrome.storage.local` | Encrypted with your password (Argon2id + AES-256-GCM). Never transmitted. |
| Wallet name, network, derivation mode, account public key (xpub) | `chrome.storage.local` | Not encrypted. Public data: it cannot spend funds, but reveals balances and history to someone with access to your browser profile. |
| Settings (language, auto-lock, RPC nodes, block explorers, display currency) | `chrome.storage.local` | Not sensitive. |
| Addresses of mining pools that paid you | `chrome.storage.local` | Public blockchain data, used to label mining income. |
| NOCK address (only if you turn on **Nockchain**): the public Nockchain address derived from your recovery phrase | `chrome.storage.local` | Public. Re-checked against your recovery phrase on every unlock. Deleted with the wallet. |
| Mining-pool link (only if you link a pool): the pool and the address you mine to, per wallet | `chrome.storage.local` | Not sensitive. Deleted with the wallet. |
| Daily P&L log (only if you turn on **Price & P&L**): per day, the PRL price, your holdings, PRL mined and the resulting profit/loss, kept for 90 days | `chrome.storage.local` | Not encrypted, like the xpub above. Never transmitted. Deleted with the wallet. |
| Unlocked session (wallet id and xpub) | `chrome.storage.session` | Memory only, cleared when the browser closes or the wallet locks. |

Uninstalling the extension or using **Settings → Delete this wallet** removes this data from your device.

## Network requests

The extension only connects to:

1. **The Pearl RPC node you choose** (by default the official Pearl Blockbook servers
   `blockbook.pearlresearch.ai` and `blockbook.testnet.pearlresearch.ai`, operated by Pearl
   Research Labs, not by us). To show your balance and history and to send PRL, the extension sends
   that node your account public key (xpub) and addresses, and broadcasts transactions you have
   signed. The node can therefore see your addresses, balances and transactions. It never receives
   your recovery phrase, private keys or password. You can switch to, or run, your own node in
   **Settings → RPC node**.
2. **A block explorer, only when you click a "View in explorer" link.** That opens a normal browser
   tab at the explorer you selected (by default `explorer.pearlresearch.ai`) for that transaction
   or address.
3. **CoinGecko (`api.coingecko.com`), only if you turn on Price & P&L** (off by default; Settings →
   General, or "Show value & P&L" on the home screen). The extension then asks CoinGecko for the
   current PRL price, its price at midnight and the PRL/BTC market caps, in the currency you picked.
   These requests contain only the coin names and the currency, never your addresses, balances,
   xpub or anything else about your wallet, and they are sent without cookies. As with any website,
   CoinGecko can see your IP address. Your fiat value and P&L are calculated on your device.
4. **The mining pool you link, only if you link one** (off by default; currently Pearlhash,
   `pearlhash.xyz`; Settings → Mining pool, or "Connect" on the home screen). The extension asks the
   pool for the stats of the one address you mine to — your rigs, hashrate, pending rewards and pool
   payouts. Only that address is sent, without cookies; the pool sees your IP address and which
   address you looked up. Chrome asks you to allow access to that one site first. The pool's
   response also lists your rigs' IP addresses; the extension ignores them and never stores or
   shows them.
5. **A Nockchain node, only if you turn on Nockchain (NOCK)** (off by default; Settings →
   Nockchain). By default `rpc.nockbox.org`, operated by NockBox Inc.; you can set your own. To show
   your NOCK balance the extension sends the node lookup keys derived from your NOCK address (note
   "first-names"), without cookies. The node can link them to your address and sees your IP
   address. Your recovery phrase and keys are never sent.

Nothing else is contacted. The extension does not use cookies and does not load remote code.

## Permissions

- `storage`: keep the encrypted wallet and your settings on your device.
- Access to `blockbook.pearlresearch.ai` / `blockbook.testnet.pearlresearch.ai`: talk to the default
  Pearl RPC nodes.
- Optional access to other `https://` sites: requested only when you add your own RPC node or link a
  mining pool, and only for that one site.

## Children

Akoya is not directed to children under 13 and does not knowingly process their data.

## Changes

Changes to this policy are published in the source repository and on <https://akoyawallet.app/privacy>
with a new "Last updated" date.

## Contact

contact@akoyawallet.app — for security issues, please use
[private vulnerability reporting](https://github.com/akoya-wallet/akoya-extension/security/advisories/new).
