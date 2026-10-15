// Wallet service for the extension page. Runs inside the extension's own page — no background
// worker, no content scripts, no page-facing provider.
//
// Key-material lifecycle:
//   * at rest: VaultEntry (Argon2id + AES-256-GCM) in chrome.storage.local
//   * unlocked session: only the account xpub + wallet id in chrome.storage.session
//   * mnemonic / seed / private keys: decrypted on demand (send, reveal), used, zeroed, dropped

import {
  AddressBook,
  MAX_ADDRESS_INDEX,
  accountPathString,
  deriveAccount,
  newMnemonic,
  parseSeed,
  privateKeyAt,
  seedBytes,
} from '../core/account.ts';
import { decodeAddress, isValidAddress } from '../core/address.ts';
import { WalletError } from '../core/errors.ts';
import { Blockbook, BlockbookError, parseTokenPath, type BBTx, type BBXpub } from '../core/blockbook.ts';
import { decryptWallet, encryptWallet, passwordProblem, reencryptWallet, type VaultEntry } from '../core/keystore.ts';
import { COINBASE_MATURITY, EXTERNAL, INTERNAL, MAX_SANE_FEE_PER_VB, MIN_RELAY_FEE_PER_VB, NETWORKS, type NetworkId, type PearlNetwork } from '../core/networks.ts';
import { InsufficientFunds, planTransaction, signPlan, type TxPlan, type WalletUtxo } from '../core/tx.ts';
import { dailyPnl, localDay } from '../core/pnl.ts';
import { formatPrl, parsePrl } from './format.ts';
import { indexerFetch, localStore, sessionStore } from './platform.ts';
import { FIATS, priceAt, spot } from './price.ts';
import { fetchPoolStats, poolById, type PoolStats } from './pool.ts';
import type {
  AddressRow,
  Explorer,
  FeeEstimates,
  Fiat,
  ImportPreview,
  IndexerStatus,
  Overview,
  PnlDay,
  PnlView,
  PoolConfig,
  SeedArgs,
  SeedCheck,
  SendDraft,
  SendPreview,
  OwnRecipient,
  SessionInfo,
  Settings,
  TxItem,
  WalletMeta,
} from './types.ts';

const K_VAULT = 'vault.v1';
const K_SETTINGS = 'settings.v1';
const K_SESSION = 'session.v1';
const K_LAST = 'lastWallet.v1';
const K_PNL = 'pnl.v1';
const K_POOL = 'pool.v1';
const K_PAYOUT_ADDRS = 'payoutAddrs.v1';
const K_PRICE_OPEN = 'priceOpen.v1';

// ---------------------------------------------------------------- vault & settings

async function readVault(): Promise<VaultEntry[]> {
  const v = await localStore.get(K_VAULT);
  return Array.isArray(v) ? (v as VaultEntry[]).filter(e => e && e.version === 1) : [];
}
const writeVault = (entries: VaultEntry[]) => localStore.set(K_VAULT, entries);
const meta = (e: VaultEntry): WalletMeta => ({ id: e.id, name: e.name, network: e.network, mode: e.mode, createdAt: e.createdAt });

export async function listWallets(): Promise<WalletMeta[]> {
  return (await readVault()).map(meta);
}

export async function lastWalletId(): Promise<string | undefined> {
  const v = await localStore.get(K_LAST);
  return typeof v === 'string' ? v : undefined;
}

const DEFAULT_SETTINGS: Settings = {
  indexers: { mainnet: [...NETWORKS.mainnet.blockbook], testnet2: [...NETWORKS.testnet2.blockbook] },
  customExplorers: { mainnet: [], testnet2: [] },
  explorer: { mainnet: NETWORKS.mainnet.explorers[0].id, testnet2: NETWORKS.testnet2.explorers[0].id },
  autoLockMinutes: 15,
  language: 'en',
  fiat: 'off',
};

const NETWORK_IDS = Object.keys(NETWORKS) as NetworkId[];

export async function getSettings(): Promise<Settings> {
  const s = (await localStore.get(K_SETTINGS)) as Partial<Settings> | undefined;
  const clean = (list: unknown, fallback: string[]) =>
    Array.isArray(list) && list.length ? list.filter((u): u is string => typeof u === 'string' && u.startsWith('https://')).slice(0, 8) : fallback;
  const customs = (id: NetworkId) => {
    const list = s?.customExplorers?.[id];
    if (!Array.isArray(list)) return [];
    // stored data is re-validated on every read
    return list.flatMap(e => {
      try {
        return [{ id: String(e.id), ...checkExplorer(e.name, e.tx, e.address) }];
      } catch {
        return [];
      }
    }).slice(0, 8);
  };
  const out: Settings = {
    indexers: { mainnet: clean(s?.indexers?.mainnet, DEFAULT_SETTINGS.indexers.mainnet), testnet2: clean(s?.indexers?.testnet2, DEFAULT_SETTINGS.indexers.testnet2) },
    customExplorers: { mainnet: customs('mainnet'), testnet2: customs('testnet2') },
    explorer: { ...DEFAULT_SETTINGS.explorer },
    autoLockMinutes: typeof s?.autoLockMinutes === 'number' ? Math.min(Math.max(s.autoLockMinutes, 1), 240) : 15,
    language: s?.language === 'zh-CN' ? 'zh-CN' : 'en',
    fiat: FIATS.includes(s?.fiat as Fiat) ? (s!.fiat as Fiat) : 'off',
  };
  for (const id of NETWORK_IDS) {
    const wanted = s?.explorer?.[id];
    if (wanted && explorersFrom(out, id).some(e => e.id === wanted)) out.explorer[id] = wanted;
  }
  return out;
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  for (const id of NETWORK_IDS) {
    next.indexers[id] = next.indexers[id].map(u => normalizeIndexerUrl(u));
    if (!next.indexers[id].length) throw new WalletError('indexer.need_one');
  }
  await localStore.set(K_SETTINGS, next);
  indexerCache.clear();
  return getSettings();
}

