// Nockchain public API over gRPC-web — just WalletGetBalance, by note first-name.
// (nockchain.public.v2.NockchainService, protos in nockbox/iris-rs crates/iris-grpc-proto.)
//
// The node's answer is untrusted input: a tiny bounded protobuf reader that only extracts what the
// balance needs — each note's amount (nicks) and the page it appeared at — and rejects anything
// malformed. Nothing here is used for signing.

import { WalletError } from '../core/errors.ts';

export const DEFAULT_NOCK_RPC = 'https://rpc.nockbox.org';
const METHOD = '/nockchain.public.v2.NockchainService/WalletGetBalance';
const MAX_BODY = 8 * 1024 * 1024;
const MAX_NOTES = 20_000;
const MAX_PAGES = 20;
const MAX_NICKS = 2n ** 64n - 1n;

const bad = (what: string) => new WalletError('nock.invalid_data', { what });

// ---------------------------------------------------------------- protobuf (subset)

class Reader {
  pos = 0;
  readonly buf: Uint8Array;
  readonly end: number;
  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.end = buf.length;
  }
  done = () => this.pos >= this.end;
  varint(): bigint {
    let v = 0n;
    for (let shift = 0n, i = 0; i < 10; i++, shift += 7n) {
      if (this.pos >= this.end) throw bad('varint');
      const b = this.buf[this.pos++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return v;
    }
    throw bad('varint');
  }
  /** next field: [number, wireType] */
  tag(): [number, number] {
    const t = this.varint();
    const field = Number(t >> 3n);
    if (field < 1 || field > 536_870_911) throw bad('tag');
    return [field, Number(t & 7n)];
  }
  bytes(): Reader {
    const len = this.varint();
    if (len > BigInt(this.end - this.pos)) throw bad('length');
    const sub = new Reader(this.buf.subarray(this.pos, this.pos + Number(len)));
    this.pos += Number(len);
    return sub;
  }
  string(): string {
    const r = this.bytes();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(r.buf);
    } catch {
      throw bad('string');
    }
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.advance(8);
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.advance(4);
    else throw bad('wire type');
  }
  private advance(n: number) {
    if (this.pos + n > this.end) throw bad('length');
    this.pos += n;
  }
}

/** a message whose field 1 is a uint64 (Nicks, BlockHeight) */
function wrappedU64(r: Reader): bigint {
  let v = 0n;
  while (!r.done()) {
    const [f, w] = r.tag();
    if (f === 1 && w === 0) v = r.varint();
    else r.skip(w);
  }
  return v;
}

function wrappedString(r: Reader): string {
  let v = '';
  while (!r.done()) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) v = r.string();
    else r.skip(w);
  }
  return v;
}

export interface NockNote {
  nicks: bigint;
  /** block height the note appeared at */
  originPage: bigint;
}

/** common.v1.Note (legacy) and common.v2.NoteV1 keep assets/origin_page at different field numbers */
function note(r: Reader): NockNote {
  let out: NockNote | null = null;
  while (!r.done()) {
    const [f, w] = r.tag();
    if ((f === 1 || f === 2) && w === 2) {
      const legacy = f === 1;
      const n = r.bytes();
      const v: NockNote = { nicks: 0n, originPage: 0n };
      while (!n.done()) {
        const [g, x] = n.tag();
        if (x === 2 && g === (legacy ? 6 : 5)) v.nicks = wrappedU64(n.bytes());
        else if (x === 2 && g === (legacy ? 1 : 2)) v.originPage = wrappedU64(n.bytes());
        else n.skip(x);
      }
      out = v;
    } else r.skip(w);
  }
  if (!out || out.nicks > MAX_NICKS) throw bad('note');
  return out;
}

export interface BalancePage {
  notes: NockNote[];
  height: bigint;
  nextPageToken: string;
}

/** Decodes a WalletGetBalanceResponse. Exported for tests. */
export function decodeBalanceResponse(buf: Uint8Array): BalancePage {
  const r = new Reader(buf);
  let page: BalancePage | null = null;
  let error: string | null = null;
  while (!r.done()) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) {
      const b = r.bytes();
      const p: BalancePage = { notes: [], height: 0n, nextPageToken: '' };
      while (!b.done()) {
        const [g, x] = b.tag();
        if (g === 1 && x === 2) {
          const e = b.bytes();
          while (!e.done()) {
            const [h, y] = e.tag();
            if (h === 2 && y === 2) p.notes.push(note(e.bytes()));
            else e.skip(y);
          }
          if (p.notes.length > MAX_NOTES) throw bad('too many notes');
        } else if (g === 2 && x === 2) p.height = wrappedU64(b.bytes());
        else if (g === 4 && x === 2) p.nextPageToken = wrappedString(b.bytes()).slice(0, 512);
        else b.skip(x);
      }
      page = p;
    } else if (f === 2 && w === 2) {
      const e = r.bytes();
      error = '';
      while (!e.done()) {
        const [g, x] = e.tag();
        if (g === 2 && x === 2) error = e.string().slice(0, 200);
        else e.skip(x);
      }
    } else r.skip(w);
  }
  if (error !== null) throw new WalletError('nock.rpc_error', { detail: error.replace(/[\u0000-\u001f\u007f]/g, ' ') });
  if (!page) throw bad('empty response');
  return page;
}

