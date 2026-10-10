import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/defaults';
import { evaluate } from '../src/core/engine';
import type { Activity, EvalContext, OrderIntent, Settings, TradeRecord } from '../src/core/types';

const NOW = new Date('2026-10-14T14:00:00').getTime(); // a Wednesday afternoon
const MIN = 60_000;
let seq = 0;
const trade = (p: Partial<TradeRecord> = {}): TradeRecord => ({
  id: `t${seq++}`, ts: NOW - 90 * MIN, site: 's', symbol: 'X', side: 'buy', unit: 'USD', notional: 100, leverage: null,
  friction: 0, hits: [], overrode: false, moodScore: 4, moodTags: [], ...p,
});
const intent = (p: Partial<OrderIntent> = {}): OrderIntent => ({
  site: 's', symbol: 'X', side: 'buy', market: 'spot', unit: 'USD', notional: 100, leverage: null, balance: 100_000, priceChangePct: null, priceWindowMin: null, ...p,
});
// Isolate each protection: turn off the defaults that would otherwise also fire.
const quiet: Partial<Settings> = { sameTokenRebuyBlock: false, fomoCopyWarning: false, maxLossesPerDay: 0, tiltStreak: 0, rapidFireSeconds: 0, realityCheckMinutes: 0, sessionMaxMinutes: 0, heaterWinStreak: 0, escalationMultiple: 0, requireMoodCheckIn: false };
const ctx = (p: Partial<EvalContext> = {}, s: Partial<Settings> = {}): EvalContext => ({
  now: NOW, intent: intent(), settings: { ...DEFAULT_SETTINGS, ...quiet, ...s }, trades: [], mood: null, lockout: null, ...p,
});
const act = (p: Partial<Activity> = {}): Activity => ({ date: '2026-10-14', minutesToday: 0, sessionMinutes: 0, lastActiveTs: NOW, realityCheckedAt: 0, ...p });
const rules = (v: ReturnType<typeof evaluate>) => v.hits.map((h) => h.rule);

describe('stop-win', () => {
  it('locks until midnight with the close-the-tab message once the daily goal is booked', () => {
    const v = evaluate(ctx({ trades: [trade({ outcome: 'win', pnl: 260, outcomeTs: NOW - 10 * MIN })] }, { dailyProfitTargetUsd: 250 }));
    expect(v.level).toBe(4);
    expect(v.hits[0].message).toContain('CLOSE THE TAB AND ENJOY YOUR DAY');
    expect(v.startLockout).toMatchObject({ kind: 'win', minutes: 10 * 60 });
  });
  it('is off at 0 and below the target', () => {
    expect(rules(evaluate(ctx({ trades: [trade({ outcome: 'win', pnl: 900, outcomeTs: NOW - MIN })] })))).not.toContain('stopWin');
    expect(rules(evaluate(ctx({ trades: [trade({ outcome: 'win', pnl: 100, outcomeTs: NOW - MIN })] }, { dailyProfitTargetUsd: 250 })))).not.toContain('stopWin');
  });
});

describe('loss limits', () => {
  it('weekly limit locks until the next Monday', () => {
    const mon = new Date('2026-10-12T10:00:00').getTime();
    const v = evaluate(ctx({ trades: [trade({ outcome: 'loss', pnl: -300, outcomeTs: mon }), trade({ outcome: 'loss', pnl: -250, outcomeTs: NOW - 60 * MIN })] }, { weeklyLossLimitUsd: 500 }));
    expect(rules(v)).toContain('weeklyLoss');
    expect(v.startLockout!.minutes).toBe((new Date('2026-10-19T00:00:00').getTime() - NOW) / MIN);
  });
  it('max losing trades per day (not just in a row)', () => {
    const t = [trade({ outcome: 'loss', outcomeTs: NOW - 200 * MIN }), trade({ outcome: 'win', outcomeTs: NOW - 150 * MIN }), trade({ outcome: 'loss', outcomeTs: NOW - 100 * MIN }), trade({ outcome: 'loss', outcomeTs: NOW - 50 * MIN })];
    expect(rules(evaluate(ctx({ trades: t }, { maxLossesPerDay: 3 })))).toContain('stopOuts');
  });
});