// ---------------------------------------------------------------- explorers

const explorersFrom = (s: Settings, network: NetworkId): Explorer[] => [
  ...NETWORKS[network].explorers.map(e => ({ ...e, builtin: true })),
  ...s.customExplorers[network].map(e => ({ ...e, builtin: false })),
];

export async function listExplorers(network: NetworkId): Promise<{ explorers: Explorer[]; selected: string }> {
  const s = await getSettings();
  return { explorers: explorersFrom(s, network), selected: s.explorer[network] };
}

/** Validates a user-supplied explorer: https only, no credentials, each placeholder exactly once. */
export function checkExplorer(name: unknown, tx: unknown, address: unknown): { name: string; tx: string; address: string } {
  const n = typeof name === 'string' ? name.trim().slice(0, 32) : '';
  if (!n) throw new WalletError('explorer.name_required');
  const template = (t: unknown, ph: string) => {
    const v = typeof t === 'string' ? t.trim() : '';
    if (v.split(ph).length !== 2) throw new WalletError('explorer.bad_template', { placeholder: ph });
    let url: URL;
    try {
      url = new URL(v.replace(ph, 'x'));
    } catch {
      throw new WalletError('explorer.bad_template', { placeholder: ph });
    }
    if (url.protocol !== 'https:' || url.username || url.password) throw new WalletError('explorer.bad_template', { placeholder: ph });
    return v;
  };
  return { name: n, tx: template(tx, '{txid}'), address: template(address, '{address}') };
}

export async function addExplorer(network: NetworkId, input: { name: string; tx: string; address: string }): Promise<Settings> {
  const s = await getSettings();
  const e = { id: `custom-${crypto.randomUUID()}`, ...checkExplorer(input.name, input.tx, input.address) };
  s.customExplorers[network] = [...s.customExplorers[network], e];
  s.explorer[network] = e.id;
  return setSettings(s);
}

export async function removeExplorer(network: NetworkId, id: string): Promise<Settings> {
  const s = await getSettings();
  s.customExplorers[network] = s.customExplorers[network].filter(e => e.id !== id);
  if (s.explorer[network] === id) s.explorer[network] = NETWORKS[network].explorers[0].id;
  return setSettings(s);
}

export async function selectExplorer(network: NetworkId, id: string): Promise<Settings> {
  const s = await getSettings();
  if (!explorersFrom(s, network).some(e => e.id === id)) throw new WalletError('explorer.invalid_target');
  s.explorer[network] = id;
  return setSettings(s);
}

export function normalizeIndexerUrl(u: string): string {
  let url: URL;
  try {
    url = new URL(u.trim());
  } catch {
    throw new WalletError('indexer.bad_url');
  }
  if (url.protocol !== 'https:') throw new WalletError('indexer.https_required');
  if (url.username || url.password || url.search || url.hash) throw new WalletError('indexer.url_extras');
  return url.origin + url.pathname.replace(/\/+$/, '');
}

// ---------------------------------------------------------------- indexers

const indexerCache = new Map<NetworkId, Promise<Blockbook>>();

/** First configured indexer that answers and reports the expected chain. Never trusts a mismatching chain. */
function indexer(network: NetworkId): Promise<Blockbook> {
  let p = indexerCache.get(network);
  if (!p) {
    p = pickIndexer(network);
    indexerCache.set(network, p);
    p.catch(() => indexerCache.delete(network));
  }
  return p;
}

async function pickIndexer(network: NetworkId): Promise<Blockbook> {
  const net = NETWORKS[network];
  const errors: unknown[] = [];
  const hosts: string[] = [];
  for (const url of (await getSettings()).indexers[network]) {
    try {
      const bb = new Blockbook(url, indexerFetch);
      const st = await bb.status();
      if (st.chain !== net.backendChain) {
        errors.push(new WalletError('indexer.chain_mismatch', { chain: st.chain, expected: net.backendChain }));
        hosts.push(new URL(url).host);
        continue;
      }
      return bb;
    } catch (e) {
      errors.push(e);
      hosts.push(new URL(url).host);
    }
  }
  // a single configured node: surface its own (localisable) error
  if (errors.length === 1) throw errors[0];
  throw new BlockbookError('indexer.none_available', { detail: hosts.join(', ') });
}

