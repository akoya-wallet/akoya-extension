// Daily P&L for a PRL holding, in a fiat currency. Pure math — prices come from src/ext/price.ts.
//
//   balance at midnight  = holdings now − today's net transfers (incl. mining income)
//   price P&L            = balance at midnight × (price now − price at midnight)
//   mining P&L           = PRL mined today × price now
//   today's P&L          = price P&L + mining P&L
// Ordinary transfers in or out are not profit or loss, so they are excluded.

import { GRAINS_PER_PRL } from './networks.ts';

export interface PnlInput {
  /** spendable + immature, grains */
  holdingsNow: bigint;
  /** net effect of today's transactions on the wallet (incl. pending), grains */
  netFlowToday: bigint;
  /** coinbase rewards + pool payouts received today, grains */
  minedToday: bigint;
  priceNow: number;
  priceOpen: number;
}

export interface PnlResult {
  balanceOpen: bigint;
  valueNow: number;
  valueOpen: number;
  pnlPrice: number;
  pnlMined: number;
  pnl: number;
  /** relative to the value held at midnight; null when nothing was held */
  pnlPct: number | null;
}

/** grains → PRL as a float. Fine for fiat display (relative error ~1e-16). */
export const prl = (grains: bigint) => Number(grains) / Number(GRAINS_PER_PRL);

export function dailyPnl(i: PnlInput): PnlResult {
  let balanceOpen = i.holdingsNow - i.netFlowToday;
  // history can be incomplete (paged); never let that produce a negative opening balance
  if (balanceOpen < 0n) balanceOpen = 0n;
  const valueNow = prl(i.holdingsNow) * i.priceNow;
  const valueOpen = prl(balanceOpen) * i.priceOpen;
  const pnlPrice = prl(balanceOpen) * (i.priceNow - i.priceOpen);
  const pnlMined = prl(i.minedToday > 0n ? i.minedToday : 0n) * i.priceNow;
  const pnl = pnlPrice + pnlMined;
  return { balanceOpen, valueNow, valueOpen, pnlPrice, pnlMined, pnl, pnlPct: valueOpen > 0 ? (pnl / valueOpen) * 100 : null };
}

/** Local calendar day, YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
