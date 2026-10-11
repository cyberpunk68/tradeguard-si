// Exit discipline: the rules that govern selling a winner by hand. No imports from the rule engine,
// so the content script and tests can load it on its own.
import type { EvalContext } from './types';

/** The only reasons that justify selling more than your cap of a winner by hand. */
export const THESIS_BREAKS = [
  { id: 'thesisBreak', label: 'Lower low on rising volume' },
  { id: 'devSell', label: 'Dev or insider sold' },
  { id: 'liquidity', label: 'Liquidity dropped' },
] as const;
export type ThesisBreak = (typeof THESIS_BREAKS)[number]['id'];

export interface SellCheck {
  /** How far the position is up, from your last buy of this token. */
  gainPct: number;
  /** Share of the position being sold, if the page showed it. */
  sellPct: number | null;
  cap: number;
}

/**
 * Rule 8: "Manual sell only on a thesis break; otherwise 40% max." Applies only to selling a WINNER
 * by hand. Cutting a loser, selling flat, or anything we can't price stays frictionless: a stop exit
 * must never be slowed down. Returns null when the sell is fine as it is.
 */
export function manualSellCheck(ctx: EvalContext): SellCheck | null {
  const s = ctx.settings;
  const i = ctx.intent;
  if (s.manualSellMaxPct <= 0 || i.side !== 'sell' || !i.tokenAddress || !i.price) return null;
  const buy = ctx.trades
    .filter((t) => t.token === i.tokenAddress && t.side !== 'sell' && t.entryPrice)
    .sort((a, b) => b.ts - a.ts)[0];
  if (!buy?.entryPrice) return null;
  const gainPct = (i.price / buy.entryPrice - 1) * 100;
  if (gainPct <= 0) return null;
  const sellPct = i.sellPct ?? null;
  if (sellPct != null && sellPct <= s.manualSellMaxPct) return null;
  return { gainPct, sellPct, cap: s.manualSellMaxPct };
}
