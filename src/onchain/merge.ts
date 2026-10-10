// Fold on-chain closed positions into the trade journal (pure, tested).
import type { TradeRecord } from '../core/types';
import type { ClosedPosition } from './solana-pnl';

/**
 * Each closed position becomes exactly one result:
 *  - if TradeGuard SI recorded buy click(s) for that token in the position's window, the LAST one gets the
 *    outcome and P&L and earlier ones are marked `partOf` it (so 3 buys into one position ≠ 3 losses);
 *  - otherwise a new record is created (trades made with the extension off still count toward caps).
 */
export function mergeClosed(trades: TradeRecord[], closed: ClosedPosition[]): { trades: TradeRecord[]; added: ClosedPosition[] } {
  const out = trades.map((t) => ({ ...t }));
  const seen = new Set(out.map((t) => t.chainId).filter(Boolean));
  const added: ClosedPosition[] = [];
  for (const p of closed) {
    const chainId = p.signatures[0];
    if (!chainId || seen.has(chainId)) continue;
    seen.add(chainId);
    added.push(p);
    const outcome = p.pnlSol > 0.0005 ? 'win' : p.pnlSol < -0.0005 ? 'loss' : 'breakeven';
    const result = { outcome, outcomeTs: p.closedAt, pnl: p.pnlSol, pnlUnit: 'SOL', chainId } as const;
    const clicks = out.filter((t) => t.token === p.mint && t.side !== 'sell' && !t.outcome && !t.partOf && t.ts >= p.openedAt - 2 * 60_000 && t.ts <= p.closedAt);
    if (clicks.length) {
      const last = clicks[clicks.length - 1];
      Object.assign(last, result);
      for (const c of clicks.slice(0, -1)) c.partOf = last.id;
    } else {
      out.push({
        id: `chain${chainId.slice(0, 20).replace(/[^a-z0-9]/gi, '')}`,
        ts: p.openedAt,
        site: 'onchain',
        symbol: null,
        token: p.mint,
        side: 'buy',
        unit: 'SOL',
        notional: Math.round(p.solIn * 1e4) / 1e4,
        leverage: null,
        friction: 0,
        hits: [],
        overrode: false,
        moodScore: null,
        moodTags: [],
        source: 'chain',
        ...result,
      });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return { trades: out, added };
}