// ---------------------------------------------------------------- request

function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}
function field(no: number, payload: Uint8Array): number[] {
  return [...varint((no << 3) | 2), ...varint(payload.length), ...payload];
}
const utf8 = (s: string) => new TextEncoder().encode(s);

/** WalletGetBalanceRequest{ first_name: { hash }, page: { client_page_items_limit, page_token } }. Exported for tests. */
export function encodeBalanceRequest(firstName: string, pageToken = ''): Uint8Array {
  const pageMsg = [...varint((1 << 3) | 0), ...varint(1000), ...(pageToken ? field(2, utf8(pageToken)) : [])];
  return Uint8Array.from([...field(2, Uint8Array.from(field(1, utf8(firstName)))), ...field(3, Uint8Array.from(pageMsg))]);
}

/** gRPC-web framing: 1 flag byte + 4-byte big-endian length per frame. Exported for tests. */
export function frame(msg: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(5 + msg.length);
  new DataView(out.buffer).setUint32(1, msg.length);
  out.set(msg, 5);
  return out;
}

/** Splits a gRPC-web response body into its message and grpc-status (from the trailer frame). */
export function unframe(body: Uint8Array): { message: Uint8Array | null; status: string | null; statusMessage: string } {
  let pos = 0;
  let message: Uint8Array | null = null;
  let status: string | null = null;
  let statusMessage = '';
  while (pos < body.length) {
    if (pos + 5 > body.length) throw bad('frame');
    const flag = body[pos];
    const len = new DataView(body.buffer, body.byteOffset + pos + 1, 4).getUint32(0);
    if (pos + 5 + len > body.length) throw bad('frame');
    const chunk = body.subarray(pos + 5, pos + 5 + len);
    if (flag & 0x80) {
      for (const line of new TextDecoder().decode(chunk).split('\r\n')) {
        const [k, ...v] = line.split(':');
        if (k.trim().toLowerCase() === 'grpc-status') status = v.join(':').trim();
        if (k.trim().toLowerCase() === 'grpc-message') statusMessage = decodeURIComponent(v.join(':').trim()).slice(0, 200);
      }
    } else if (flag === 0) {
      if (message) throw bad('frame');
      message = chunk;
    } else throw bad('frame');
    pos += 5 + len;
  }
  return { message, status, statusMessage };
}

async function call(rpc: string, req: Uint8Array): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(rpc + METHOD, {
      method: 'POST',
      headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1', accept: 'application/grpc-web+proto' },
      body: frame(req),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new WalletError('nock.unreachable', { host: new URL(rpc).host });
  }
  if (!res.ok) throw new WalletError('nock.unreachable', { host: new URL(rpc).host });
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length > MAX_BODY) throw bad('too large');
  const { message, status, statusMessage } = unframe(body);
  const st = status ?? res.headers.get('grpc-status') ?? '0';
  if (st !== '0') throw new WalletError('nock.rpc_error', { detail: statusMessage || res.headers.get('grpc-message') || `status ${st}` });
  if (!message) throw bad('empty response');
  return message;
}

/** All notes under one first-name (follows pagination, bounded). */
export async function notesByFirstName(rpc: string, firstName: string): Promise<{ notes: NockNote[]; height: bigint }> {
  const notes: NockNote[] = [];
  let height = 0n;
  let token = '';
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = decodeBalanceResponse(await call(rpc, encodeBalanceRequest(firstName, token)));
    notes.push(...page.notes);
    if (page.height > height) height = page.height;
    if (notes.length > MAX_NOTES) throw bad('too many notes');
    if (!page.nextPageToken || page.nextPageToken === token) break;
    token = page.nextPageToken;
  }
  return { notes, height };
}

export function normalizeNockRpc(u: string): string {
  let url: URL;
  try {
    url = new URL(u.trim());
  } catch {
    throw new WalletError('nock.bad_rpc');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new WalletError('nock.bad_rpc');
  return url.origin + url.pathname.replace(/\/+$/, '');
}
