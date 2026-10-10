import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/defaults';
import { evaluate } from '../src/core/engine';
import type { EvalContext, OrderIntent, ScamReport, TokenStats } from '../src/core/types';

const NOW = new Date('2026-10-10T14:00:00').getTime();

const goodToken: TokenStats = {
  address: 'Mint111', lpBurnedPct: 100, devHoldPct: 0, top10Pct: 14, snipersPct: 2, bundlersPct: 1.5, insidersPct: 1,
  liquidityUsd: 400_000, marketCapUsd: 2_000_000, solUsd: 150,
};

const cleanReport: ScamReport = {
  address: 'Mint111', status: 'no_bundle', risk: 'low', symbol: 'GOOD', bundledPct: 0, firstSecondPct: 2, devBoughtPct: 0,
  insidersHoldPct: 0, flaggedHoldPct: 1, bundleWallets: 0, devLaunches7d: 1, devBundled7d: 0, fundedTogether: 0,
  throwawayFunded: 0, wokenWallets: 0, madeWithProxima: false, madeWithSumo: false, estimate: false,
  report: 'https://isitbundled.com/token/Mint111', fetchedAt: NOW,
};

function intent(p: Partial<OrderIntent> = {}): OrderIntent {
  return {
    site: 'axiom', symbol: 'GOOD', side: 'buy', market: 'spot', unit: 'SOL', notional: 0.5, leverage: null, balance: 20,
    priceChangePct: null, priceWindowMin: null, token: goodToken, scam: cleanReport, ...p,
  };
}
const full = (h: { message: string; points?: string[] }) => [h.message, ...(h.points ?? [])].join(' ');
const ctx = (p: Partial<OrderIntent> = {}, s = {}): EvalContext => ({
  now: NOW, intent: intent(p), settings: { ...DEFAULT_SETTINGS, ...s }, trades: [], mood: null, lockout: null,
});

describe('entry gate', () => {
  it('passes a token that meets every check', () => {
    expect(evaluate(ctx()).hits).toEqual([]);
  });

  it('fails with the specific numbers and the configured severity', () => {
    const v = evaluate(ctx({ token: { ...goodToken, top10Pct: 38, lpBurnedPct: 0 } }));
    const hit = v.hits.find((h) => h.rule === 'gate')!;
    expect(hit.severity).toBe(3);
    expect(full(hit)).toContain('Top 10 wallets hold 38%');
    expect(full(hit)).toContain('LP burned is 0%');
  });

  it('sums snipers + bundlers + insiders', () => {
    const v = evaluate(ctx({ token: { ...goodToken, snipersPct: 4, bundlersPct: 4, insidersPct: 3 } }));
    expect(full(v.hits.find((h) => h.rule === 'gate')!)).toContain('11%');
  });

  it('compares SOL order size to USD liquidity using the SOL price', () => {
    // 10 SOL × $150 = $1,500 → needs $75k liquidity at 50×
    expect(evaluate(ctx({ notional: 10, balance: 500, token: { ...goodToken, liquidityUsd: 60_000 } })).hits[0]?.rule).toBe('gate');
    expect(evaluate(ctx({ notional: 10, balance: 500, token: { ...goodToken, liquidityUsd: 80_000 } })).hits).toEqual([]);
  });

  it('downgrades to a banner when stats are unreadable', () => {
    const v = evaluate(ctx({ token: { ...goodToken, lpBurnedPct: null, solUsd: null } }));
    expect(v.level).toBe(1);
    expect(v.hits[0].message).toContain('LP burned');
  });

  it('ignores sells (getting out is never gated)', () => {
    expect(evaluate(ctx({ side: 'sell', token: { ...goodToken, top10Pct: 90 } })).hits).toEqual([]);
  });

  it('can be configured to block outright', () => {
    expect(evaluate(ctx({ token: { ...goodToken, top10Pct: 90 } }, { gateSeverity: 4 })).level).toBe(4);
  });
});

describe('scam check', () => {
  it('stays quiet on a clean launch', () => {
    expect(evaluate(ctx()).hits).toEqual([]);
  });

  it('blocks extreme risk with no override and links the report', () => {
    const v = evaluate(ctx({ scam: { ...cleanReport, status: 'bundled', risk: 'extreme', bundledPct: 47, flaggedHoldPct: 41 } }));
    expect(v.level).toBe(4);
    expect(v.startLockout).toBeNull(); // a blocked buy is not a lockout
    const hit = v.hits.find((h) => h.rule === 'scam')!;
    expect(hit.title).toContain('blocked');
    expect(full(hit)).toContain('47%');
    expect(hit.link?.href).toContain('isitbundled.com');
  });

  it('extreme becomes a hard stop when blocking is turned off', () => {
    expect(evaluate(ctx({ scam: { ...cleanReport, risk: 'extreme' } }, { scamBlockExtreme: false })).level).toBe(3);
  });

  it('flags bundled supply over your max, serial bundler devs, and bundling tools', () => {
    const v = evaluate(ctx({ scam: { ...cleanReport, risk: null, bundledPct: 12, devBundled7d: 4, devLaunches7d: 5, madeWithSumo: true } }));
    const msg = full(v.hits.find((h) => h.rule === 'scam')!);
    expect(msg).toContain('12% of supply was bundled');
    expect(msg).toContain('bundled 4 of 5 launches');
    expect(msg).toContain('Sumo');
    expect(v.level).toBe(3);
  });

  it('nudges when the token has never been scanned', () => {
    const v = evaluate(ctx({ scam: { ...cleanReport, status: 'unscanned', risk: null } }));
    expect(v.level).toBe(1);
  });

  it('does not block selling a scam (you should be able to get out)', () => {
    expect(evaluate(ctx({ side: 'sell', scam: { ...cleanReport, risk: 'extreme' } })).hits).toEqual([]);
  });
});
