// Client for Pearl Blockbook indexers (the official desktop wallet uses the same backend
// for fee estimates). Blockbook understands Pearl zpub/vpub keys and derives BIP86 Taproot
// addresses (m/86'/<coin>'/0'/{0,1}/i) with gap-limit scanning.
//
// Everything returned by an indexer is untrusted: each response is validated and size-bounded
// here and only the validated subset is handed to the rest of the app.

import { WalletError, type ErrorParams } from './errors.ts';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface BBToken {
  address: string;
  path: string;
  transfers: number;
  balance: string;
}

export interface BBIo {
  txid?: string;
  vout?: number;
  value: string;
  addresses: string[];
  isOwn: boolean;
}

export interface BBTx {
  txid: string;
  vin: BBIo[];
  vout: BBIo[];
  blockHeight: number;
  confirmations: number;
  blockTime: number;
  fees: string;
}

export interface BBXpub {
  balance: string;
  unconfirmedBalance: string;
  txs: number;
  page: number;
  totalPages: number;
  tokens: BBToken[];
  transactions: BBTx[];
}

export interface BBUtxo {
  txid: string;
  vout: number;
  value: string;
  confirmations: number;
  address?: string;
  path?: string;
}

export interface BBStatus {
  coin: string;
  bestHeight: number;
  inSync: boolean;
  chain: string;
}

export class BlockbookError extends WalletError {
  status: number;
  constructor(code: string, params: ErrorParams = {}, status = 0) {
    super(code, params);
    this.name = 'BlockbookError';
    this.status = status;
  }
}

// ---- validators -----------------------------------------------------------

const bad = (what: string): never => {
  throw new BlockbookError('indexer.invalid_data', { what });
};
const obj = (v: unknown, what: string): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(what);
const arr = (v: unknown, max: number, what: string): unknown[] =>
  v === undefined || v === null ? [] : Array.isArray(v) && v.length <= max ? v : bad(what);
const int = (v: unknown, what: string, min = -1, max = 2 ** 40): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : bad(what);
const optInt = (v: unknown, what: string, min = -1, max = 2 ** 40) => (v === undefined ? undefined : int(v, what, min, max));
const str = (v: unknown, max: number, what: string): string => (typeof v === 'string' && v.length <= max ? v : bad(what));
const optStr = (v: unknown, max: number, what: string) => (v === undefined ? undefined : str(v, max, what));
const amount = (v: unknown, what: string, signed = false): string =>
  typeof v === 'string' && (signed ? /^-?\d{1,20}$/ : /^\d{1,20}$/).test(v) ? v : bad(what);
const txid = (v: unknown, what: string): string => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : bad(what));
const addrList = (v: unknown, what: string) => arr(v, 8, what).map(a => str(a, 120, what));

function parseIo(v: unknown, isVin: boolean): BBIo {
  const o = obj(v, 'tx io');
  return {
    txid: isVin && o.txid !== undefined ? txid(o.txid, 'vin.txid') : undefined,
    vout: isVin ? optInt(o.vout, 'vin.vout', 0) : undefined,
    value: o.value === undefined ? '0' : amount(o.value, 'io.value'),
    addresses: addrList(o.addresses, 'io.addresses'),
    isOwn: o.isOwn === true,
  };
}

function parseTx(v: unknown): BBTx {
  const o = obj(v, 'tx');
  return {
    txid: txid(o.txid, 'tx.txid'),
    vin: arr(o.vin, 5000, 'tx.vin').map(x => parseIo(x, true)),
    vout: arr(o.vout, 5000, 'tx.vout').map(x => parseIo(x, false)),
    blockHeight: int(o.blockHeight ?? -1, 'tx.blockHeight'),
    confirmations: int(o.confirmations ?? 0, 'tx.confirmations', 0),
    blockTime: int(o.blockTime ?? 0, 'tx.blockTime', 0),
    fees: o.fees === undefined ? '0' : amount(o.fees, 'tx.fees'),
  };
}

// ---- client ---------------------------------------------------------------

export class Blockbook {
  readonly base: string;
  private fetchFn: FetchFn;
  constructor(base: string, fetchFn: FetchFn = (u, i) => fetch(u, i)) {
    const u = new URL(base);
    if (u.protocol !== 'https:') throw new BlockbookError('indexer.https_required');
    this.base = u.origin + u.pathname.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
  }

