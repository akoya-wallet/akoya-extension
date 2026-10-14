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

export interface Settings {
  indexers: Record<NetworkId, string[]>;
  autoLockMinutes: number;
  language: Language;
}

export interface IndexerStatus {
  ok: boolean;
  url: string;
  height?: number;
  chain?: string;
  inSync?: boolean;
  /** raw error, localised by the UI */
  error?: unknown;
}
