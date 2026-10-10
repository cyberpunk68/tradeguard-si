import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/defaults';
import { evaluate } from '../src/core/engine';
import { applyMood, moodAdjustment } from '../src/core/mood';
import { lossStreak } from '../src/core/rules';
import type { EvalContext, MoodEntry, OrderIntent, TradeRecord } from '../src/core/types';

const NOW = new Date('2026-10-10T14:00:00').getTime();
const MIN = 60_000;

function intent(p: Partial<OrderIntent> = {}): OrderIntent {
  return {
    site: 'test', symbol: 'BTC', side: 'buy', market: 'spot', unit: 'USD',
    notional: 500, leverage: null, balance: 10_000, priceChangePct: null, priceWindowMin: null, ...p,
  };
}

let seq = 0;
function trade(p: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: String(seq++), ts: NOW - 60 * MIN, site: 'test', symbol: 'BTC', side: 'buy', unit: 'USD',
    notional: 500, leverage: null, friction: 0, hits: [], overrode: false, moodScore: null, moodTags: [], ...p,
  };
}

function ctx(p: Partial<EvalContext> = {}): EvalContext {
  // Core-rule tests: same-token rebuy is tested separately (these fixtures reuse one symbol).
  return { now: NOW, intent: intent(), settings: { ...DEFAULT_SETTINGS, sameTokenRebuyBlock: false }, trades: [], mood: null, lockout: null, ...p };
}

const mood = (score: number, tags: MoodEntry['tags'] = []): MoodEntry => ({ ts: NOW - 5 * MIN, score, tags });

describe('clean trade', () => {
  it('allows a small, unlevered, calm trade', () => {
    const v = evaluate(ctx({ mood: mood(4, ['calm']) }));
    expect(v.level).toBe(0);
    expect(v.hits).toEqual([]);
  });

  it('does nothing when disabled', () => {
    const v = evaluate(ctx({ settings: { ...DEFAULT_SETTINGS, enabled: false }, intent: intent({ notional: 9000 }) }));
    expect(v.level).toBe(0);
  });
});

describe('oversize', () => {
  it('warns above the limit, escalates above 2x the limit', () => {
    expect(evaluate(ctx({ intent: intent({ notional: 1500 }) })).level).toBe(2);
    expect(evaluate(ctx({ intent: intent({ notional: 3800 }) })).level).toBe(3);
  });

  it('quotes the actual numbers', () => {
    const v = evaluate(ctx({ intent: intent({ notional: 3800 }) }));
    expect(v.hits[0].message).toContain('38%');
    expect(v.hits[0].message).toContain('limit is 10%');
  });

  it('falls back to configured account size, and skips if neither is known', () => {
    const s = { ...DEFAULT_SETTINGS, accountSizeUsd: 2000 };
    expect(evaluate(ctx({ settings: s, intent: intent({ balance: null, notional: 500 }) })).hits.map((h) => h.rule)).toContain('oversize');
    expect(evaluate(ctx({ intent: intent({ balance: null, notional: 500 }) })).hits).toEqual([]);
  });

  it('judges perps on margin, not notional', () => {
    // $2,500 notional at 5x = $500 margin = 5% of $10k → fine
    const v = evaluate(ctx({ intent: intent({ market: 'perp', notional: 2500, leverage: 5 }) }));
    expect(v.hits.map((h) => h.rule)).not.toContain('oversize');
  });
});

describe('leverage', () => {
  it('flags leverage over the cap', () => {
    const v = evaluate(ctx({ intent: intent({ market: 'perp', leverage: 20, notional: 2000 }) }));
    const hit = v.hits.find((h) => h.rule === 'leverage')!;
    expect(hit.severity).toBe(3);
    expect(hit.message).toContain('5.0%');
  });
});

describe('overtrading', () => {
  it('warns on hourly limit, escalates on daily limit', () => {
    const hourly = Array.from({ length: 4 }, (_, i) => trade({ ts: NOW - (i + 1) * 5 * MIN }));
    expect(evaluate(ctx({ trades: hourly })).level).toBe(2);
    const daily = Array.from({ length: 12 }, (_, i) => trade({ ts: NOW - (i + 1) * 15 * MIN }));
    expect(evaluate(ctx({ trades: daily })).level).toBe(3);
  });
});

describe('revenge', () => {
  it('flags a trade shortly after a loss', () => {
    const v = evaluate(ctx({ trades: [trade({ outcome: 'loss', outcomeTs: NOW - 5 * MIN })] }));
    expect(v.hits[0].rule).toBe('revenge');
    expect(v.level).toBe(2);
  });

  it('escalates when sizing up after the loss', () => {
    const v = evaluate(ctx({ intent: intent({ notional: 900 }), trades: [trade({ outcome: 'loss', outcomeTs: NOW - 5 * MIN, notional: 500 })] }));
    expect(v.level).toBe(3);
  });

  it('ignores old losses', () => {
    const v = evaluate(ctx({ trades: [trade({ outcome: 'loss', outcomeTs: NOW - 90 * MIN })] }));
    expect(v.hits).toEqual([]);
  });
});

