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
import { formatPrl, parsePrl } from './format.ts';
import { indexerFetch, localStore, sessionStore } from './platform.ts';
import type {
  AddressRow,
  FeeEstimates,
  ImportPreview,
  IndexerStatus,
  Overview,
  SeedArgs,
  SeedCheck,
  SendDraft,
  SendPreview,
  SessionInfo,
  Settings,
  TxItem,
  WalletMeta,
} from './types.ts';

const K_VAULT = 'vault.v1';
const K_SETTINGS = 'settings.v1';
const K_SESSION = 'session.v1';
const K_LAST = 'lastWallet.v1';

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
  autoLockMinutes: 15,
  language: 'en',
};

export async function getSettings(): Promise<Settings> {
  const s = (await localStore.get(K_SETTINGS)) as Partial<Settings> | undefined;
  const clean = (list: unknown, fallback: string[]) =>
    Array.isArray(list) && list.length ? list.filter((u): u is string => typeof u === 'string' && u.startsWith('https://')).slice(0, 8) : fallback;
  return {
    indexers: {
      mainnet: clean(s?.indexers?.mainnet, DEFAULT_SETTINGS.indexers.mainnet),
      testnet2: clean(s?.indexers?.testnet2, DEFAULT_SETTINGS.indexers.testnet2),
    },
    autoLockMinutes: typeof s?.autoLockMinutes === 'number' ? Math.min(Math.max(s.autoLockMinutes, 1), 240) : 15,
    language: s?.language === 'zh-CN' ? 'zh-CN' : 'en',
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  for (const id of Object.keys(next.indexers) as NetworkId[]) {
    next.indexers[id] = next.indexers[id].map(u => normalizeIndexerUrl(u));
    if (!next.indexers[id].length) throw new WalletError('indexer.need_one');
  }
  await localStore.set(K_SETTINGS, next);
  indexerCache.clear();
  return next;
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
    const st = await new Blockbook(url, indexerFetch).status();
    const expected = NETWORKS[network].backendChain;
    const ok = st.chain === expected;
    return { ok, url, height: st.bestHeight, chain: st.chain, inSync: st.inSync, error: ok ? undefined : new WalletError('indexer.chain_mismatch', { chain: st.chain, expected }) };
  } catch (e) {
    return { ok: false, url, error: e };
  }
}

export async function explorerUrl(network: NetworkId, kind: 'tx' | 'address', value: string): Promise<string> {
  const ok = kind === 'tx' ? /^[0-9a-f]{64}$/.test(value) : isValidAddress(value, NETWORKS[network]);
  if (!ok) throw new WalletError('explorer.invalid_target');
  const base = (await getSettings()).indexers[network][0];
  return `${base}/${kind}/${value}`;
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
  return start(entry, xpub);
}

// ---------------------------------------------------------------- chain data

const coinbaseCache = new Map<string, boolean>();
const MAX_COINBASE_LOOKUPS = 200;

interface ChainState {
  x: BBXpub;
  utxos: WalletUtxo[];
  immature: bigint;
  nextReceive: number;
  nextChange: number;
  rejected: number;
}

/** Fetch xpub data + UTXOs and re-check every path against local derivation. */
async function loadChain(s: Session, page = 1, pageSize = 20): Promise<ChainState> {
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
  return {
    confirmed: confirmed.toString(),
    unconfirmed: unconfirmed.toString(),
    immature: c.immature.toString(),
    spendable: (confirmed + unconfirmed).toString(),
    receiveAddress: receive.address,
    receivePath: `${prefix}/${EXTERNAL}/${c.nextReceive}`,
    txCount: c.x.txs,
    history: c.x.transactions.map(t => toTxItem(t, net)),
    page: c.x.page,
    totalPages: Math.max(c.x.totalPages, 1),
    addresses,
    tip: st.bestHeight,
    indexer: bb.base,
    rejected: c.rejected,
    updatedAt: Date.now(),
  };
}

const clampFee = (v: number | null) => (v === null ? null : Math.min(Math.max(Math.round(v * 100) / 100, MIN_RELAY_FEE_PER_VB), MAX_SANE_FEE_PER_VB));

export async function fees(): Promise<FeeEstimates> {
  const s = await requireSession();
  const bb = await indexer(s.network);
  const est = (n: number) => bb.estimateFee(n).catch(() => null);
  const [fast, normal, slow] = await Promise.all([est(1), est(3), est(10)]);
  return { fast: clampFee(fast), normal: clampFee(normal), slow: clampFee(slow) };
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
  vault[i] = await reencryptWallet(vault[i], oldPassword, newPassword);
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
  const s = (await sessionStore.get(K_SESSION)) as Session | undefined;
  if (s?.walletId === id) await lock();
  if ((await lastWalletId()) === id) await localStore.remove(K_LAST);
}
