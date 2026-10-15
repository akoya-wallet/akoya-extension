// UI-facing types. Amounts are decimal strings of grains (1 PRL = 1e8 grains).
import type { DerivationMode } from '../core/hd.ts';
import type { NetworkId } from '../core/networks.ts';

export type { DerivationMode, NetworkId };

export interface WalletMeta {
  id: string;
  name: string;
  network: NetworkId;
  mode: DerivationMode;
  createdAt: string;
}

export interface SeedCheck {
  ok: boolean;
  kind?: 'mnemonic' | 'hex';
  wordCount?: number;
  reason?: { code: string; params?: Record<string, number> };
}

export interface SeedArgs {
  secret: string;
  passphrase: string;
  network: NetworkId;
  mode: DerivationMode;
}

export interface ImportPreview {
  firstAddress: string;
  accountPath: string;
  divergesFromBip32: boolean;
  activity: { txs: number; balance: string; usedAddresses: number } | null;
  /** raw error, localised by the UI */
  activityError?: unknown;
}

export interface SessionInfo {
  walletId: string;
  name: string;
  network: NetworkId;
  networkLabel: string;
  mode: DerivationMode;
  accountPath: string;
  hrp: string;
}

export interface TxItem {
  txid: string;
  direction: 'in' | 'out' | 'self';
  /** net effect on the wallet (negative for sends, includes fee) */
  net: string;
  fee: string;
  confirmations: number;
  time: number;
  coinbase: boolean;
  /** incoming payment funded by coinbase outputs — i.e. a mining-pool payout */
  poolPayout: boolean;
  counterparty?: string;
}

export interface AddressRow {
  address: string;
  path: string;
  transfers: number;
  balance: string;
}

export interface Overview {
  confirmed: string;
  unconfirmed: string;
  immature: string;
  spendable: string;
  receiveAddress: string;
  receivePath: string;
  txCount: number;
  history: TxItem[];
  page: number;
  totalPages: number;
  addresses: AddressRow[];
  tip: number;
  indexer: string;
  /** indexer entries that did not match local derivation and were ignored */
  rejected: number;
  /** coinbase rewards + pool payouts received today (local time), grains */
  minedToday: string;
  /** net effect of today's transactions (incl. pending), grains — for daily P&L */
  netToday: string;
  /** false when today has more transactions than were loaded */
  todayComplete: boolean;
  updatedAt: number;
}

export interface OwnRecipient {
  walletId: string;
  name: string;
  /** next unused receive address of that wallet */
  address: string;
}

export interface FeeEstimates {
  fast: number | null;
  normal: number | null;
  slow: number | null;
}

export interface SendDraft {
  to: string;
  amount: string;
  feeRate: number;
  sendMax: boolean;
}

export interface SendPreview {
  draftId: string;
  networkLabel: string;
  hrp: string;
  to: string;
  addressType: 'taproot' | 'p2mr';
  amount: string;
  fee: string;
  feeRate: number;
  vsize: number;
  change: string;
  changeAddress: string | null;
  changePath: string | null;
  total: string;
  inputs: { txid: string; vout: number; value: string; path: string }[];
  expiresAt: number;
}

export type Language = 'en' | 'zh-CN';
/** display currency for price & P&L — 'sats' is BTC, priced in satoshis */
export type Fiat = 'usd' | 'cny' | 'hkd' | 'eur' | 'jpy' | 'krw' | 'sats';

/** Today's value and profit/loss of the current wallet, in fiat. */
export interface PnlView {
  fiat: Fiat;
  price: number;
  change24h: number | null;
  /** PRL market cap ÷ BTC market cap (the "flip BTC" meter), when both are known */
  flip: number | null;
  /** price at local midnight */
  priceOpen: number;
  /** grains */
  holdings: string;
  balanceOpen: string;
  minedToday: string;
  valueNow: number;
  pnlPrice: number;
  pnlMined: number;
  pnl: number;
  pnlPct: number | null;
  /** some of today's transactions weren't loaded — figures are approximate */
  partial: boolean;
}

/** One day of the local P&L log (stored on this device only). */
export interface PnlDay {
  day: string;
  open: number;
  /** last price seen that day */
  close: number;
  balOpen: string;
  bal: string;
  mined: string;
  pnl: number;
  pnlPct: number | null;
  value: number;
  at: number;
}

export interface Explorer {
  id: string;
  name: string;
  /** https URL template containing {txid} */
  tx: string;
  /** https URL template containing {address} */
  address: string;
  builtin: boolean;
}

export interface Settings {
  /** Blockbook RPC endpoints; the first is used, the rest are fallbacks */
  indexers: Record<NetworkId, string[]>;
  /** user-added explorers (built-ins come from core/networks.ts) */
  customExplorers: Record<NetworkId, Omit<Explorer, 'builtin'>[]>;
  /** selected explorer id per network */
  explorer: Record<NetworkId, string>;
  autoLockMinutes: number;
  language: Language;
  /** fiat price & P&L — off by default because it contacts a third party (CoinGecko) */
  fiat: Fiat | 'off';
}

export interface IndexerStatus {
  ok: boolean;
  url: string;
  height?: number;
  chain?: string;
  inSync?: boolean;
  /** round-trip time of the status call */
  latencyMs?: number;
  /** raw error, localised by the UI */
  error?: unknown;
}
