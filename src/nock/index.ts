// Nockchain (NOCK) helpers backed by the vendored WebAssembly in ./wasm (built from /nock, see
// scripts/build-nock-wasm.sh). Read-only: deriving the address and the lookup keys for balances.
//
// Deriving the address needs the seed, so it runs in a short-lived worker (derive.worker.ts) that
// receives the seed by transfer and is terminated right after: the private key never exists on
// this page, and its memory goes away with the worker. Everything else here handles public data.

import init, { addressOf, firstNames as wasmFirstNames, masterPublicKey } from './wasm/akoya_nock.js';

/** 1 NOCK = 2^16 nicks */
export const NICKS_PER_NOCK = 65_536n;

let ready: Promise<unknown> | null = null;
/** Loads the WebAssembly once (idempotent; tests may have initialised it synchronously already). */
export const nockReady = () => (ready ??= init());

/** v1 address shape: base58, ~50–55 chars (the WASM does the authoritative check) */
export const looksLikeNockAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(a);

/** [plain payments, mining rewards] lookup keys for an address — public data only. */
export async function firstNames(address: string): Promise<[string, string]> {
  await nockReady();
  const r = wasmFirstNames(address);
  if (r.length !== 2 || !r.every(looksLikeNockAddress)) throw new Error('first names');
  return [r[0], r[1]];
}

/**
 * BIP39 seed → NOCK v1 address (master key, as the official wallet and Iris derive it).
 * The seed buffer is transferred away (browser) or zeroed (elsewhere) — callers must not reuse it.
 */
export async function deriveAddress(seed: Uint8Array): Promise<string> {
  if (seed.length !== 64) throw new Error('seed must be 64 bytes');
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    const worker = new Worker(new URL('./derive.worker.ts', import.meta.url), { type: 'module' });
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('nock derive timeout')), 30_000);
        worker.onmessage = (e: MessageEvent<{ address?: string }>) => {
          clearTimeout(timer);
          const a = e.data?.address;
          if (typeof a === 'string' && looksLikeNockAddress(a)) resolve(a);
          else reject(new Error('nock derive failed'));
        };
        worker.onerror = () => {
          clearTimeout(timer);
          reject(new Error('nock derive failed'));
        };
        worker.postMessage(seed, [seed.buffer]);
      });
    } finally {
      worker.terminate();
    }
  }
  // Node (tests): same code path minus the worker
  await nockReady();
  try {
    return addressOf(masterPublicKey(seed));
  } finally {
    seed.fill(0);
  }
}

/** nicks → "1,234.5678" (truncated, never rounded up) */
export function formatNock(nicks: bigint | string, maxDecimals = 4): string {
  const n = typeof nicks === 'string' ? BigInt(nicks) : nicks;
  const neg = n < 0n;
  const a = neg ? -n : n;
  const whole = (a / NICKS_PER_NOCK).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const scale = 10n ** BigInt(maxDecimals);
  const frac = (((a % NICKS_PER_NOCK) * scale) / NICKS_PER_NOCK).toString().padStart(maxDecimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
