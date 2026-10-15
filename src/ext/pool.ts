// Mining-pool stats (rigs, hashrate, pending rewards) — opt-in, per wallet. The pool is asked about
// one address: the one you mine to. Responses are untrusted input: validated, bounded, and rendered
// as plain text only. Worker names in particular are chosen by whoever points a rig at the address.
//
// Pearlhash (pearlhash.xyz) API verified 2026-10-15: GET /api/account/{address} → connected_workers
// (gpu_info hashrate in H/s), pending_rewards, balance_transactions. No CORS headers, so the
// extension asks for that one origin at runtime (optional host permission). The response also
// contains each worker's IP address — never read, kept or shown here.

import { WalletError } from '../core/errors.ts';
import { poolFetch, sessionStore } from './platform.ts';

export interface PoolInfo {
  id: string;
  name: string;
  /** https URL template with {address} */
  api: string;
  /** the pool's own page for the address */
  web: string;
}

export const POOLS: PoolInfo[] = [
  { id: 'pearlhash', name: 'Pearlhash', api: 'https://pearlhash.xyz/api/account/{address}', web: 'https://pearlhash.xyz/account/{address}' },
];
export const poolById = (id: string) => POOLS.find(p => p.id === id);
export const poolOrigin = (p: PoolInfo) => new URL(p.api).origin;

export interface PoolGpu {
  name: string;
  /** H/s */
  hashrate: number;
}
export interface PoolWorker {
  id: string;
  name: string;
  version: string;
  gpus: PoolGpu[];
  hashrate: number;
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
export interface PoolStats {
  pool: string;
  address: string;
  workers: PoolWorker[];
  gpus: number;
  hashrate: number;
  /** PRL earned at the pool, not yet paid out */
  pending: number;
  epochs: PoolEpoch[];
  activity: PoolEntry[];
  at: number;
}

const bad = () => new WalletError('pool.invalid_data');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
// printable text only, bounded
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, max) : '');
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const MAX_PRL = 21e9;

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
export function parseAccount(body: unknown, pool: string, address: string, at: number): PoolStats {
  if (!isObj(body)) throw bad();
  const workers: PoolWorker[] = [];
  for (const [i, w] of list(body.connected_workers, 1000).entries()) {
    if (!isObj(w)) throw bad();
    const gpus: PoolGpu[] = [];
    for (const g of list(w.gpu_info, 64)) {
      if (!isObj(g)) throw bad();
      const hashrate = num(g.hashrate, 0, 1e21);
      if (hashrate === null) throw bad();
      gpus.push({ name: text(g.name, 64), hashrate });
    }
    const id = text(w.worker_id, 40);
    workers.push({
      id: /^[\w-]+$/.test(id) ? id : `w${i}`,
      name: text(w.worker_name, 40),
      version: text(w.version, 40),
      gpus,
      hashrate: gpus.reduce((a, g) => a + g.hashrate, 0),
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
    pool,
    address,
    workers,
    gpus: workers.reduce((a, w) => a + w.gpus.length, 0),
    hashrate: workers.reduce((a, w) => a + w.hashrate, 0),
    pending,
    epochs,
    activity: activity.slice(0, 200),
    at,
  };
}

const TTL = 20_000;

/** Stats for `address` at `pool`, cached briefly in memory-only session storage. */
export async function fetchPoolStats(pool: PoolInfo, address: string): Promise<PoolStats> {
  const key = `poolStats.v1:${pool.id}:${address}`;
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
  const stats = parseAccount(body, pool.id, address, Date.now());
  await sessionStore.set(key, stats);
  return stats;
}

/** "14.16 PH/s" — same units as the pool's own site */
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