describe('chasing', () => {
  it('flags buying after a pump', () => {
    expect(evaluate(ctx({ intent: intent({ priceChangePct: 30, priceWindowMin: 10 }) })).level).toBe(2);
    expect(evaluate(ctx({ intent: intent({ priceChangePct: 80 }) })).level).toBe(3);
  });
  it('does not flag spot sells into a pump (taking profit is fine)', () => {
    expect(evaluate(ctx({ intent: intent({ side: 'sell', priceChangePct: 80 }) })).hits).toEqual([]);
  });
  it('flags perp shorts into a dump', () => {
    expect(evaluate(ctx({ intent: intent({ side: 'sell', market: 'perp', priceChangePct: -40 }) })).hits[0].rule).toBe('chasing');
  });
});

describe('lockouts', () => {
  it('blocks with level 4 during an active lockout', () => {
    const v = evaluate(ctx({ lockout: { until: NOW + 30 * MIN, startedAt: NOW - 30 * MIN, reason: 'Tilt.' } }));
    expect(v.level).toBe(4);
    expect(v.startLockout).toBeNull();
  });

  it('starts a lockout after a tilt streak', () => {
    const losses = [1, 2, 3].map((i) => trade({ ts: NOW - i * 30 * MIN, outcome: 'loss', outcomeTs: NOW - i * 25 * MIN }));
    const v = evaluate(ctx({ trades: losses, settings: { ...DEFAULT_SETTINGS, maxLossesPerDay: 0 } }));
    expect(v.level).toBe(4);
    expect(v.startLockout?.minutes).toBe(DEFAULT_SETTINGS.lockoutMinutes);
  });

  it('does not re-trigger tilt from losses before the last lockout', () => {
    const losses = [1, 2, 3].map((i) => trade({ ts: NOW - i * 100 * MIN, outcome: 'loss', outcomeTs: NOW - i * 90 * MIN }));
    const expired = { until: NOW - 5 * MIN, startedAt: NOW - 65 * MIN, reason: 'Tilt.' };
    expect(evaluate(ctx({ trades: losses, lockout: expired })).level).toBe(0);
  });

  it('a win breaks the streak', () => {
    const t = [trade({ outcome: 'loss', outcomeTs: NOW - 1 }), trade({ outcome: 'win', outcomeTs: NOW - 2 }), trade({ outcome: 'loss', outcomeTs: NOW - 3 })];
    expect(lossStreak(t)).toBe(1);
  });

  it('daily loss limit locks out until midnight', () => {
    const s = { ...DEFAULT_SETTINGS, dailyLossLimitUsd: 200, tiltStreak: 0 };
    const t = [trade({ outcome: 'loss', pnl: -150, outcomeTs: NOW - 120 * MIN }), trade({ outcome: 'loss', pnl: -80, outcomeTs: NOW - 100 * MIN })];
    const v = evaluate(ctx({ settings: s, trades: t }));
    expect(v.level).toBe(4);
    expect(v.startLockout?.minutes).toBe(10 * 60); // 14:00 → midnight
  });
});

describe('escalation & mood', () => {
  it('stacks three serious warnings up one level', () => {
    const v = evaluate(ctx({ intent: intent({ market: 'perp', notional: 10_000, leverage: 8, priceChangePct: 30 }) }));
    // oversize 12.5% margin (2) + leverage 8x (2) + chasing 30% (2) → 3
    expect(v.hits.filter((h) => h.severity >= 2)).toHaveLength(3);
    expect(v.level).toBe(3);
  });

  it('never escalates a non-lockout verdict to 4', () => {
    const v = evaluate(ctx({ mood: mood(1, ['angry']), intent: intent({ market: 'perp', notional: 50_000, leverage: 25, priceChangePct: 90 }) }));
    expect(v.level).toBe(3);
  });

  it('hot moods halve the limits and add friction', () => {
    const adj = moodAdjustment(mood(4, ['fomo']));
    expect(adj.limitFactor).toBe(0.5);
    expect(applyMood(DEFAULT_SETTINGS, adj).maxPositionPct).toBe(5);
    // 7% is fine normally, over the limit when FOMO → 2 + 1 bump = 3
    expect(evaluate(ctx({ intent: intent({ notional: 700 }) })).level).toBe(0);
    expect(evaluate(ctx({ intent: intent({ notional: 700 }), mood: mood(4, ['fomo']) })).level).toBe(3);
  });

  it('a bad mood alone yields a soft nudge', () => {
    const v = evaluate(ctx({ mood: mood(2) }));
    expect(v.level).toBe(1);
    expect(v.hits[0].rule).toBe('mood');
  });

  it('stale check-ins are not passed in (engine trusts caller), drained moods tighten 25%', () => {
    expect(moodAdjustment(mood(4, ['tired'])).limitFactor).toBe(0.75);
    expect(moodAdjustment(null).limitFactor).toBe(1);
  });
});