export async function indexerStatus(network: NetworkId, url: string): Promise<IndexerStatus> {
  try {
    const t0 = performance.now();
    const st = await new Blockbook(url, indexerFetch).status();
    const latencyMs = Math.round(performance.now() - t0);
    const expected = NETWORKS[network].backendChain;
    const ok = st.chain === expected;
    return { ok, url, latencyMs, height: st.bestHeight, chain: st.chain, inSync: st.inSync, error: ok ? undefined : new WalletError('indexer.chain_mismatch', { chain: st.chain, expected }) };
  } catch (e) {
    return { ok: false, url, error: e };
  }
}

export async function explorerUrl(network: NetworkId, kind: 'tx' | 'address', value: string): Promise<string> {
  const ok = kind === 'tx' ? /^[0-9a-f]{64}$/.test(value) : isValidAddress(value, NETWORKS[network]);
  if (!ok) throw new WalletError('explorer.invalid_target');
  const s = await getSettings();
  const ex = explorersFrom(s, network).find(e => e.id === s.explorer[network]) ?? explorersFrom(s, network)[0];
  return kind === 'tx' ? ex.tx.replace('{txid}', encodeURIComponent(value)) : ex.address.replace('{address}', encodeURIComponent(value));
}

// ---------------------------------------------------------------- session

interface Session {
  walletId: string;
  name: string;
  network: NetworkId;
  mode: VaultEntry['mode'];
  xpub: string;
  lastActive: number;
}

let book: { xpub: string; book: AddressBook } | null = null;
const addressBook = (s: Session) => {
  if (!book || book.xpub !== s.xpub) book = { xpub: s.xpub, book: new AddressBook(s.xpub, NETWORKS[s.network]) };
  return book.book;
};

const info = (s: Session): SessionInfo => ({
  walletId: s.walletId,
  name: s.name,
  network: s.network,
  networkLabel: NETWORKS[s.network].label,
  mode: s.mode,
  accountPath: accountPathString(NETWORKS[s.network]),
  hrp: NETWORKS[s.network].hrp,
});

async function readSession(touch: boolean): Promise<Session | null> {
  const s = (await sessionStore.get(K_SESSION)) as Session | undefined;
  if (!s) return null;
  const { autoLockMinutes } = await getSettings();
  if (Date.now() - s.lastActive > autoLockMinutes * 60_000) {
    await lock();
    return null;
  }
  if (touch) await sessionStore.set(K_SESSION, { ...s, lastActive: Date.now() });
  return s;
}

async function requireSession(): Promise<Session> {
  const s = await readSession(true);
  if (!s) throw new LockedError();
  return s;
}

export class LockedError extends WalletError {
  constructor() {
    super('session.locked');
    this.name = 'LockedError';
  }
}

export async function session(): Promise<SessionInfo | null> {
  const s = await readSession(true);
  return s ? info(s) : null;
}

export async function lock() {
  await sessionStore.remove(K_SESSION);
  drafts.clear();
  book = null;
}

async function start(entry: VaultEntry, xpub: string): Promise<SessionInfo> {
  const s: Session = { walletId: entry.id, name: entry.name, network: entry.network, mode: entry.mode, xpub, lastActive: Date.now() };
  await sessionStore.set(K_SESSION, s);
  await localStore.set(K_LAST, entry.id);
  return info(s);
}

/** Derive the account xpub from a decrypted secret; all private material is wiped before returning. */
async function xpubFor(secret: string, passphrase: string, network: NetworkId, mode: VaultEntry['mode']) {
  const seed = await seedBytes(secret, passphrase);
  try {
    const acct = deriveAccount(seed, NETWORKS[network], mode);
    acct.accountPriv.wipePrivateData();
    return { xpub: acct.xpub, diverges: acct.divergesFromBip32 };
  } finally {
    seed.fill(0);
  }
}

// ---------------------------------------------------------------- create / import / unlock

export function generateMnemonic(words: 12 | 24 = 12): string {
  return newMnemonic(words);
}

export function checkSeed(text: string): SeedCheck {
  const p = parseSeed(text);
  if (p.kind === 'invalid') return { ok: false, reason: p.reason };
  return { ok: true, kind: p.kind, wordCount: p.kind === 'mnemonic' ? p.wordCount : undefined };
}

export async function previewImport(args: SeedArgs): Promise<ImportPreview> {
  const net = NETWORKS[args.network];
  const { xpub, diverges } = await xpubFor(args.secret, args.passphrase, args.network, args.mode);
  const out: ImportPreview = {
    firstAddress: new AddressBook(xpub, net).get(EXTERNAL, 0).address,
    accountPath: accountPathString(net),
    divergesFromBip32: diverges,
    activity: null,
  };
  try {
    const x = await (await indexer(args.network)).xpub(`tr(${xpub})`, { page: 1, pageSize: 1 });
    out.activity = { txs: x.txs, balance: x.balance, usedAddresses: x.tokens.length };
  } catch (e) {
    out.activityError = e;
  }
  return out;
}

