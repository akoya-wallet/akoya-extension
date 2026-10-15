// PRL price from CoinGecko — only used when the user turns on "Price & P&L" (off by default).
// Requests carry no wallet data: just the coin id and the fiat currency. Responses are untrusted
// input and validated like indexer data.
//
// Coin id `pearl-2` verified 2026-10-15: native coin (no token platform), homepage
// pearlresearch.ai, source github.com/pearl-research-labs/pearl.

import { WalletError } from '../core/errors.ts';
import { sessionStore } from './platform.ts';
import type { Fiat } from './types.ts';

export const PRICE_SOURCE = 'CoinGecko';
export const FIATS: Fiat[] = ['usd', 'cny', 'hkd', 'eur', 'jpy', 'krw', 'sats'];
export const FIAT_LABEL: Record<Fiat, string> = { usd: 'USD $', cny: 'CNY ¥', hkd: 'HKD $', eur: 'EUR €', jpy: 'JPY ¥', krw: 'KRW ₩', sats: 'BTC (sats)' };
const API = 'https://api.coingecko.com/api/v3';
const COIN = 'pearl-2';
// BTC is fetched alongside PRL only for the market-cap ratio ("flip BTC" meter)
const BTC = 'bitcoin';
const SPOT_TTL = 60_000;
// if a refresh fails (offline, rate-limited) keep showing the last price for a while
const SPOT_STALE_OK = 15 * 60_000;

const okPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e7;
const okCap = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e20;

async function get(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(API + path, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new WalletError('price.unavailable');
  }
  if (!res.ok) throw new WalletError('price.unavailable');
  const text = await res.text();
  if (text.length > 2_000_000) throw new WalletError('price.unavailable');
  try {
    return JSON.parse(text);
  } catch {
    throw new WalletError('price.unavailable');
  }
}

export interface Spot {
  fiat: Fiat;
  price: number;
  change24h: number | null;
  flip: number | null;
  at: number;
}

/** Validates a `simple/price` response. Exported for tests. */
export function parseSpot(body: unknown, fiat: Fiat, at: number): Spot {
  const row = (id: string) => {
    const v = body && typeof body === 'object' ? (body as Record<string, unknown>)[id] : undefined;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  };
  const r = row(COIN);
  const price = r[fiat];
  if (!okPrice(price)) throw new WalletError('price.unavailable');
  const ch = r[`${fiat}_24h_change`];
  const prlCap = r[`${fiat}_market_cap`];
  const btcCap = row(BTC)[`${fiat}_market_cap`];
  return {
    fiat,
    price,
    change24h: typeof ch === 'number' && Number.isFinite(ch) && Math.abs(ch) < 10_000 ? ch : null,
    flip: okCap(prlCap) && okCap(btcCap) ? prlCap / btcCap : null,
    at,
  };
}

/** Current price, cached for a minute in memory-only session storage. */
export async function spot(fiat: Fiat): Promise<Spot> {
  const raw = (await sessionStore.get('price.v1')) as Spot | undefined;
  const cached = raw && raw.fiat === fiat && okPrice(raw.price) && typeof raw.at === 'number' && 'flip' in raw ? raw : undefined;
  if (cached && Date.now() - cached.at < SPOT_TTL) return cached;
  try {
    const out = parseSpot(await get(`/simple/price?ids=${COIN},${BTC}&vs_currencies=${fiat}&include_24hr_change=true&include_market_cap=true`), fiat, Date.now());
    await sessionStore.set('price.v1', out);
    return out;
  } catch (e) {
    if (cached && Date.now() - cached.at < SPOT_STALE_OK) return cached;
    throw e;
  }
}

/** Price at (or nearest to) the given instant within the last 24 h — used for local midnight. */
export async function priceAt(fiat: Fiat, atMs: number): Promise<number> {
  return nearestPrice(await get(`/coins/${COIN}/market_chart?vs_currency=${fiat}&days=1`), atMs);
}

/** Picks the point closest to `atMs` from a `market_chart` response. Exported for tests. */
export function nearestPrice(body: unknown, atMs: number): number {
  const prices = body && typeof body === 'object' ? (body as { prices?: unknown }).prices : undefined;
  const pts = Array.isArray(prices) ? prices.slice(0, 2000) : [];
  let best: [number, number] | null = null;
  for (const p of pts) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || !okPrice(p[1])) continue;
    if (!best || Math.abs(p[0] - atMs) < Math.abs(best[0] - atMs)) best = [p[0], p[1]];
  }
  // 5-minute data: anything further than an hour away means we don't really know the price then
  if (!best || Math.abs(best[0] - atMs) > 3_600_000) throw new WalletError('price.unavailable');
  return best[1];
}
