// What the coach "sees" while you trade: a live snapshot of the page plus a preview of what
// TradeGuard SI would do if you pressed Buy right now. Built in the content script every ~2s.
import type { SeriesSummary } from './series';
import type { FlowStats, FrictionLevel, RuleId, ScamReport, Side, TokenStats, Unit } from './types';

export interface LiveSnapshot {
  ts: number;
  site: string;
  url: string;
  title: string;
  symbol: string | null;
  tokenAddress: string | null;
  /** Price or market cap as shown in the tab title. */
  price: number | null;
  series: SeriesSummary | null;
  token: TokenStats | null;
  flow: FlowStats | null;
  scam: ScamReport | null;
  scamStatus: 'off' | 'pending' | 'ok' | 'error' | 'n/a';
  /** What's typed in the order form right now. */
  order: { side: Side; notional: number | null; unit: Unit; balance: number | null; leverage: number | null; pctOfBalance: number | null } | null;
  /** The verdict TradeGuard SI would give a buy at the current form size. */
  preview: { level: FrictionLevel; label: string; hits: { rule: RuleId; title: string; points?: string[] }[] } | null;
  locked: { reason: string; until: number } | null;
}

export const PREVIEW_LABEL: Record<FrictionLevel, string> = { 0: 'CLEAR', 1: 'NOTE', 2: 'PAUSE', 3: 'HARD STOP', 4: 'BLOCKED' };

const r2 = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100);

/** Compact, null-free JSON for prompts: rounded numbers, no empty fields. */
export function compactJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (x === null || x === undefined || (Array.isArray(x) && x.length === 0)) return undefined;
    if (typeof x === 'number') return Number.isFinite(x) ? r2(x) : undefined;
    return x;
  });
}

/** The slice of a snapshot worth sending to the model (drops UI-only fields). */
export function snapshotForPrompt(s: LiveSnapshot): string {
  const { ts, title, scamStatus, ...rest } = s;
  void title;
  return compactJson({ ...rest, ageSec: Math.round((Date.now() - ts) / 1000), scamStatus });
}
