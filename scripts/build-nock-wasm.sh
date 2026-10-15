#!/usr/bin/env bash
# Rebuilds src/nock/wasm/ (the Nockchain helper, WebAssembly) from nock/ — reproducibly.
#
# The output is committed so a normal `npm run build` needs no Rust. CI runs this script on a clean
# runner and fails if the result differs from what's committed (`git diff --exit-code`), so the
# shipped WebAssembly is provably built from the Rust source in this repo + the pinned iris-rs.
#
#   needs: rustup (toolchain from nock/rust-toolchain.toml) and wasm-bindgen-cli $BINDGEN
#
# The canonical build host is Linux x86_64 (the CI runner). Other hosts produce a valid but not
# byte-identical module (export order differs), so committed files come from CI: the nock-wasm job
# uploads its rebuild as an artifact (nock-wasm-<sha>). On macOS this script is for local testing.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
BINDGEN=0.2.105
OUT=src/nock/wasm

if [ "$(wasm-bindgen --version 2>/dev/null)" != "wasm-bindgen $BINDGEN" ]; then
  echo "need wasm-bindgen $BINDGEN: cargo install wasm-bindgen-cli --version $BINDGEN --locked" >&2
  exit 1
fi

# no machine-specific paths in the binary (panic locations would otherwise embed them)
CARGO_DIR=${CARGO_HOME:-$HOME/.cargo}
export RUSTFLAGS="--remap-path-prefix=$CARGO_DIR=/cargo --remap-path-prefix=$ROOT=/akoya -C debuginfo=0"
export CARGO_INCREMENTAL=0 SOURCE_DATE_EPOCH=315532800
# the toolchain comes from nock/rust-toolchain.toml
(cd nock && cargo build --release --locked --target wasm32-unknown-unknown)

rm -rf "$OUT"
mkdir -p "$OUT"
wasm-bindgen --target web --out-dir "$OUT" --out-name akoya_nock nock/target/wasm32-unknown-unknown/release/akoya_nock.wasm
(cd "$OUT" && shasum -a 256 akoya_nock.js akoya_nock_bg.wasm > SHA256SUMS && cat SHA256SUMS)
if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "note: built on $(uname -s)-$(uname -m); the committed (canonical) build comes from Linux x86_64 CI" >&2
fi
