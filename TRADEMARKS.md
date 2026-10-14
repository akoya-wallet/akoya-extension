# Trademark & Brand Policy

The source code of Akoya is licensed under the [MIT License](LICENSE). **The MIT License covers
copyright only — it does not grant any rights to the "Akoya" name, logo, or icons.**

The name "Akoya" (as the name of this wallet), the "PRLFlipBTC" name, the logos, the extension
icons and every file under [`brand/`](brand/) and `public/icons/` are reserved by **PRLFlipBTC**,
the maintainer of Akoya. They are **not** licensed under the MIT License.

## You may

- Fork, modify, and redistribute the code under the MIT License.
- Say that your project is "based on Akoya" or "a fork of Akoya".
- Use the name to refer to this project in articles, reviews, and tutorials.

## You may not

- Publish a wallet, browser extension, app, or website named "Akoya" (or a confusingly similar name)
  or using the Akoya logo/icons, unless it is the official release from this repository.
- Imply that your fork is endorsed by or affiliated with the Akoya project or PRLFlipBTC.

## Why

Wallets are a prime target for phishing clones: a copied name and logo is all an attacker needs to
trick users into typing their recovery phrase. If you ship a fork, **rename it and replace the icons**
(`public/icons/`, `src/ui/assets/`, `brand/`, `public/manifest.json`, `APP_NAME` in `src/core/networks.ts`).

The official extension ID is published in the [README](README.md). Anything else carrying the Akoya
name is not ours.
