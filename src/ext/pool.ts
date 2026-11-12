// Mining-pool stats (rigs, hashrate, pending rewards) — opt-in, per wallet. The pool is asked about
// one address: the one you mine to. Responses are untrusted input: validated, bounded, and rendered
// as plain text only. Worker names in particular are chosen by whoever points a rig at the address.
//
// Neither pool sends CORS headers, so the extension asks for that one origin at runtime (optional
// host permission).
//
// Pearlhash (pearlhash.xyz), verified 2026-10-15: GET /api/account/{address} → connected_workers
// (gpu_info hashrate in H/s), pending_rewards, balance_transactions. The response also contains each
// worker's IP address — never read, kept or shown here.
//
// Peryn (app.peryn.ai), verified 2026-11-12: GET /api/pool/address/{address} → hashrate (H/s),
// workers (per-rig hashrate, no GPU detail), prl.* balances and prlDays as grain strings, payouts.

import { WalletError } from '../core/errors.ts';
import { poolFetch, sessionStore } from './platform.ts';

export interface PoolInfo {
  id: string;
  name: string;
  /** https URL template with {address} */
  api: string;
  /** the pool's own page for the address */
  web: string;
  /**
   * Addresses the pool pays miners from (public chain data, seen in its payout transactions).
   * Used only to tell which pool a wallet's payouts come from; never sent anywhere.
   */
  payoutSenders: string[];
  parse: (body: unknown, address: string, at: number) => PoolStats;
}

export interface PoolGpu {
  name: string;
  /** H/s */
  hashrate: number;
}
export interface PoolWorker {
  id: string;
  name: string;
  version: string;
  online: boolean;
  /** empty when the pool doesn't report GPUs */
  gpus: PoolGpu[];
  /** H/s */
  hashrate: number;
  /** ms, when the pool reports it */
  lastShareAt: number | null;
}
export interface PoolEpoch {
  /** epoch start / end, ms (null if the label couldn't be parsed) */
  start: number | null;
  end: number | null;
  label: string;
  /** PRL */
  amount: number;
  immatureTx: number;
}
export interface PoolEntry {
  kind: 'credit' | 'payout' | 'other';
  /** PRL; payouts are negative */
  amount: number;
  at: number;
  start: number | null;
  end: number | null;
  label: string;
}
export interface PoolDay {
  /** YYYY-MM-DD (UTC) */
  day: string;
  /** PRL credited that day */
  amount: number;
}
export interface PoolStats {
  pool: string;
  address: string;
  workers: PoolWorker[];
  /** null when the pool doesn't report GPUs */
  gpus: number | null;
  hashrate: number;
  /** what each rig's hashrate is: measured right now, or the pool's average over the last 24 h */
  rigWindow: 'live' | '24h';
  /** PRL earned at the pool, not yet paid out */
  pending: number;
  /** blocks whose rewards are still maturing at the pool */
  maturingBlocks: number;
  /** pending rewards by epoch (pools that report it) */
  epochs: PoolEpoch[];
  /** PRL credited per UTC day, oldest first (pools that report it) */
  days: PoolDay[];
  activity: PoolEntry[];
  at: number;
}

const bad = () => new WalletError('pool.invalid_data');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
// printable text only, bounded: no control characters, zero-width or bidi overrides
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(UNPRINTABLE, '').trim().slice(0, max) : '');
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
/** like num, but a missing field counts as 0; a present field of the wrong shape is an error */
const numOr0 = (v: unknown, max: number) => {
  if (v === undefined || v === null) return 0;
  const n = num(v, 0, max);
  if (n === null) throw bad();
  return n;
};
const MAX_PRL = 21e9;
const MAX_HASHRATE = 1e21;
/** decimal grain string → PRL (display precision only) */
const grains = (v: unknown) => {
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'string' || !/^\d{1,19}$/.test(v)) throw bad();
  const prl = Number(BigInt(v)) / 1e8;
  if (prl > MAX_PRL) throw bad();
  return prl;
};
/** ISO timestamp → ms, within a plausible range */
const isoMs = (v: unknown) => {
  const ms = typeof v === 'string' && v.length <= 40 ? Date.parse(v) : NaN;
  return Number.isFinite(ms) && ms > 1.5e12 && ms < 1e14 ? ms : null;
};

// ---------------------------------------------------------------- Pearlhash

