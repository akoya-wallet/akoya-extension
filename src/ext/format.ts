import { isValidAddress } from '../core/address.ts';
import { GRAINS_PER_PRL, type PearlNetwork } from '../core/networks.ts';

/** grains -> "1,234.5678" (trailing zeros trimmed, up to 8 decimals) */
export function formatPrl(grains: bigint | string, opts: { sign?: boolean; group?: boolean } = {}): string {
  let g = typeof grains === 'string' ? BigInt(grains) : grains;
  const neg = g < 0n;
  if (neg) g = -g;
  const whole = (g / GRAINS_PER_PRL).toString();
  const frac = (g % GRAINS_PER_PRL).toString().padStart(8, '0').replace(/0+$/, '');
  const w = opts.group === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = frac ? `${w}.${frac}` : w;
  return neg ? `-${s}` : opts.sign && g > 0n ? `+${s}` : s;
}

/** "1.5" -> 150000000n. Strict: digits, optional dot, at most 8 decimals. */
export function parsePrl(input: string): bigint {
  const s = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{0,8})?$|^\.\d{1,8}$/.test(s)) throw new Error('金额格式不正确（最多 8 位小数）');
  const [w, f = ''] = s.split('.');
  const v = BigInt(w || '0') * GRAINS_PER_PRL + BigInt((f + '00000000').slice(0, 8));
  if (v > 21_000_000_000n * GRAINS_PER_PRL) throw new Error('金额过大');
  return v;
}

/**
 * Truncated address for lists: hrp + "1p" + 6 chars … last 8 chars.
 * Only ever called with addresses that passed bech32m validation.
 */
export function shortAddr(addr: string, net: PearlNetwork): string {
  if (!isValidAddress(addr, net)) return '无效地址';
  const head = net.hrp.length + 2 + 6;
  return addr.length <= head + 10 ? addr : `${addr.slice(0, head)}…${addr.slice(-8)}`;
}

export const shortTxid = (t: string) => `${t.slice(0, 10)}…${t.slice(-8)}`;

export function timeAgo(unix: number): string {
  if (!unix) return '待确认';
  const d = Date.now() / 1000 - unix;
  if (d < 60) return '刚刚';
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 天前`;
  return new Date(unix * 1000).toLocaleDateString('zh-CN');
}
