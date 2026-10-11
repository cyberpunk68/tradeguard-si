import { describe, expect, it } from 'vitest';
import { allowance, PLANS } from '../src/core/plans';

const none = { autoCheck: 0, chat: 0, deepReview: 0 };

describe('plans', () => {
  it('BYOK is always allowed and never metered, on every plan', () => {
    for (const p of ['free', 'pro', 'ultra', 'max'] as const) {
      expect(allowance(p, { autoCheck: 99_999, chat: 99_999, deepReview: 99_999 }, 'deepReview', true)).toEqual({ ok: true, metered: false, remaining: null });
    }
  });

  it('Free has no hosted coach and points to Pro', () => {
    const a = allowance('free', none, 'chat', false);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.upgradeTo).toBe('pro');
  });

  it('meters hosted usage and stops at the monthly limit', () => {
    const lim = PLANS.pro.limits.chatMessagesPerMonth;
    expect(allowance('pro', { ...none, chat: lim - 1 }, 'chat', false)).toEqual({ ok: true, metered: true, remaining: 0 });
    const out = allowance('pro', { ...none, chat: lim }, 'chat', false);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.upgradeTo).toBe('ultra');
  });

  it('deep reviews are Ultra-only', () => {
    const a = allowance('pro', none, 'deepReview', false);
    expect(!a.ok && a.reason).toContain('Ultra');
    expect(allowance('ultra', none, 'deepReview', false).ok).toBe(true);
  });

  it('Ultra at the cap offers Max', () => {
    const a = allowance('ultra', { ...none, autoCheck: PLANS.ultra.limits.autoChecksPerMonth }, 'autoCheck', false);
    expect(!a.ok && a.upgradeTo).toBe('max');
  });

  it('Max has exactly five times Pro automatic-check and chat quotas', () => {
    expect(PLANS.max.limits.autoChecksPerMonth).toBe(5 * PLANS.pro.limits.autoChecksPerMonth);
    expect(PLANS.max.limits.chatMessagesPerMonth).toBe(5 * PLANS.pro.limits.chatMessagesPerMonth);
    expect(PLANS.ultra.priceUsd).toBe(29);
    expect(PLANS.max.priceUsd).toBe(100);
    expect(allowance('max', { ...none, chat: PLANS.max.limits.chatMessagesPerMonth }, 'chat', false)).toMatchObject({ ok: false, upgradeTo: null });
  });

  it('each tier strictly increases every limit', () => {
    const keys = ['autoChecksPerMonth', 'chatMessagesPerMonth'] as const;
    for (const k of keys) expect(PLANS.free.limits[k] < PLANS.pro.limits[k] && PLANS.pro.limits[k] < PLANS.ultra.limits[k]).toBe(true);
  });
});
