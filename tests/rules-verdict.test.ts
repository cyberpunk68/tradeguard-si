import { describe, expect, it } from 'vitest';
import { rulesVerdict } from '../src/coach/rules-verdict';
import { DEFAULT_SETTINGS } from '../src/core/defaults';
import type { ScamReport } from '../src/core/types';

const NOW = 1_800_000_000_000;
const clean: ScamReport = {
  address: 'X', status: 'no_bundle', risk: 'low', symbol: 'OK', bundledPct: 0, firstSecondPct: 0, devBoughtPct: 0, insidersHoldPct: 0,
  flaggedHoldPct: 0, bundleWallets: 0, devLaunches7d: 1, devBundled7d: 0, fundedTogether: 0, throwawayFunded: 0, wokenWallets: 0,
  madeWithProxima: false, madeWithSumo: false, estimate: false, report: 'https://isitbundled.com/', fetchedAt: NOW,
};
const base = { settings: DEFAULT_SETTINGS, lockout: null, scam: clean, now: NOW };

describe('rulesVerdict', () => {
  it('returns null when the rules do not settle it (the AI is needed)', () => {
    expect(rulesVerdict(base)).toBeNull();
    expect(rulesVerdict({ ...base, preview: { level: 2, hits: [{ rule: 'oversize', title: 'Position too large' }] } })).toBeNull();
  });

  it('lockout → NO TRADE with minutes left', () => {
    const v = rulesVerdict({ ...base, lockout: { until: NOW + 30 * 60_000, startedAt: NOW, reason: 'Tilt detected.' } })!;
    expect(v.verdict).toBe('no_trade');
    expect(v.headline).toContain('30 min');
  });

  it('extreme bundled launch → AVOID with the findings', () => {
    const v = rulesVerdict({ ...base, scam: { ...clean, risk: 'extreme', bundledPct: 46.8, madeWithProxima: true } })!;
    expect(v.verdict).toBe('avoid');
    expect(v.reasons.join(' ')).toContain('46.8%');
  });

  it('failed entry gate → AVOID with the failed checks', () => {
    const v = rulesVerdict({ ...base, preview: { level: 3, hits: [{ rule: 'gate', title: 'Token fails your entry gate', points: ['Top 10 wallets hold 38%'] }] } })!;
    expect(v.verdict).toBe('avoid');
    expect(v.reasons[0]).toContain('38%');
  });

  it('respects the scam check being turned off', () => {
    expect(rulesVerdict({ ...base, settings: { ...DEFAULT_SETTINGS, scamCheckEnabled: false }, scam: { ...clean, risk: 'extreme' } })).toBeNull();
  });
});