export async function createWallet(args: SeedArgs & { name: string; password: string }): Promise<SessionInfo> {
  const problem = passwordProblem(args.password);
  if (problem) throw new WalletError(problem);
  const p = parseSeed(args.secret);
  if (p.kind === 'invalid') throw new WalletError(p.reason.code, p.reason.params);
  const { xpub } = await xpubFor(p.normalized, args.passphrase, args.network, args.mode);
  const vault = await readVault();
  const name = args.name.trim().slice(0, 32) || `Wallet ${vault.length + 1}`;
  const entry = await encryptWallet({ name, network: args.network, mode: args.mode }, { secret: p.normalized, passphrase: args.passphrase }, args.password);
  entry.xpub = xpub;
  await writeVault([...vault, entry]);
  return start(entry, xpub);
}

async function entryById(id: string): Promise<VaultEntry> {
  const e = (await readVault()).find(x => x.id === id);
  if (!e) throw new WalletError('wallet.not_found');
  return e;
}

export async function unlock(id: string, password: string): Promise<SessionInfo> {
  const entry = await entryById(id);
  const secret = await decryptWallet(entry, password);
  const { xpub } = await xpubFor(secret.secret, secret.passphrase, entry.network, entry.mode);
  if (entry.xpub !== xpub) {
    // backfill for older entries, and repair if the clear-text copy was ever altered
    const vault = await readVault();
    const e = vault.find(x => x.id === id);
    if (e) {
      e.xpub = xpub;
      await writeVault(vault);
    }
  }
  return start(entry, xpub);
}

// ---------------------------------------------------------------- chain data

const coinbaseCache = new Map<string, boolean>();

// Addresses seen paying us from coinbase outputs (mining pools). Public chain facts, kept locally so
// later payouts are recognised without extra lookups.
const K_POOLS = 'miningSenders.v1';
async function knownPools(): Promise<Set<string>> {
  const v = await localStore.get(K_POOLS);
  return new Set(Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string').slice(0, 200) : []);
}

async function isCoinbaseTx(bb: Blockbook, txid: string): Promise<boolean> {
  let cb = coinbaseCache.get(txid);
  if (cb === undefined) {
    cb = isCoinbase(await bb.tx(txid));
    coinbaseCache.set(txid, cb);
  }
  return cb;
}

const MAX_PAYOUT_LOOKUPS = 12;

/** Marks incoming payments that are funded by coinbase outputs (pool payouts). */
async function tagPoolPayouts(bb: Blockbook, txs: BBTx[], items: TxItem[], net: PearlNetwork) {
  const pools = await knownPools();
  const before = pools.size;
  let lookups = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.direction !== 'in' || it.coinbase) continue;
    const sender = txs[i].vin.find(v => !v.isOwn)?.addresses[0];
    if (sender && pools.has(sender)) {
      it.poolPayout = true;
      continue;
    }
    const prev = txs[i].vin[0]?.txid;
    if (!prev || lookups >= MAX_PAYOUT_LOOKUPS) continue;
    lookups++;
    try {
      if (await isCoinbaseTx(bb, prev)) {
        it.poolPayout = true;
        if (sender && isValidAddress(sender, net)) pools.add(sender);
      }
    } catch {
      // best effort: an unreachable lookup just leaves the item as a plain receive
    }
  }
  if (pools.size !== before) await localStore.set(K_POOLS, [...pools].slice(-200));
}
const MAX_COINBASE_LOOKUPS = 200;

const HISTORY_PAGE_SIZE = 20;

interface ChainState {
  x: BBXpub;
  utxos: WalletUtxo[];
  immature: bigint;
  nextReceive: number;
  nextChange: number;
  rejected: number;
}

/** Fetch xpub data + UTXOs and re-check every path against local derivation. */
async function loadChain(s: Session, page = 1, pageSize = HISTORY_PAGE_SIZE): Promise<ChainState> {
  const net = NETWORKS[s.network];
  const ab = addressBook(s);
  const bb = await indexer(s.network);
  const desc = `tr(${s.xpub})`;
  const prefix = accountPathString(net);
  const [x, rawUtxos] = await Promise.all([bb.xpub(desc, { page, pageSize }), bb.utxos(desc)]);

  let rejected = 0;
  const maxUsed = [-1, -1];
  for (const t of x.tokens) {
    const p = parseTokenPath(t.path, prefix);
    if (!p || p.branch > 1 || p.index > MAX_ADDRESS_INDEX || ab.get(p.branch, p.index).address !== t.address) {
      rejected++;
      continue;
    }
    if (t.transfers > 0) maxUsed[p.branch] = Math.max(maxUsed[p.branch], p.index);
  }

  const utxos: WalletUtxo[] = [];
  let immature = 0n;
  let lookups = 0;
  for (const u of rawUtxos) {
    const p = parseTokenPath(u.path, prefix);
    if (!p || p.branch > 1 || p.index > MAX_ADDRESS_INDEX) {
      rejected++;
      continue;
    }
    const local = ab.get(p.branch, p.index).address;
    if (u.address && u.address !== local) {
      rejected++;
      continue;
    }
    const value = BigInt(u.value);
    if (u.confirmations > 0 && u.confirmations < COINBASE_MATURITY) {
      let cb = coinbaseCache.get(u.txid);
      if (cb === undefined) {
        // conservative: if we cannot check, treat as immature
        cb = lookups++ < MAX_COINBASE_LOOKUPS ? isCoinbase(await bb.tx(u.txid)) : true;
        coinbaseCache.set(u.txid, cb);
      }
      if (cb) {
        immature += value;
        continue;
      }
    }
    utxos.push({ txid: u.txid, vout: u.vout, value, confirmations: u.confirmations, branch: p.branch, index: p.index, address: local });
  }
  return { x, utxos, immature, nextReceive: maxUsed[EXTERNAL] + 1, nextChange: maxUsed[INTERNAL] + 1, rejected };
}

