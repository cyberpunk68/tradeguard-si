import { describe, expect, it } from 'vitest';
import { computeStats, insights } from '../src/core/insights';
import type { TradeRecord } from '../src/core/types';

let i = 0;
const t = (p: Partial<TradeRecord>): TradeRecord => ({
  id: String(i++), ts: i, site: 's', symbol: null, side: 'buy', unit: 'USD', notional: 100, leverage: null,
  friction: 0, hits: [], overrode: false, moodScore: 4, moodTags: [], ...p,
});

describe('insights', () => {
  it('asks for more data with a tiny sample', () => {
    expect(insights([t({ outcome: 'win' })])[0].tone).toBe('info');
  });

  it('spots a losing mood tag', () => {
    const trades = [
      ...Array.from({ length: 4 }, () => t({ outcome: 'loss', moodTags: ['fomo'] })),
      ...Array.from({ length: 6 }, () => t({ outcome: 'win', moodTags: ['calm'] })),
    ];
    const text = insights(trades).map((x) => x.text).join(' ');
    expect(text).toContain('fomo');
    expect(text).toContain('100%');
  });

  it('compares overridden vs clean trades', () => {
    const trades = [
      ...Array.from({ length: 3 }, () => t({ outcome: 'loss', overrode: true, hits: ['oversize'] })),
      ...Array.from({ length: 3 }, () => t({ outcome: 'win' })),
    ];
    const s = computeStats(trades);
    expect(s.overrideWinRate).toBe(0);
    expect(s.cleanWinRate).toBe(1);
    expect(insights(trades).some((x) => x.text.includes('overrode'))).toBe(true);
  });
});