const EPOCH = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC \.\. (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC/;
/** "2026-10-14 22:00:00 UTC .. 2026-10-14 23:00:00 UTC" → [start, end] ms */
export function epochRange(label: string): [number, number] | null {
  const m = EPOCH.exec(label);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  const start = Date.UTC(n[0], n[1] - 1, n[2], n[3], n[4], n[5]);
  const end = Date.UTC(n[6], n[7] - 1, n[8], n[9], n[10], n[11]);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [start, end] : null;
}

/** Validates a Pearlhash `/api/account/{address}` response. Exported for tests. */
export function parsePearlhash(body: unknown, address: string, at: number): PoolStats {
  if (!isObj(body)) throw bad();
  const workers: PoolWorker[] = [];
  for (const [i, w] of list(body.connected_workers, 1000).entries()) {
    if (!isObj(w)) throw bad();
    const gpus: PoolGpu[] = [];
    for (const g of list(w.gpu_info, 64)) {
      if (!isObj(g)) throw bad();
      const hashrate = num(g.hashrate, 0, MAX_HASHRATE);
      if (hashrate === null) throw bad();
      gpus.push({ name: text(g.name, 64), hashrate });
    }
    const id = text(w.worker_id, 40);
    workers.push({
      id: /^[\w-]+$/.test(id) ? id : `w${i}`,
      name: text(w.worker_name, 40),
      version: text(w.version, 40),
      online: true, // the pool only lists connected workers
      gpus,
      hashrate: gpus.reduce((a, g) => a + g.hashrate, 0),
      lastShareAt: null,
    });
  }
  const pr = isObj(body.pending_rewards) ? body.pending_rewards : {};
  const pending = pr.total_pending_prl === undefined ? 0 : num(pr.total_pending_prl, 0, MAX_PRL);
  if (pending === null) throw bad();
  const epochs: PoolEpoch[] = [];
  for (const e of list(pr.epochs, 500)) {
    if (!isObj(e) || (e.coin_type !== undefined && e.coin_type !== 'pearl')) continue;
    const amount = num(e.amount, 0, MAX_PRL);
    if (amount === null) throw bad();
    const label = text(e.epoch_label, 80);
    const r = epochRange(label);
    epochs.push({ start: r?.[0] ?? null, end: r?.[1] ?? null, label, amount, immatureTx: num(e.immature_tx, 0, 1e6) ?? 0 });
  }
  const activity: PoolEntry[] = [];
  for (const b of list(body.balance_transactions, 2000)) {
    if (!isObj(b) || (b.coin_type !== undefined && b.coin_type !== 'pearl')) continue;
    const amount = num(b.amount, -MAX_PRL, MAX_PRL);
    const ts = num(b.timestamp, 0, 1e14);
    if (amount === null || ts === null) throw bad();
    const label = text(b.reason, 120);
    const r = epochRange(label.replace(/^Epoch /, ''));
    const kind = r && amount >= 0 ? 'credit' : /^auto payment/i.test(label) && amount <= 0 ? 'payout' : 'other';
    activity.push({ kind, amount, at: ts, start: r?.[0] ?? null, end: r?.[1] ?? null, label });
  }
  activity.sort((a, b) => b.at - a.at);
  return {
    pool: 'pearlhash',
    address,
    workers,
    gpus: workers.reduce((a, w) => a + w.gpus.length, 0),
    hashrate: workers.reduce((a, w) => a + w.hashrate, 0),
    rigWindow: 'live',
    pending,
    maturingBlocks: Math.min(epochs.reduce((a, e) => a + e.immatureTx, 0), 1e6),
    epochs,
    days: [],
    activity: activity.slice(0, 200),
    at,
  };
}

// ---------------------------------------------------------------- Peryn

/** a rig needs this much measured time before its 24 h average is steadier than the last hour */
const PERYN_MIN_SPAN_S = 3 * 3600;

/** Validates a Peryn `/api/pool/address/{address}` response. Exported for tests. */
export function parsePeryn(body: unknown, address: string, at: number): PoolStats {
  if (!isObj(body)) throw bad();
  // the pool echoes what it answered for: refuse an answer about another address or network
  if (body.address !== undefined && body.address !== address) throw bad();
  if (body.network !== undefined && body.network !== 'mainnet') throw bad();

  const workers: PoolWorker[] = [];
  for (const [i, w] of list(body.workers, 5000).entries()) {
    if (!isObj(w)) throw bad();
    const h1 = numOr0(w.hashrate1h, MAX_HASHRATE);
    const h24 = numOr0(w.hashrate24h, MAX_HASHRATE);
    const span = numOr0(w.span24h, 1e7);
    workers.push({
      id: `w${i}`,
      name: text(w.name, 40),
      version: '',
      online: w.online === true,
      gpus: [],
      // the last-hour figure is a noisy share-count estimate (±10 %); prefer the 24 h average once
      // the rig has been measured long enough
      hashrate: span >= PERYN_MIN_SPAN_S && h24 > 0 ? h24 : h1,
      lastShareAt: isoMs(w.lastShareAt),
    });
  }
  const hr = isObj(body.hashrate) ? body.hashrate : {};
  const prl = isObj(body.prl) ? body.prl : {};
  const pending = grains(prl.owedGrains) + grains(prl.pendingGrains);
  if (pending > MAX_PRL) throw bad();

  const days: PoolDay[] = [];
  for (const d of list(body.prlDays, 60)) {
    if (!isObj(d)) throw bad();
    const day = typeof d.day === 'string' ? d.day.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) throw bad();
    days.push({ day, amount: grains(d.actualGrains) });
  }
  days.sort((a, b) => (a.day < b.day ? -1 : 1));

  const activity: PoolEntry[] = [];
  for (const p of list(body.payouts, 500)) {
    if (!isObj(p)) throw bad();
    const ts = isoMs(p.at);
    if (ts === null) throw bad();
    const status = text(p.status, 20);
    activity.push({ kind: status === 'sent' ? 'payout' : 'other', amount: -grains(p.amountGrains), at: ts, start: null, end: null, label: status });
  }
  activity.sort((a, b) => b.at - a.at);

  return {
    pool: 'peryn',
    address,
    workers,
    gpus: null,
    hashrate: hr.lastHour === undefined ? workers.reduce((a, w) => a + (w.online ? w.hashrate : 0), 0) : numOr0(hr.lastHour, MAX_HASHRATE),
    rigWindow: '24h',
    pending,
    maturingBlocks: numOr0(prl.pendingBlocks, 1e6),
    epochs: [],
    days: days.slice(-30),
    activity: activity.slice(0, 200),
    at,
  };
}