const isCoinbase = (t: BBTx) => t.vin.length === 1 && !t.vin[0].txid;

function toTxItem(t: BBTx, net: PearlNetwork): TxItem {
  let inOwn = 0n;
  let outOwn = 0n;
  let foreignIn: string | undefined;
  let foreignOut: string | undefined;
  let allOutOwn = true;
  for (const i of t.vin) {
    if (i.isOwn) inOwn += BigInt(i.value);
    else foreignIn ??= i.addresses[0];
  }
  for (const o of t.vout) {
    if (o.isOwn) outOwn += BigInt(o.value);
    else {
      if (o.addresses.length) allOutOwn = false;
      foreignOut ??= o.addresses[0];
    }
  }
  const net_ = outOwn - inOwn;
  const direction: TxItem['direction'] = inOwn > 0n ? (allOutOwn ? 'self' : 'out') : 'in';
  const cp = direction === 'in' ? foreignIn : direction === 'out' ? foreignOut : undefined;
  return {
    txid: t.txid,
    direction,
    net: net_.toString(),
    fee: t.fees,
    confirmations: t.confirmations,
    time: t.blockTime,
    coinbase: isCoinbase(t),
    poolPayout: false,
    counterparty: cp && isValidAddress(cp, net) ? cp : undefined,
  };
}

export async function overview(page = 1): Promise<Overview> {
  const s = await requireSession();
  const net = NETWORKS[s.network];
  const ab = addressBook(s);
  const bb = await indexer(s.network);
  const [c, st] = await Promise.all([loadChain(s, page), bb.status()]);
  const confirmed = c.utxos.filter(u => u.confirmations > 0).reduce((a, u) => a + u.value, 0n);
  const unconfirmed = c.utxos.filter(u => u.confirmations === 0).reduce((a, u) => a + u.value, 0n);
  const prefix = accountPathString(net);
  const addresses: AddressRow[] = [];
  for (const t of c.x.tokens) {
    const p = parseTokenPath(t.path, prefix);
    if (p && p.branch <= 1 && ab.get(p.branch, p.index).address === t.address) {
      addresses.push({ address: t.address, path: t.path, transfers: t.transfers, balance: t.balance });
    }
  }
  const receive = ab.get(EXTERNAL, c.nextReceive);
  const history = c.x.transactions.map(t => toTxItem(t, net));
  await tagPoolPayouts(bb, c.x.transactions, history, net);
  const today = await todaysTxs(s, bb, c.x, history);
  const minedToday = today.items.filter(h => (h.coinbase || h.poolPayout) && BigInt(h.net) > 0n).reduce((a, h) => a + BigInt(h.net), 0n);
  const netToday = today.items.reduce((a, h) => a + BigInt(h.net), 0n);
  // which of our addresses the mining income goes to (only addresses that passed local derivation)
  const own = new Set(addresses.map(a => a.address));
  const hits = new Map<string, number>();
  history.forEach((h, i) => {
    if (!(h.coinbase || h.poolPayout)) return;
    for (const o of c.x.transactions[i].vout) if (o.isOwn && o.addresses[0] && own.has(o.addresses[0])) hits.set(o.addresses[0], (hits.get(o.addresses[0]) ?? 0) + 1);
  });
  const payoutAddresses = [...hits].sort((a, b) => b[1] - a[1]).map(([a]) => a).slice(0, 5);
  if (payoutAddresses.length) await sessionStore.set(K_PAYOUT_ADDRS, { walletId: s.walletId, addresses: payoutAddresses });
  return {
    confirmed: confirmed.toString(),
    unconfirmed: unconfirmed.toString(),
    immature: c.immature.toString(),
    spendable: (confirmed + unconfirmed).toString(),
    receiveAddress: receive.address,
    receivePath: `${prefix}/${EXTERNAL}/${c.nextReceive}`,
    txCount: c.x.txs,
    history,
    page: c.x.page,
    totalPages: Math.max(c.x.totalPages, 1),
    addresses,
    tip: st.bestHeight,
    indexer: bb.base,
    rejected: c.rejected,
    minedToday: minedToday.toString(),
    netToday: netToday.toString(),
    todayComplete: today.complete,
    payoutAddresses,
    updatedAt: Date.now(),
  };
}

const TODAY_MAX_PAGES = 5;

/**
 * Today's transactions (local time, plus anything pending). History is newest first; on a busy
 * mining wallet page 1 may not reach back to midnight, so follow a few more pages.
 */
