import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/defaults';
import { isLoosening, splitChanges } from '../src/core/limits';

describe('limit cooling-off', () => {
  it('tightening applies now, loosening waits', () => {
    const r = splitChanges(DEFAULT_SETTINGS, { maxLeverage: 3, maxPositionPct: 25 }, 1000);
    expect(r.now).toEqual({ maxLeverage: 3 });
    expect(r.later).toEqual({ changes: { maxPositionPct: 25 }, effectiveAt: 1000 + 24 * 3600_000 });
  });
  it('turning a limit off (0) counts as loosening; turning one on is tightening', () => {
    expect(isLoosening('maxLossesPerDay', 3, 0)).toBe(true);
    expect(isLoosening('dailyLossLimitUsd', 0, 200)).toBe(false);
    expect(isLoosening('dailyLossLimitUsd', 200, 500)).toBe(true);
  });
  it('switching protections off is loosening; on is not', () => {
    expect(isLoosening('preBuyChecklist', true, false)).toBe(true);
    expect(isLoosening('commitmentMode', false, true)).toBe(false);
  });
  it('allowing lockout overrides is loosening', () => {
    expect(isLoosening('lockoutOverride', 'none', 'typed')).toBe(true);
    expect(isLoosening('lockoutOverride', 'typed', 'none')).toBe(false);
  });
  it('shorter cool-downs and windows are loosening', () => {
    expect(isLoosening('revengeWindowMin', 15, 5)).toBe(true);
    expect(isLoosening('countdownSeconds', 10, 20)).toBe(false);
  });
  it('removing the delay itself is delayed', () => {
    expect(splitChanges(DEFAULT_SETTINGS, { limitChangeDelayHours: 0 }).later?.changes).toEqual({ limitChangeDelayHours: 0 });
  });
  it('with no delay configured everything applies now', () => {
    expect(splitChanges({ ...DEFAULT_SETTINGS, limitChangeDelayHours: 0 }, { maxPositionPct: 50 }).later).toBeNull();
  });
});
