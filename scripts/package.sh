#!/usr/bin/env bash
# Zips dist/ deterministically and prints SHA-256 checksums for the release notes.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./public/manifest.json').version")"
OUT="release/akoya-${VERSION}.zip"
mkdir -p release
rm -f "$OUT"
# fixed mtimes + sorted entries -> same bytes for the same dist/
find dist -exec touch -h -t 198001010000 {} +
(cd dist && find . -type f | LC_ALL=C sort | zip -X -q -D "../$OUT" -@)
( cd release && shasum -a 256 "$(basename "$OUT")" | tee "$(basename "$OUT").sha256" )
echo "dist file hashes:"
(cd dist && find . -type f | LC_ALL=C sort | xargs shasum -a 256)