async function todaysTxs(s: Session, bb: Blockbook, first: BBXpub, firstItems: TxItem[]): Promise<{ items: TxItem[]; complete: boolean }> {
  if (first.page !== 1) return { items: [], complete: false };
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const isToday = (h: TxItem) => h.confirmations === 0 || h.time * 1000 >= midnight.getTime();
  const items = firstItems.filter(isToday);
  let page = first;
  let last = firstItems;
  const reachesOn = () => last.length > 0 && isToday(last[last.length - 1]) && page.totalPages > page.page;
  while (reachesOn() && page.page < TODAY_MAX_PAGES) {
    page = await bb.xpub(`tr(${s.xpub})`, { page: page.page + 1, pageSize: HISTORY_PAGE_SIZE });
    last = page.transactions.map(t => toTxItem(t, NETWORKS[s.network]));
    await tagPoolPayouts(bb, page.transactions, last, NETWORKS[s.network]);
    items.push(...last.filter(isToday));
  }
  return { items, complete: !reachesOn() };
}

// ---------------------------------------------------------------- fiat value & daily P&L
//
// Opt-in (Settings → Price & P&L). Prices come from CoinGecko; nothing about the wallet is sent.
// Each day's figures are logged on this device only, so the user can look back day by day.

const PNL_KEEP_DAYS = 90;

/** Price at local midnight, fetched once per day and currency. */
async function openPrice(fiat: Fiat, day: string, midnightMs: number): Promise<number> {
  const cache = ((await localStore.get(K_PRICE_OPEN)) ?? {}) as Record<string, unknown>;
  const key = `${fiat}:${day}`;
  const hit = cache[key];
  if (typeof hit === 'number' && Number.isFinite(hit) && hit > 0) return hit;
  const p = await priceAt(fiat, midnightMs);
  const keep = Object.fromEntries(Object.entries(cache).filter(([k, v]) => k.endsWith(`:${day}`) && typeof v === 'number'));
  await localStore.set(K_PRICE_OPEN, { ...keep, [key]: p });
  return p;
}

type PnlLog = Record<string, Record<string, PnlDay>>;
const pnlKey = (walletId: string, fiat: Fiat) => `${walletId}:${fiat}`;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const grains = (v: unknown) => typeof v === 'string' && /^\d{1,20}$/.test(v);

async function readPnlLog(): Promise<PnlLog> {
  const v = await localStore.get(K_PNL);
  return v && typeof v === 'object' ? (v as PnlLog) : {};
}

/**
 * Today's fiat value and P&L for the current wallet, given a fresh overview (page 1).
 * 'off' when the user hasn't turned prices on; 'unsupported' on test networks (no market price).
 */
export async function pnlToday(o: Overview): Promise<PnlView | 'off' | 'unsupported'> {
  const s = await requireSession();
  if (s.network !== 'mainnet') return 'unsupported';
  const { fiat } = await getSettings();
  if (fiat === 'off') return 'off';
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const day = localDay(midnight);
  const [now, open] = await Promise.all([spot(fiat), openPrice(fiat, day, midnight.getTime())]);
  const holdings = BigInt(o.spendable) + BigInt(o.immature);
  const r = dailyPnl({ holdingsNow: holdings, netFlowToday: BigInt(o.netToday), minedToday: BigInt(o.minedToday), priceNow: now.price, priceOpen: open });
  const view: PnlView = {
    fiat,
    price: now.price,
    change24h: now.change24h,
    flip: now.flip,
    priceOpen: open,
    holdings: holdings.toString(),
    balanceOpen: r.balanceOpen.toString(),
    minedToday: o.minedToday,
    valueNow: r.valueNow,
    pnlPrice: r.pnlPrice,
    pnlMined: r.pnlMined,
    pnl: r.pnl,
    pnlPct: r.pnlPct,
    partial: !o.todayComplete,
  };
  if (o.todayComplete) {
    const log = await readPnlLog();
    const k = pnlKey(s.walletId, fiat);
    const days = { ...(log[k] ?? {}) };
    days[day] = { day, open, close: now.price, balOpen: view.balanceOpen, bal: view.holdings, mined: o.minedToday, pnl: r.pnl, pnlPct: r.pnlPct, value: r.valueNow, at: Date.now() };
    const kept = Object.keys(days).sort().slice(-PNL_KEEP_DAYS);
    log[k] = Object.fromEntries(kept.map(d => [d, days[d]]));
    await localStore.set(K_PNL, log);
  }
  return view;
}

// ---------------------------------------------------------------- mining pool
//
// Opt-in, per wallet (Settings → Mining pool, or the suggestion on the home screen of a wallet that
// receives mining income). Only the mining address is sent, and only to the chosen pool.

type PoolLink = { pool?: string; address?: string; dismissed?: boolean };

async function readPoolLinks(): Promise<Record<string, PoolLink>> {
  const v = await localStore.get(K_POOL);
  return v && typeof v === 'object' ? (v as Record<string, PoolLink>) : {};
}

