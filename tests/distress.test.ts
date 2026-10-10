import { describe, expect, it } from 'vitest';
import { assessDistress } from '../src/core/distress';
import { DEFAULT_SETTINGS } from '../src/core/defaults';
import type { Lockout } from '../src/core/types';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const lock = (daysAgo: number, kind: Lockout['kind'] = 'loss'): Lockout => ({ startedAt: NOW - daysAgo * DAY, until: NOW - daysAgo * DAY + 3600_000, reason: 'x', kind });
const base = { now: NOW, settings: { ...DEFAULT_SETTINGS, dailyLossLimitSol: 0.5 }, trades: [], moods: [], lockoutHistory: [], events: [] };

describe('assessDistress', () => {
  it('one bad day is not a pattern', () => {
    expect(assessDistress({ ...base, lockoutHistory: [lock(0)] }).level).toBe('none');
  });
  it('repeated loss lockouts in a week → reach out', () => {
    const d = assessDistress({ ...base, lockoutHistory: [lock(0), lock(2), lock(4)], events: [{ ts: NOW - DAY, kind: 'chaseRefused' }] });
    expect(d.level).toBe('reach-out');
    expect(d.reasons.join(' ')).toContain('3 loss lockouts');
  });
  it('repeated "win it back" attempts are a strong signal on their own', () => {
    expect(assessDistress({ ...base, events: [{ ts: NOW - DAY, kind: 'chaseRefused' }, { ts: NOW - 2 * DAY, kind: 'unlockRefused' }], lockoutHistory: [lock(1)] }).level).toBe('reach-out');
  });
  it('big weekly losses relative to the cap count', () => {
    const trades = [{ id: 'a', ts: NOW - DAY, site: 's', symbol: null, side: 'buy' as const, unit: 'SOL' as const, notional: 2, leverage: null, friction: 0 as const, hits: [], overrode: false, moodScore: null, moodTags: [], outcome: 'loss' as const, outcomeTs: NOW - DAY, pnl: -1.8, pnlUnit: 'SOL' as const }];
    const d = assessDistress({ ...base, trades });
    expect(d.level).toBe('watch');
    expect(d.reasons[0]).toContain('1.80 SOL');
  });
  it('old events age out', () => {
    expect(assessDistress({ ...base, lockoutHistory: [lock(20), lock(21), lock(22)] }).level).toBe('none');
  });
});