describe('time protections', () => {
  it('screen-time cap locks for the day', () => {
    const v = evaluate(ctx({ activity: act({ minutesToday: 241 }) }, { dailyScreenLimitMinutes: 240 }));
    expect(v.startLockout?.kind).toBe('time');
  });
  it('long continuous session forces a break', () => {
    const v = evaluate(ctx({ activity: act({ minutesToday: 130, sessionMinutes: 125 }) }, { sessionMaxMinutes: 120, breakMinutes: 15 }));
    expect(v.startLockout).toMatchObject({ kind: 'break', minutes: 15 });
  });
  it('reality check is a soft banner with time and P&L', () => {
    const v = evaluate(ctx({ activity: act({ minutesToday: 65, realityCheckedAt: 30 }) }, { realityCheckMinutes: 30 }));
    const h = v.hits.find((x) => x.rule === 'realityCheck')!;
    expect(h.severity).toBe(1);
    expect(h.message).toContain('1h 5m');
  });
  it('quiet hours, including windows that cross midnight', () => {
    const late = new Date('2026-10-14T02:30:00').getTime();
    expect(rules(evaluate(ctx({ now: late }, { quietHoursEnabled: true, quietStartHour: 23, quietEndHour: 6 })))).toContain('quietHours');
    expect(rules(evaluate(ctx({}, { quietHoursEnabled: true, quietStartHour: 23, quietEndHour: 6 })))).not.toContain('quietHours');
  });
});

describe('chase patterns', () => {
  it('rapid-fire: an order within seconds of the last', () => {
    expect(rules(evaluate(ctx({ trades: [trade({ ts: NOW - 20_000 })] }, { rapidFireSeconds: 60 })))).toContain('rapidFire');
  });
  it('doubling up: each order bigger than the last', () => {
    const t = [trade({ ts: NOW - 40 * MIN, notional: 100 }), trade({ ts: NOW - 20 * MIN, notional: 200 })];
    const v = evaluate(ctx({ trades: t, intent: intent({ notional: 400 }) }, { escalationMultiple: 1.3 }));
    expect(v.hits.find((h) => h.rule === 'escalation')?.severity).toBe(3);
    expect(rules(evaluate(ctx({ trades: t, intent: intent({ notional: 150 }) }, { escalationMultiple: 1.3 })))).not.toContain('escalation');
  });
  it('heater: a win streak plus sizing up', () => {
    const wins = [1, 2, 3].map((i) => trade({ ts: NOW - i * 40 * MIN, outcome: 'win', outcomeTs: NOW - i * 35 * MIN, notional: 100 }));
    const v = evaluate(ctx({ trades: wins, intent: intent({ notional: 250 }) }, { heaterWinStreak: 3 }));
    expect(v.hits.find((h) => h.rule === 'heater')?.message).toContain('2.5×');
  });
  it('heater: a win streak plus speeding up', () => {
    const wins = [1, 2, 3, 4].map((i) => trade({ ts: NOW - i * 6 * MIN, outcome: 'win', outcomeTs: NOW - i * 5 * MIN }));
    expect(rules(evaluate(ctx({ trades: wins }, { heaterWinStreak: 3 })))).toContain('heater');
  });
  it('no heater on a streak at normal size and pace', () => {
    const wins = [1, 2, 3].map((i) => trade({ ts: NOW - i * 60 * MIN, outcome: 'win', outcomeTs: NOW - i * 55 * MIN }));
    expect(rules(evaluate(ctx({ trades: wins }, { heaterWinStreak: 3 })))).not.toContain('heater');
  });
  it('cool-down after a big win', () => {
    const t = [trade({ outcome: 'win', pnl: 800, outcomeTs: NOW - 10 * MIN })];
    expect(rules(evaluate(ctx({ trades: t }, { bigWinUsd: 500, cooldownAfterWinMin: 60 })))).toContain('afterWin');
  });
});

