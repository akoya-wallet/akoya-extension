# Manifest permissions — justification

Every entry in `public/manifest.json` must be listed here with a reason. Adding a permission
requires updating this file in the same PR.

| Key | Value | Why |
|---|---|---|
| `permissions` | `storage` | Encrypted vault + settings in `chrome.storage.local`; public session data (xpub) in `chrome.storage.session`. |
| `host_permissions` | `https://blockbook.pearlresearch.ai/*` | Default mainnet indexer (balance, UTXOs, fee estimates, broadcast). Blockbook sends no CORS headers, so an explicit host permission is required. |
| `host_permissions` | `https://blockbook.testnet.pearlresearch.ai/*` | Default Testnet2 indexer. |
| `optional_host_permissions` | `https://*/*` | **Optional, never granted at install.** Requested per-origin at runtime via `chrome.permissions.request` only when the user adds a custom indexer in Settings, so the grant is limited to that one origin. |
| `content_security_policy.extension_pages` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` | No inline/remote scripts or styles, no `unsafe-eval`. `img-src data:` is for the locally generated QR code. `connect-src https:` allows user-configured indexers (still gated by host permissions). |

Deliberately **not** requested: `tabs` (opening a tab via `chrome.tabs.create` does not need it),
`scripting`, `activeTab`, `<all_urls>`, `clipboardRead`, `clipboardWrite`, `alarms`, `background`.
There are no content scripts and no injected `window.pearl` provider.
