import { lossLockMinutes, PROTECTION_RULES } from './protect-rules';
import { gateRule, scamRule } from './token-rules';
import type { EvalContext, RuleHit, Settings, TradeRecord, Unit } from './types';

// Each rule looks at one order in context and returns a hit or null.
// `s` is the mood-adjusted settings, so messages quote the limits actually in force.

export type Rule = (ctx: EvalContext, s: Settings) => RuleHit | null;

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  return startOfDay(ts) + 24 * HOUR;
}

export function fmtAmount(n: number, unit: Unit): string {
  const v = Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2).replace(/\.?0+$/, '');
  return unit === 'USD' ? `$${v}` : `${v} ${unit}`;
}

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const pct = (n: number) => `${Math.round(n)}%`;

/** Losses only count toward tilt/daily-loss once — after a lockout they start fresh. */
function sinceLastLockout(ctx: EvalContext): number {
  return ctx.lockout ? ctx.lockout.startedAt : 0;
}

export const lockoutRule: Rule = (ctx) => {
  const l = ctx.lockout;
  if (!l || l.until <= ctx.now) return null;
  const mins = Math.ceil((l.until - ctx.now) / MIN);
  const reopen = `Trading reopens at ${fmtTime(l.until)}${mins > 24 * 60 ? ` on ${new Date(l.until).toLocaleDateString()}` : ''} (${mins >= 120 ? Math.round(mins / 60) + ' h' : mins + ' min'}).`;
  const byKind = {
    win: { title: 'Goal hit. CLOSE THE TAB AND ENJOY YOUR DAY.', msg: `${l.reason} You already won today. ${reopen}` },
    break: { title: 'On a break', msg: `${l.reason} ${reopen} Stand up, drink water, look at something far away.` },
    self: { title: 'Self-exclusion active', msg: `${l.reason} You chose this break and it can't be ended early. ${reopen}` },
    time: { title: 'Screen time limit reached', msg: `${l.reason} ${reopen} CLOSE THE TAB AND ENJOY YOUR DAY.` },
    loss: { title: 'You are locked out', msg: `${l.reason} You set this up to protect yourself. ${reopen} Step away from the screen.` },
  } as const;
  const k = byKind[l.kind ?? 'loss'];
  return { rule: 'lockout', severity: 4, title: k.title, message: k.msg };
};

export function balanceFor(ctx: EvalContext, s: Settings): number | null {
  if (ctx.intent.balance && ctx.intent.balance > 0) return ctx.intent.balance;
  const fallback = ctx.intent.unit === 'USD' ? s.accountSizeUsd : s.accountSizeSol;
  return fallback > 0 ? fallback : null;
}

export const oversizeRule: Rule = (ctx, s) => {
  const { notional, leverage, market, unit } = ctx.intent;
  const balance = balanceFor(ctx, s);
  if (!notional || !balance) return null;
  // For perps, size is judged on margin committed; leverage has its own rule.
  const margin = market === 'perp' && leverage && leverage > 1 ? notional / leverage : notional;
  const p = (margin / balance) * 100;
  if (p <= s.maxPositionPct) return null;
  const exposure = market === 'perp' && leverage && leverage > 1 ? ` At ${leverage}x that's ${pct((notional / balance) * 100)} of your account in exposure.` : '';
  return {
    rule: 'oversize',
    severity: p > s.maxPositionPct * 2 ? 3 : 2,
    title: 'Position too large',
    message: `This order puts ${fmtAmount(margin, unit)} on the line: ${pct(p)} of your ${fmtAmount(balance, unit)} balance. Your limit is ${s.maxPositionPct}%.${exposure} One bad candle on a size like this can undo weeks of work.`,
  };
};

export const leverageRule: Rule = (ctx, s) => {
  const lev = ctx.intent.leverage;
  if (!lev || lev <= s.maxLeverage) return null;
  const liqMove = 100 / lev;
  return {
    rule: 'leverage',
    severity: lev > s.maxLeverage * 2 ? 3 : 2,
    title: 'Leverage above your cap',
    message: `${lev}x leverage. Your cap is ${s.maxLeverage}x. At ${lev}x, a ~${liqMove.toFixed(1)}% move against you wipes the margin, and fees and wicks make it closer than that. Leverage doesn't make you more right, it makes you wrong faster.`,
  };
};

export const overtradingRule: Rule = (ctx, s) => {
  const lastHour = ctx.trades.filter((t) => t.ts > ctx.now - HOUR).length;
  const today = ctx.trades.filter((t) => t.ts >= startOfDay(ctx.now)).length;
  if (today >= s.maxTradesPerDay) {
    return {
      rule: 'overtrading',
      severity: 3,
      title: 'Daily trade limit reached',
      message: `This would be trade #${today + 1} today. Your limit is ${s.maxTradesPerDay}. The best traders take a handful of A+ setups. Past your limit, you're usually trading out of boredom or to win something back.`,
    };
  }
  if (lastHour >= s.maxTradesPerHour) {
    return {
      rule: 'overtrading',
      severity: 2,
      title: 'Overtrading',
      message: `${lastHour} trades in the last hour. Your limit is ${s.maxTradesPerHour}. Rapid-fire entries are a sign you're reacting, not planning. Name the setup out loud before you take this.`,
    };
  }
  return null;
};