describe('active lockouts by kind', () => {
  it('a stop-win lockout keeps the close-the-tab message', () => {
    const v = evaluate(ctx({ lockout: { until: NOW + 60 * MIN, startedAt: NOW - MIN, reason: 'Goal hit.', kind: 'win' } }));
    expect(v.hits[0].title).toContain('ENJOY YOUR DAY');
  });
  it('self-exclusion says it cannot be ended early', () => {
    const v = evaluate(ctx({ lockout: { until: NOW + 7 * 24 * 60 * MIN, startedAt: NOW, reason: 'You excluded yourself for 7 days.', kind: 'self' } }));
    expect(v.hits[0].message).toContain("can't be ended early");
  });
});

describe('entry discipline (memecoin plan)', () => {
  const sol = (p: Partial<OrderIntent> = {}) => intent({ unit: 'SOL', notional: 1, balance: 2, ...p });

  it('bankroll cap blocks buys until the excess is swept, with the amount and vault', () => {
    const v = evaluate(ctx({ intent: sol({ balance: 3.4 }) }, { bankrollMaxSol: 2.5, bankrollTargetSol: 2, vaultAddress: 'Vau1tAddress111111111111111111111111111' }));
    const h = v.hits.find((x) => x.rule === 'bankroll')!;
    expect(v.level).toBe(4);
    expect(v.startLockout).toBeNull(); // blocked, not locked out
    expect(h.message).toContain('1.4 SOL');
    expect(h.points?.join(' ')).toContain('Vau1t');
  });
  it('bankroll cap never blocks selling', () => {
    expect(rules(evaluate(ctx({ intent: sol({ balance: 9, side: 'sell' }) }, { bankrollMaxSol: 2.5 })))).not.toContain('bankroll');
  });
  it('buys above the quick-buy size need the typed phrase', () => {
    expect(evaluate(ctx({ intent: sol({ notional: 2 }) }, { typedConfirmAboveSol: 1 })).level).toBe(3);
    expect(rules(evaluate(ctx({ intent: sol({ notional: 1 }) }, { typedConfirmAboveSol: 1 })))).not.toContain('bigSize');
  });
  it('no same-token rebuy after a loss today (by token address)', () => {
    const t = [trade({ token: 'Tok111', symbol: 'SI', outcome: 'loss', pnl: -675, outcomeTs: NOW - 120 * MIN })];
    const v = evaluate(ctx({ trades: t, intent: sol({ tokenAddress: 'Tok111' }) }, { sameTokenRebuyBlock: true }));
    expect(v.hits.find((h) => h.rule === 'sameTokenRebuy')?.message).toContain('$SI');
    expect(rules(evaluate(ctx({ trades: t, intent: sol({ tokenAddress: 'Other1' }) }, { sameTokenRebuyBlock: true })))).not.toContain('sameTokenRebuy');
  });
  it('flags FOMO copy on the page and quotes it', () => {
    const v = evaluate(ctx({ intent: sol({ fomoHits: ["it'll be too late later", 'this one sends', 'dont sleep'] }) }, { fomoCopyWarning: true }));
    expect(v.hits.find((h) => h.rule === 'fomoCopy')?.points?.[0]).toContain('too late');
  });
  it('24-hour loss lockouts when configured', () => {
    const t = [1, 2].map((i) => trade({ outcome: 'loss', outcomeTs: NOW - i * 20 * MIN }));
    expect(evaluate(ctx({ trades: t }, { maxLossesPerDay: 2, lossLockoutHours: 24 })).startLockout).toMatchObject({ minutes: 24 * 60, kind: 'loss' });
  });
});