export async function poolConfig(): Promise<PoolConfig> {
  const s = await requireSession();
  const link = (await readPoolLinks())[s.walletId] ?? {};
  const net = NETWORKS[s.network];
  // stored data is re-validated on every read
  const pool = link.pool && poolById(link.pool) && link.address && isValidAddress(link.address, net) ? link.pool : null;
  const seen = (await sessionStore.get(K_PAYOUT_ADDRS)) as { walletId?: string; addresses?: unknown } | undefined;
  const detected = seen?.walletId === s.walletId && Array.isArray(seen.addresses) ? seen.addresses.filter((a): a is string => typeof a === 'string' && isValidAddress(a, net)) : [];
  const candidates = [...new Set([...detected, addressBook(s).get(EXTERNAL, 0).address])];
  return { pool, address: pool ? link.address! : null, dismissed: !!link.dismissed, candidates, detected };
}

/** Link the current wallet to a pool (null = off). The UI asks for the pool's origin first. */
export async function setPool(link: { pool: string; address: string } | null): Promise<PoolConfig> {
  const s = await requireSession();
  if (s.network !== 'mainnet') throw new WalletError('pool.mainnet_only');
  const links = await readPoolLinks();
  if (link) {
    if (!poolById(link.pool)) throw new WalletError('pool.unknown');
    const address = link.address.trim();
    if (!isValidAddress(address, NETWORKS[s.network])) throw new WalletError('pool.bad_address');
    links[s.walletId] = { pool: link.pool, address, dismissed: true };
  } else {
    links[s.walletId] = { dismissed: true };
  }
  await localStore.set(K_POOL, links);
  return poolConfig();
}

export async function dismissPoolSuggestion() {
  const s = await requireSession();
  const links = await readPoolLinks();
  links[s.walletId] = { ...(links[s.walletId] ?? {}), dismissed: true };
  await localStore.set(K_POOL, links);
}

/** Rigs, hashrate and pending rewards at the linked pool; null when no pool is linked. */
export async function poolStats(): Promise<PoolStats | null> {
  const c = await poolConfig();
  if (!c.pool || !c.address) return null;
  return fetchPoolStats(poolById(c.pool)!, c.address);
}

/** The local daily P&L log of the current wallet, newest first. */
export async function pnlHistory(): Promise<PnlDay[]> {
  const s = await requireSession();
  const { fiat } = await getSettings();
  if (fiat === 'off') return [];
  const days = (await readPnlLog())[pnlKey(s.walletId, fiat)] ?? {};
  // stored data is re-validated on every read
  return Object.values(days)
    .filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d.day) && finite(d.pnl) && finite(d.value) && finite(d.open) && finite(d.close) && grains(d.bal) && grains(d.balOpen) && grains(d.mined))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

const clampFee = (v: number | null) => (v === null ? null : Math.min(Math.max(Math.round(v * 100) / 100, MIN_RELAY_FEE_PER_VB), MAX_SANE_FEE_PER_VB));

export async function fees(): Promise<FeeEstimates> {
  const s = await requireSession();
  const bb = await indexer(s.network);
  const est = (n: number) => bb.estimateFee(n).catch(() => null);
  const [fast, normal, slow] = await Promise.all([est(1), est(3), est(10)]);
  return { fast: clampFee(fast), normal: clampFee(normal), slow: clampFee(slow) };
}

/**
 * Your other wallets on the same network, each with its next unused receive address, so the send
 * screen can offer them as one-tap recipients. Addresses are derived locally from the stored xpub;
 * the indexer is only asked which index is next.
 */
export async function ownRecipients(): Promise<OwnRecipient[]> {
  const s = await requireSession();
  const net = NETWORKS[s.network];
  const others = (await readVault()).filter(e => e.id !== s.walletId && e.network === s.network && e.xpub);
  if (!others.length) return [];
  const bb = await indexer(s.network).catch(() => null);
  const prefix = accountPathString(net);
  const out = await Promise.all(
    others.map(async (e): Promise<OwnRecipient | null> => {
      try {
        const book = new AddressBook(e.xpub!, net);
        let next = 0;
        if (bb) {
          const x = await bb.xpub(`tr(${e.xpub})`, { page: 1, pageSize: 1 });
          for (const t of x.tokens) {
            const p = parseTokenPath(t.path, prefix);
            if (p && p.branch === EXTERNAL && p.index <= MAX_ADDRESS_INDEX && t.transfers > 0 && book.get(EXTERNAL, p.index).address === t.address) {
              next = Math.max(next, p.index + 1);
            }
          }
        }
        return { walletId: e.id, name: e.name, address: book.get(EXTERNAL, next).address };
      } catch {
        return null;
      }
    }),
  );
  return out.filter((r): r is OwnRecipient => r !== null);
}

// ---------------------------------------------------------------- send

interface Draft {
  walletId: string;
  plan: TxPlan;
  changeIndex: number;
  expiresAt: number;
}
const drafts = new Map<string, Draft>();
const DRAFT_TTL = 5 * 60_000;