// ---------------------------------------------------------------- registry

export const POOLS: PoolInfo[] = [
  {
    id: 'pearlhash',
    name: 'Pearlhash',
    api: 'https://pearlhash.xyz/api/account/{address}',
    web: 'https://pearlhash.xyz/account/{address}',
    payoutSenders: ['prl1p50ltku2jjcwdxh4nzjrw98nwdswdn25qdkr2fdtw8hsq3qu9cdhscchnnm'],
    parse: parsePearlhash,
  },
  {
    id: 'peryn',
    name: 'Peryn',
    api: 'https://app.peryn.ai/api/pool/address/{address}',
    web: 'https://app.peryn.ai/address/{address}',
    payoutSenders: ['prl1pj7zvvfag58glzyeu7hssuwkg9sqwajxhptmjm6d7kvxnw7cj29fsa3g6f5'],
    parse: parsePeryn,
  },
];
export const poolById = (id: string) => POOLS.find(p => p.id === id);
export const poolOrigin = (p: PoolInfo) => new URL(p.api).origin;
/** The pool that pays from this address, if it is one we know. */
export const poolBySender = (address: string) => POOLS.find(p => p.payoutSenders.includes(address));

const TTL = 20_000;

/** Stats for `address` at `pool`, cached briefly in memory-only session storage. */
export async function fetchPoolStats(pool: PoolInfo, address: string): Promise<PoolStats> {
  const key = `poolStats.v2:${pool.id}:${address}`;
  const cached = (await sessionStore.get(key)) as PoolStats | undefined;
  if (cached && typeof cached.at === 'number' && Date.now() - cached.at < TTL && Array.isArray(cached.workers)) return cached;
  let res: Response;
  try {
    res = await poolFetch(pool.api.replace('{address}', encodeURIComponent(address)), {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new WalletError('pool.unreachable', { pool: pool.name });
  }
  if (!res.ok) throw new WalletError('pool.unreachable', { pool: pool.name });
  const raw = await res.text();
  if (raw.length > 3_000_000) throw bad();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw bad();
  }
  const stats = pool.parse(body, address, Date.now());
  await sessionStore.set(key, stats);
  return stats;
}

/** "14.16 PH/s" — same units as the pools' own sites */
export function formatHashrate(h: number): string {
  if (!(h > 0)) return '0 H/s';
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  let i = 0;
  while (h >= 1000 && i < units.length - 1) {
    h /= 1000;
    i++;
  }
  return `${h.toFixed(2)} ${units[i]}`;
}