describe("Max's rules", () => {
  const sol = (p: Partial<OrderIntent> = {}) => intent({ unit: 'SOL', notional: 1, balance: 2, ...p });
  it('-0.5 SOL realized locks out for 24h (USD results are counted separately)', () => {
    const t = [trade({ outcome: 'loss', pnl: -0.3, pnlUnit: 'SOL', outcomeTs: NOW - 60 * MIN }), trade({ outcome: 'loss', pnl: -0.25, pnlUnit: 'SOL', outcomeTs: NOW - 20 * MIN })];
    expect(evaluate(ctx({ trades: t, intent: sol() }, { dailyLossLimitSol: 0.5, lossLockoutHours: 24 })).startLockout).toMatchObject({ minutes: 1440, kind: 'loss' });
    const usd = [trade({ outcome: 'loss', pnl: -0.6, outcomeTs: NOW - MIN })];
    expect(rules(evaluate(ctx({ trades: usd, intent: sol() }, { dailyLossLimitSol: 0.5 })))).not.toContain('dailyLossSol');
  });
  it('max 3 buys a day; sells never count or get blocked', () => {
    const t = [1, 2, 3].map((i) => trade({ ts: NOW - i * 60 * MIN, outcome: 'win', outcomeTs: NOW - i * 55 * MIN }));
    expect(evaluate(ctx({ trades: t, intent: sol() }, { maxBuysPerDay: 3 })).level).toBe(4);
    expect(rules(evaluate(ctx({ trades: [...t.slice(0, 2), trade({ ts: NOW - 30 * MIN, side: 'sell' })], intent: sol() }, { maxBuysPerDay: 3 })))).not.toContain('maxBuys');
    expect(rules(evaluate(ctx({ trades: t, intent: sol({ side: 'sell' }) }, { maxBuysPerDay: 3 })))).not.toContain('maxBuys');
  });
  it('max 2 open positions (buys without an outcome yet)', () => {
    const open = [trade({ ts: NOW - 30 * MIN }), trade({ ts: NOW - 20 * MIN })];
    expect(evaluate(ctx({ trades: open, intent: sol() }, { maxOpenPositions: 2 })).hits.find((h) => h.rule === 'openPositions')?.severity).toBe(4);
  });
  it('one A-setup (2 SOL) per day', () => {
    const t = [trade({ unit: 'SOL', notional: 2, ts: NOW - 120 * MIN, outcome: 'win', outcomeTs: NOW - 100 * MIN })];
    expect(rules(evaluate(ctx({ trades: t, intent: sol({ notional: 2 }) }, { maxASetupsPerDay: 1, aSetupSizeSol: 2 })))).toContain('aSetupLimit');
    expect(rules(evaluate(ctx({ trades: t, intent: sol({ notional: 1 }) }, { maxASetupsPerDay: 1, aSetupSizeSol: 2 })))).not.toContain('aSetupLimit');
  });
});

describe('risk budget and late entry (the 02:40 session)', () => {
  const sol = (p: Partial<OrderIntent> = {}) => intent({ unit: 'SOL', notional: 2, balance: 2, ...p });
  it('blocks a 2 SOL buy at a -30% stop against a 0.5 SOL cap, and names the max size', () => {
    const v = evaluate(ctx({ intent: sol() }, { dailyLossLimitSol: 0.5, stopLossPct: 30 }));
    const h = v.hits.find((x) => x.rule === 'riskBudget')!;
    expect(v.level).toBe(4);
    expect(h.message).toContain('0.6 SOL');
    expect(h.points?.[0]).toContain('1.66 SOL');
  });
  it('the budget shrinks with today\'s realized losses', () => {
    const t = [trade({ outcome: 'loss', pnl: -0.4, pnlUnit: 'SOL', outcomeTs: NOW - 10 * MIN })];
    const h = evaluate(ctx({ trades: t, intent: sol({ notional: 0.5 }) }, { dailyLossLimitSol: 0.5, stopLossPct: 30 })).hits.find((x) => x.rule === 'riskBudget')!;
    expect(h.points?.[0]).toContain('0.33 SOL');
    expect(rules(evaluate(ctx({ trades: t, intent: sol({ notional: 0.3 }) }, { dailyLossLimitSol: 0.5, stopLossPct: 30 })))).not.toContain('riskBudget');
  });
  it('late entry: blocks buying after a +1,800% run since launch', () => {
    const v = evaluate(ctx({ intent: sol({ notional: 0.1, marketData: { h1: 120, h6: 1800, h24: 1800, ageMin: 300 } }) }, { lateEntryPct: 500 }));
    expect(v.hits.find((h) => h.rule === 'lateEntry')?.message).toContain('1,800% since launch');
    expect(rules(evaluate(ctx({ intent: sol({ notional: 0.1, marketData: { h1: 20, h6: 80, h24: 150, ageMin: 3000 } }) }, { lateEntryPct: 500 })))).not.toContain('lateEntry');
  });
});