export async function prepareSend(draft: SendDraft): Promise<SendPreview> {
  const s = await requireSession();
  const net = NETWORKS[s.network];
  const to = draft.to.trim().toLowerCase();
  const dest = decodeAddress(to, net);
  const amount = draft.sendMax ? 0n : parsePrl(draft.amount);
  const c = await loadChain(s, 1, 1);
  let plan: TxPlan;
  try {
    plan = planTransaction(c.utxos, { to, amount, feeRate: draft.feeRate, sendMax: draft.sendMax }, net);
  } catch (e) {
    if (e instanceof InsufficientFunds) {
      throw new WalletError(c.immature > 0n ? 'send.insufficient_immature' : 'send.insufficient', {
        needed: formatPrl(e.needed),
        available: formatPrl(e.available),
        immature: formatPrl(c.immature),
      });
    }
    throw e;
  }
  const ab = addressBook(s);
  const prefix = accountPathString(net);
  const draftId = crypto.randomUUID();
  const expiresAt = Date.now() + DRAFT_TTL;
  drafts.set(draftId, { walletId: s.walletId, plan, changeIndex: c.nextChange, expiresAt });
  const change = plan.change > 0n ? ab.get(INTERNAL, c.nextChange) : null;
  return {
    draftId,
    networkLabel: `Pearl ${net.label}`,
    hrp: net.hrp,
    to,
    addressType: dest.type,
    amount: plan.amount.toString(),
    fee: plan.fee.toString(),
    feeRate: plan.feeRate,
    vsize: plan.vsize,
    change: plan.change.toString(),
    changeAddress: change?.address ?? null,
    changePath: change ? `${prefix}/${INTERNAL}/${c.nextChange}` : null,
    total: (plan.amount + plan.fee).toString(),
    inputs: plan.inputs.map(u => ({ txid: u.txid, vout: u.vout, value: u.value.toString(), path: `${prefix}/${u.branch}/${u.index}` })),
    expiresAt,
  };
}

export function discardDraft(draftId: string) {
  drafts.delete(draftId);
}

/** Decrypt → derive → sign (offline, core/tx.ts) → wipe → broadcast. Drafts are single-use. */
export async function confirmSend(draftId: string, password: string): Promise<{ txid: string }> {
  const s = await requireSession();
  const d = drafts.get(draftId);
  if (!d || d.walletId !== s.walletId) throw new WalletError('send.draft_missing');
  if (Date.now() > d.expiresAt) {
    drafts.delete(draftId);
    throw new WalletError('send.draft_expired');
  }
  const net = NETWORKS[s.network];
  const entry = await entryById(s.walletId);
  const secret = await decryptWallet(entry, password); // throws WrongPassword; draft stays usable
  drafts.delete(draftId);

  const ab = addressBook(s);
  const seed = await seedBytes(secret.secret, secret.passphrase);
  const acct = deriveAccount(seed, net, entry.mode);
  seed.fill(0);
  let hex: string;
  let txid: string;
  try {
    if (acct.xpub !== s.xpub) throw new WalletError('send.key_mismatch');
    const signed = signPlan(
      d.plan,
      net,
      (b, i) => ({ priv: privateKeyAt(acct.accountPriv, b, i), pub: ab.get(b, i).pub, script: ab.get(b, i).script }),
      d.plan.change > 0n ? ab.get(INTERNAL, d.changeIndex).script : null,
    );
    hex = signed.hex;
    txid = signed.txid;
  } finally {
    acct.accountPriv.wipePrivateData();
  }

  const got = await (await indexer(s.network)).broadcast(hex);
  if (got !== txid) throw new WalletError('send.txid_mismatch', { txid });
  return { txid };
}

// ---------------------------------------------------------------- secrets & management

/** Explicit export flow only. The caller must not keep the result in long-lived state. */
export async function revealSecret(password: string): Promise<{ secret: string; passphrase: string }> {
  const s = await requireSession();
  return decryptWallet(await entryById(s.walletId), password);
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const s = await requireSession();
  const problem = passwordProblem(newPassword);
  if (problem) throw new WalletError(problem);
  const vault = await readVault();
  const i = vault.findIndex(e => e.id === s.walletId);
  if (i < 0) throw new WalletError('wallet.not_found');
  vault[i] = { ...(await reencryptWallet(vault[i], oldPassword, newPassword)), xpub: vault[i].xpub };
  await writeVault(vault);
}

export async function renameWallet(name: string) {
  const s = await requireSession();
  const n = name.trim().slice(0, 32);
  if (!n) throw new WalletError('wallet.name_empty');
  const vault = await readVault();
  const e = vault.find(x => x.id === s.walletId);
  if (!e) throw new WalletError('wallet.not_found');
  e.name = n; // name is not bound into the AEAD associated data, so no re-encryption needed
  await writeVault(vault);
  await sessionStore.set(K_SESSION, { ...s, name: n });
}

export async function deleteWallet(id: string, password: string) {
  const entry = await entryById(id);
  await decryptWallet(entry, password); // proves possession
  await writeVault((await readVault()).filter(e => e.id !== id));
  const log = await readPnlLog();
  await localStore.set(K_PNL, Object.fromEntries(Object.entries(log).filter(([k]) => !k.startsWith(`${id}:`))));
  const links = await readPoolLinks();
  delete links[id];
  await localStore.set(K_POOL, links);
  const s = (await sessionStore.get(K_SESSION)) as Session | undefined;
  if (s?.walletId === id) await lock();
  if ((await lastWalletId()) === id) await localStore.remove(K_LAST);
}