  private async req(path: string, init?: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        ...init,
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new BlockbookError('indexer.unreachable', { detail: e instanceof Error ? e.message : String(e) });
    }
    const text = await res.text();
    if (text.length > 20_000_000) bad('response too large');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new BlockbookError('indexer.non_json', { status: res.status }, res.status);
    }
    const err = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
    if (!res.ok || err !== undefined) {
      const msg =
        typeof err === 'string' ? err : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : `HTTP ${res.status}`;
      throw new BlockbookError('indexer.rejected', { detail: msg.slice(0, 300) }, res.status);
    }
    return body;
  }

  async status(): Promise<BBStatus> {
    const o = obj(await this.req('/api/v2'), 'status');
    const bb = obj(o.blockbook, 'status.blockbook');
    const be = obj(o.backend, 'status.backend');
    return {
      coin: str(bb.coin, 64, 'coin'),
      bestHeight: int(bb.bestHeight, 'bestHeight', 0),
      inSync: bb.inSync === true,
      chain: str(be.chain, 32, 'chain'),
    };
  }

  async xpub(descriptor: string, opts: { page?: number; pageSize?: number }): Promise<BBXpub> {
    const q = new URLSearchParams({ details: 'txs', tokens: 'used', page: String(opts.page ?? 1), pageSize: String(opts.pageSize ?? 25) });
    const o = obj(await this.req(`/api/v2/xpub/${encodeURIComponent(descriptor)}?${q}`), 'xpub');
    return {
      balance: amount(o.balance, 'balance'),
      unconfirmedBalance: amount(o.unconfirmedBalance ?? '0', 'unconfirmedBalance', true),
      txs: int(o.txs ?? 0, 'txs', 0),
      page: int(o.page ?? 1, 'page', 0),
      totalPages: int(o.totalPages ?? 1, 'totalPages', -1),
      tokens: arr(o.tokens, 20_000, 'tokens').map(t => {
        const x = obj(t, 'token');
        return {
          address: str(x.name, 120, 'token.name'),
          path: str(x.path, 64, 'token.path'),
          transfers: int(x.transfers ?? 0, 'token.transfers', 0),
          balance: x.balance === undefined ? '0' : amount(x.balance, 'token.balance'),
        };
      }),
      transactions: arr(o.transactions, 1000, 'transactions').map(parseTx),
    };
  }

  async utxos(descriptor: string): Promise<BBUtxo[]> {
    const list = arr(await this.req(`/api/v2/utxo/${encodeURIComponent(descriptor)}?confirmed=false`), 20_000, 'utxo');
    return list.map(u => {
      const o = obj(u, 'utxo');
      return {
        txid: txid(o.txid, 'utxo.txid'),
        vout: int(o.vout, 'utxo.vout', 0, 100_000),
        value: amount(o.value, 'utxo.value'),
        confirmations: int(o.confirmations ?? 0, 'utxo.confirmations', 0),
        address: optStr(o.address, 120, 'utxo.address'),
        path: optStr(o.path, 64, 'utxo.path'),
      };
    });
  }

  async tx(id: string): Promise<BBTx> {
    return parseTx(await this.req(`/api/v2/tx/${txid(id, 'txid')}`));
  }

  /** grain/vB (Blockbook answers PRL/kB), or null if unavailable */
  async estimateFee(blocks: number): Promise<number | null> {
    const o = obj(await this.req(`/api/v2/estimatefee/${int(blocks, 'blocks', 1, 1008)}`), 'estimatefee');
    const s = str(o.result, 32, 'estimatefee.result');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const prlPerKb = Number(s);
    return prlPerKb > 0 ? (prlPerKb * 1e8) / 1000 : null;
  }

  async broadcast(hex: string): Promise<string> {
    if (!/^[0-9a-f]+$/.test(hex)) throw new BlockbookError('indexer.invalid_data', { what: 'tx hex' });
    const o = obj(
      await this.req('/api/v2/sendtx/', { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } }),
      'sendtx',
    );
    return txid(o.result, 'sendtx.result');
  }
}

/** "m/86'/808276'/0'/1/7" -> { branch: 1, index: 7 } (only for our account prefix) */
export function parseTokenPath(path: string | undefined, accountPrefix: string): { branch: number; index: number } | null {
  if (!path || !path.startsWith(accountPrefix + '/')) return null;
  const m = /^(\d{1,2})\/(\d{1,6})$/.exec(path.slice(accountPrefix.length + 1));
  if (!m) return null;
  return { branch: Number(m[1]), index: Number(m[2]) };
}
