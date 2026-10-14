#!/usr/bin/env bash
# Security review gates (SECURITY_REQUIREMENTS §7). Every gate must print nothing.
#
# Note: `--include='*.{ts,tsx,js,jsx}'` does NOT work — grep does not brace-expand inside quotes,
# so that form silently matches zero files and always "passes". We pass each glob separately,
# and self-test every pattern against a planted sample so a broken gate fails loudly.
set -uo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-src/}"
INC=(--include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs')

declare -a NAMES PATTERNS SAMPLES
NAMES+=("key material in console output")
PATTERNS+=('console\.(log|debug|info|warn|error|trace|dir)\(.*(mnemonic|seed|privat|phrase|secret|xprv|password)')
SAMPLES+=('console.log("seed", mnemonic)')

NAMES+=("key material in web storage")
PATTERNS+=('(localStorage|sessionStorage)\.(set|get)Item\(.*(mnemonic|seed|key|phrase|secret)')
SAMPLES+=('localStorage.setItem("mnemonic", m)')

NAMES+=("weak randomness")
PATTERNS+=('Math\.random')
SAMPLES+=('const r = Math.random()')

NAMES+=("dynamic code execution")
PATTERNS+=('\beval\(|new Function\(|setTimeout\(\s*["'"'"'`]|setInterval\(\s*["'"'"'`]')
SAMPLES+=('eval(x)')

NAMES+=("raw HTML injection")
PATTERNS+=('dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(')
SAMPLES+=('el.innerHTML = s')

# self-test: each pattern must match its sample, otherwise the gate itself is broken
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for i in "${!PATTERNS[@]}"; do
  printf '%s\n' "${SAMPLES[$i]}" > "$tmp/sample.ts"
  if ! grep -rnE "${INC[@]}" "${PATTERNS[$i]}" "$tmp" > /dev/null; then
    echo "GATE BROKEN: '${NAMES[$i]}' does not detect its own sample" >&2
    exit 2
  fi
done

fail=0
for i in "${!PATTERNS[@]}"; do
  out="$(grep -rnE "${INC[@]}" "${PATTERNS[$i]}" "$TARGET" || true)"
  if [[ -n "$out" ]]; then
    echo "✖ ${NAMES[$i]}:" >&2
    echo "$out" >&2
    fail=1
  else
    echo "✔ ${NAMES[$i]}"
  fi
done
exit $fail
