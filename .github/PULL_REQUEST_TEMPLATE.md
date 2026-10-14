## What & why

<!-- One or two sentences. Link the issue if there is one. -->

## Security checklist

- [ ] No real recovery phrase / private key / password anywhere (code, tests, docs, screenshots, history)
- [ ] No new runtime dependency — or justification: <!-- package@version: why -->
- [ ] No new manifest permission — or `PERMISSIONS.md` updated with a reason
- [ ] Touches `src/core/` (keys, derivation, signing, vault)? → maintainer line-by-line review requested
- [ ] Derivation vectors unchanged — or the PR explains exactly why addresses change
- [ ] Indexer data is validated and never rendered as HTML
- [ ] `npm run typecheck && npm test && npm run security:gates && npm run build` pass locally

## Screenshots (UI changes)

<!-- Use the public "abandon … about" test wallet only. -->