export function lastLoss(trades: TradeRecord[]): TradeRecord | null {
  let best: TradeRecord | null = null;
  for (const t of trades) {
    if (t.outcome !== 'loss') continue;
    const ts = t.outcomeTs ?? t.ts;
    if (!best || ts > (best.outcomeTs ?? best.ts)) best = t;
  }
  return best;
}

export const revengeRule: Rule = (ctx, s) => {
  const loss = lastLoss(ctx.trades);
  if (!loss) return null;
  const lossTs = loss.outcomeTs ?? loss.ts;
  const minsAgo = (ctx.now - lossTs) / MIN;
  if (minsAgo > s.revengeWindowMin) return null;
  const n = ctx.intent.notional;
  const sizedUp = n && loss.notional && loss.unit === ctx.intent.unit && n >= loss.notional * s.revengeSizeMultiple;
  const lossTxt = loss.pnl != null ? ` (${fmtAmount(Math.abs(loss.pnl), 'USD')})` : '';
  const when = minsAgo < 1 ? 'just now' : `${Math.round(minsAgo)} min ago`;
  return {
    rule: 'revenge',
    severity: sizedUp ? 3 : 2,
    title: sizedUp ? 'Revenge trade: sizing up after a loss' : 'Possible revenge trade',
    message: sizedUp
      ? `You took a loss${lossTxt} ${when} and this order is ${(n! / loss.notional!).toFixed(1)}× that size. Doubling down to "get it back" is the most common way accounts blow up.`
      : `You logged a loss${lossTxt} ${when}. Is this trade from your plan, or are you trying to make that money back right now? Wait out the ${s.revengeWindowMin}-minute window.`,
  };
};

export const chasingRule: Rule = (ctx, s) => {
  const { priceChangePct: chg, priceWindowMin: win, side, market } = ctx.intent;
  if (chg == null || !side) return null;
  const longChase = side === 'buy' && chg >= s.chaseThresholdPct;
  const shortChase = side === 'sell' && market === 'perp' && chg <= -s.chaseThresholdPct;
  if (!longChase && !shortChase) return null;
  const mag = Math.abs(chg);
  const window = win ? ` in ${win} min` : '';
  return {
    rule: 'chasing',
    severity: mag >= s.chaseThresholdPct * 2 ? 3 : 2,
    title: longChase ? 'Chasing a pump' : 'Chasing a dump',
    message: longChase
      ? `Price is already up ${pct(mag)}${window}. Your chase threshold is ${s.chaseThresholdPct}%. Buying after the move means you're someone's exit liquidity. If you missed it, let it go. There's always another setup.`
      : `Price is already down ${pct(mag)}${window}. Your chase threshold is ${s.chaseThresholdPct}%. Shorting into an extended dump is where violent squeezes happen.`,
  };
};

export function dayPnl(trades: TradeRecord[], now: number, since = 0): number {
  const from = Math.max(startOfDay(now), since);
  return trades
    .filter((t) => (t.outcomeTs ?? t.ts) >= from && typeof t.pnl === 'number' && (t.pnlUnit ?? 'USD') === 'USD')
    .reduce((sum, t) => sum + (t.pnl as number), 0);
}

export const dailyLossRule: Rule = (ctx, s) => {
  if (s.dailyLossLimitUsd <= 0) return null;
  const pnl = dayPnl(ctx.trades, ctx.now, sinceLastLockout(ctx));
  if (pnl > -s.dailyLossLimitUsd) return null;
  return {
    rule: 'dailyLoss',
    severity: 4,
    title: 'Daily loss limit hit',
    message: `You're down ${fmtAmount(Math.abs(pnl), 'USD')} today. Your daily max loss is ${fmtAmount(s.dailyLossLimitUsd, 'USD')}. The day is over. Protecting what's left is the trade now.`,
    lockout: { minutes: lossLockMinutes(ctx.now, s.lossLockoutHours), kind: 'loss' },
  };
};

export function lossStreak(trades: TradeRecord[], since = 0): number {
  const graded = trades
    .filter((t) => t.outcome && (t.outcomeTs ?? t.ts) > since)
    .sort((a, b) => (b.outcomeTs ?? b.ts) - (a.outcomeTs ?? a.ts));
  let n = 0;
  for (const t of graded) {
    if (t.outcome !== 'loss') break;
    n++;
  }
  return n;
}

export const tiltRule: Rule = (ctx, s) => {
  if (s.tiltStreak <= 0) return null;
  const streak = lossStreak(ctx.trades, sinceLastLockout(ctx));
  if (streak < s.tiltStreak) return null;
  return {
    rule: 'tilt',
    severity: 4,
    title: 'Tilt detected',
    message: `${streak} losses in a row. Your tilt limit is ${s.tiltStreak}. After a streak like this, decision quality drops whether you feel it or not. Take the break. The market will be here when you get back.`,
    lockout: { minutes: s.lockoutMinutes, kind: 'loss' },
  };
};

export const ALL_RULES: Rule[] = [
  lockoutRule, dailyLossRule, tiltRule, ...PROTECTION_RULES.slice(0, 7), // lockout-class first
  scamRule, gateRule, oversizeRule, leverageRule, revengeRule, chasingRule, overtradingRule, ...PROTECTION_RULES.slice(7),
];
