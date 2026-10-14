#!/usr/bin/env bash
# Cut a release in one step: bump version → checks → commit → tag → push.
# Usage:  npm run release -- 0.1.1
# The tag push triggers .github/workflows/release.yml, which builds, attests and publishes the zip.
set -euo pipefail
cd "$(dirname "$0")/.."

v="${1:-}"
[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: npm run release -- X.Y.Z" >&2; exit 1; }

cur="$(node -p "require('./public/manifest.json').version")"
node -e '
  const [a, b] = process.argv.slice(1).map(s => s.split(".").map(Number));
  const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (newer <= 0) { console.error(`version ${process.argv[1]} must be greater than current ${process.argv[2]}`); process.exit(1); }
' "$v" "$cur"

[[ "$(git branch --show-current)" == "main" ]] || { echo "releases are cut from main" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "working tree is not clean" >&2; exit 1; }
git fetch -q origin main --tags
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "local main differs from origin/main — pull/push first" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/v$v" >/dev/null; then echo "tag v$v already exists" >&2; exit 1; fi

npm version "$v" --no-git-tag-version >/dev/null
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync("public/manifest.json", "utf8"));
  m.version = process.argv[1];
  fs.writeFileSync("public/manifest.json", JSON.stringify(m, null, 2) + "\n");
' "$v"

npm run typecheck
npm test
bash scripts/security-gates.sh

git add package.json package-lock.json public/manifest.json
git commit -q -m "release: v$v"
git tag -a "v$v" -m "Akoya v$v"
git push origin main "v$v"
echo "✔ v$v pushed — release workflow: https://github.com/akoya-wallet/akoya-extension/actions/workflows/release.yml"
