import { isValidAddress } from '../core/address.ts';
import { WalletError } from '../core/errors.ts';
import { GRAINS_PER_PRL, type PearlNetwork } from '../core/networks.ts';

/**
 * grains -> "1,234.5678" (trailing zeros trimmed). `maxDecimals` truncates toward zero —
 * never rounds up — so a displayed amount is never more than what is actually there.
 */
export function formatPrl(grains: bigint | string, opts: { sign?: boolean; group?: boolean; maxDecimals?: number } = {}): string {
  let g = typeof grains === 'string' ? BigInt(grains) : grains;
  const neg = g < 0n;
  if (neg) g = -g;
  const whole = (g / GRAINS_PER_PRL).toString();
  const frac = (g % GRAINS_PER_PRL).toString().padStart(8, '0').slice(0, opts.maxDecimals ?? 8).replace(/0+$/, '');
  const w = opts.group === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = frac ? `${w}.${frac}` : w;
  return neg ? `-${s}` : opts.sign && g > 0n ? `+${s}` : s;
}

/**
 * Amount in the display currency and UI locale: "$1,234.56", "¥1,234.56", "₩2,546", "2,324 sats".
 * Prices under 100 get two extra decimals (PRL trades around a dollar); amounts smaller than the
 * currency's smallest unit get two extra so they don't collapse to 0.00. 'sats' is BTC: satoshis,
 * switching to ₿ from 1 BTC up.
 */
export function formatFiat(v: number, fiat: string, locale: string, opts: { sign?: boolean; price?: boolean } = {}): string {
  const abs = Math.abs(v);
  const signDisplay = opts.sign ? 'exceptZero' : 'auto';
  if (fiat === 'sats') {
    if (abs >= 1e8) return new Intl.NumberFormat(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4, signDisplay }).format(v / 1e8).replace(/^([+-]?)/, '$1₿');
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: abs < 100 ? 2 : 0, signDisplay }).format(v)} sats`;
  }
  const currency = fiat.toUpperCase();
  const d = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const max = opts.price ? (abs >= 100 ? d : d + 2) : abs > 0 && abs < 10 ** -d ? d + 2 : d;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: max, signDisplay }).format(v);
}

/** 1.234 -> "+1.23%" */
export const formatPct = (v: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(v / 100);

/** "1.5" -> 150000000n. Strict: digits, optional dot, at most 8 decimals. */
export function parsePrl(input: string): bigint {
  const s = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{0,8})?$|^\.\d{1,8}$/.test(s)) throw new WalletError('amount.format');
  const [w, f = ''] = s.split('.');
  const v = BigInt(w || '0') * GRAINS_PER_PRL + BigInt((f + '00000000').slice(0, 8));
  if (v > 21_000_000_000n * GRAINS_PER_PRL) throw new WalletError('amount.too_large');
  return v;
}

/**
 * Truncated address for lists: hrp + "1p" + 6 chars … last 8 chars.
 * Only ever called with addresses that passed bech32m validation.
 */
export function shortAddr(addr: string, net: PearlNetwork): string {
  if (!isValidAddress(addr, net)) return '—';
  const head = net.hrp.length + 2 + 6;
  return addr.length <= head + 10 ? addr : `${addr.slice(0, head)}…${addr.slice(-8)}`;
}

export const shortTxid = (t: string) => `${t.slice(0, 10)}…${t.slice(-8)}`;

const pad2 = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Day bucket for the activity list; 'today' / 'yesterday' are translated by the caller. */
export function dayKey(unix: number, now = new Date()): 'today' | 'yesterday' | Date {
  const d = new Date(unix * 1000);
  if (sameDay(d, now)) return 'today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  return sameDay(d, y) ? 'yesterday' : d;
}

export const formatDay = (d: Date, locale: string, now = new Date()) =>
  d.toLocaleDateString(locale, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });

export const clockTime = (unix: number) => {
  const d = new Date(unix * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
