// Gambling-harm protections, adapted from the responsible-gambling toolkit (stop-win, loss limits,
// reality checks, session limits, cool-offs, self-exclusion) and from the patterns that turn a
// winning day into a losing one: the heater, doubling up, rapid-fire clicking, late nights.
import type { Rule } from './rules';
import { endOfDay, fmtAmount, startOfDay } from './rules';
import type { EvalContext, TradeRecord } from './types';

const MIN = 60_000;
const money = (n: number) => fmtAmount(Math.abs(n), 'USD');
const hrs = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`);

export function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}
const endOfWeek = (ts: number) => startOfWeek(ts) + 7 * 24 * 60 * MIN;
export function startOfMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
const endOfMonth = (ts: number) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
};
const minutesUntil = (now: number, end: number) => Math.max(1, Math.ceil((end - now) / MIN));

/** Logged P&L since `from` (by outcome time), in one unit, ignoring anything before the last lockout started. */
function pnlSince(ctx: EvalContext, from: number, unit: 'USD' | 'SOL' = 'USD'): number {
  const floor = Math.max(from, ctx.lockout?.startedAt ?? 0);
  return ctx.trades
    .filter((t) => typeof t.pnl === 'number' && (t.pnlUnit ?? 'USD') === unit && (t.outcomeTs ?? t.ts) >= floor)
    .reduce((s, t) => s + (t.pnl as number), 0);
}

const graded = (trades: TradeRecord[]) => trades.filter((t) => t.outcome).sort((a, b) => (b.outcomeTs ?? b.ts) - (a.outcomeTs ?? a.ts));

// ---------- lockout-class ----------

export const stopWinRule: Rule = (ctx, s) => {
  if (s.dailyProfitTargetUsd <= 0) return null;
  const pnl = pnlSince(ctx, startOfDay(ctx.now));
  if (pnl < s.dailyProfitTargetUsd) return null;
  return {
    rule: 'stopWin',
    severity: 4,
    title: `Goal hit: +${money(pnl)} today`,
    message: `You're up ${money(pnl)} today, past your ${money(s.dailyProfitTargetUsd)} goal. CLOSE THE TAB AND ENJOY YOUR DAY. The most common way a great day becomes a bad one is staying in the chair.`,
    lockout: { minutes: minutesUntil(ctx.now, endOfDay(ctx.now)), kind: 'win' },
  };
};

export const weeklyLossRule: Rule = (ctx, s) => {
  if (s.weeklyLossLimitUsd <= 0) return null;
  const pnl = pnlSince(ctx, startOfWeek(ctx.now));
  if (pnl > -s.weeklyLossLimitUsd) return null;
  return {
    rule: 'weeklyLoss',
    severity: 4,
    title: 'Weekly loss limit hit',
    message: `You're down ${money(pnl)} this week. Your weekly limit is ${money(s.weeklyLossLimitUsd)}. Trading reopens Monday with a clear head.`,
    lockout: { minutes: minutesUntil(ctx.now, endOfWeek(ctx.now)), kind: 'loss' },
  };
};

export const monthlyLossRule: Rule = (ctx, s) => {
  if (s.monthlyLossLimitUsd <= 0) return null;
  const pnl = pnlSince(ctx, startOfMonth(ctx.now));
  if (pnl > -s.monthlyLossLimitUsd) return null;
  return {
    rule: 'monthlyLoss',
    severity: 4,
    title: 'Monthly loss limit hit',
    message: `You're down ${money(pnl)} this month. Your monthly limit is ${money(s.monthlyLossLimitUsd)}. Protecting what's left is the job until the month resets.`,
    lockout: { minutes: minutesUntil(ctx.now, endOfMonth(ctx.now)), kind: 'loss' },
  };
};

export const stopOutsRule: Rule = (ctx, s) => {
  if (s.maxLossesPerDay <= 0) return null;
  const floor = Math.max(startOfDay(ctx.now), ctx.lockout?.startedAt ?? 0);
  const losses = ctx.trades.filter((t) => t.outcome === 'loss' && (t.outcomeTs ?? t.ts) >= floor).length;
  if (losses < s.maxLossesPerDay) return null;
  return {
    rule: 'stopOuts',
    severity: 4,
    title: `${losses} losing trades today`,
    message: `That's your limit of ${s.maxLossesPerDay} losses for the day. Close the tab${s.lossLockoutHours ? ` for ${s.lossLockoutHours} hours` : ' and come back tomorrow'}. Today's market isn't going anywhere.`,
    lockout: { minutes: lossLockMinutes(ctx.now, s.lossLockoutHours), kind: 'loss' },
  };
};

export const screenTimeRule: Rule = (ctx, s) => {
  const a = ctx.activity;
  if (s.dailyScreenLimitMinutes <= 0 || !a) return null;
  if (a.minutesToday < s.dailyScreenLimitMinutes) return null;
  return {
    rule: 'screenTime',
    severity: 4,
    title: `${hrs(a.minutesToday)} in the charts today`,
    message: `That's past your daily limit of ${hrs(s.dailyScreenLimitMinutes)}. Screen time is the strongest predictor of overtrading. CLOSE THE TAB AND ENJOY YOUR DAY.`,
    lockout: { minutes: minutesUntil(ctx.now, endOfDay(ctx.now)), kind: 'time' },
  };
};

export const sessionBreakRule: Rule = (ctx, s) => {
  const a = ctx.activity;
  if (s.sessionMaxMinutes <= 0 || !a || a.sessionMinutes < s.sessionMaxMinutes) return null;
  return {
    rule: 'sessionBreak',
    severity: 4,
    title: 'Time for a break',
    message: `You've been trading for ${hrs(a.sessionMinutes)} straight. Decision quality drops after long sessions. Take ${s.breakMinutes} minutes away from the screen.`,
    lockout: { minutes: s.breakMinutes, kind: 'break' },
  };
};

// ---------- friction-class ----------

export const quietHoursRule: Rule = (ctx, s) => {
  if (!s.quietHoursEnabled) return null;
  const h = new Date(ctx.now).getHours();
  const inside = s.quietStartHour <= s.quietEndHour ? h >= s.quietStartHour && h < s.quietEndHour : h >= s.quietStartHour || h < s.quietEndHour;
  if (!inside) return null;
  return {
    rule: 'quietHours',
    severity: 3,
    title: 'Late-night trading',
    message: `It's ${new Date(ctx.now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, inside your quiet hours (${s.quietStartHour}:00–${s.quietEndHour}:00). Tired brains take trades rested brains wouldn't. Sleep on it.`,
  };
};

export const realityCheckRule: Rule = (ctx, s) => {
  const a = ctx.activity;
  if (s.realityCheckMinutes <= 0 || !a || a.minutesToday - a.realityCheckedAt < s.realityCheckMinutes) return null;
  const pnl = pnlSince({ ...ctx, lockout: null }, startOfDay(ctx.now));
  const n = ctx.trades.filter((t) => t.ts >= startOfDay(ctx.now)).length;
  return {
    rule: 'realityCheck',
    severity: 1,
    title: 'Reality check',
    message: `You've been in the charts ${hrs(a.minutesToday)} today: ${n} trade${n === 1 ? '' : 's'}, logged P&L ${pnl < 0 ? '−' : '+'}${money(pnl)}. Is this still the plan?`,
  };
};

export const rapidFireRule: Rule = (ctx, s) => {
  if (s.rapidFireSeconds <= 0 || !ctx.trades.length) return null;
  const last = Math.max(...ctx.trades.map((t) => t.ts));
  const secs = Math.round((ctx.now - last) / 1000);
  if (secs >= s.rapidFireSeconds) return null;
  return {
    rule: 'rapidFire',
    severity: 2,
    title: 'Rapid-fire clicking',
    message: `Your last order was ${secs}s ago. Fast repeat clicks are how a plan turns into a slot machine. Wait out the ${s.rapidFireSeconds}s.`,
  };
};

export const escalationRule: Rule = (ctx, s) => {
  const n = ctx.intent.notional;
  if (s.escalationMultiple <= 1 || !n) return null;
  const recent = ctx.trades
    .filter((t) => t.notional && t.unit === ctx.intent.unit && t.ts >= ctx.now - 6 * 60 * MIN)
    .sort((a, b) => a.ts - b.ts)
    .slice(-2)
    .map((t) => t.notional as number);
  if (recent.length < 2) return null;
  const sizes = [...recent, n];
  const climbing = sizes.every((v, i) => i === 0 || v >= sizes[i - 1] * s.escalationMultiple);
  if (!climbing) return null;
  return {
    rule: 'escalation',
    severity: 3,
    title: 'Doubling up',
    message: `Your last three orders keep getting bigger: ${sizes.map((v) => fmtAmount(v, ctx.intent.unit)).join(' → ')}. Raising the stakes each round is the martingale trap: one loss at the top wipes out every win below it.`,
  };
};

export const heaterRule: Rule = (ctx, s) => {
  if (s.heaterWinStreak <= 0) return null;
  const g = graded(ctx.trades);
  let streak = 0;
  for (const t of g) {
    if (t.outcome !== 'win') break;
    streak++;
  }
  if (streak < s.heaterWinStreak) return null;
  const sized = ctx.trades.filter((t) => t.notional && t.unit === ctx.intent.unit).slice(-5);
  const avg = sized.length ? sized.reduce((a, t) => a + (t.notional as number), 0) / sized.length : 0;
  const sizingUp = !!ctx.intent.notional && avg > 0 && ctx.intent.notional >= avg * 1.5;
  const last30 = ctx.trades.filter((t) => t.ts > ctx.now - 30 * MIN).length;
  const prev30 = ctx.trades.filter((t) => t.ts <= ctx.now - 30 * MIN && t.ts > ctx.now - 60 * MIN).length;
  const speedingUp = last30 >= 4 && last30 >= 2 * Math.max(1, prev30);
  if (!sizingUp && !speedingUp) return null;
  const why = sizingUp ? `this order is ${(ctx.intent.notional! / avg).toFixed(1)}× your recent size` : `${last30} trades in the last 30 minutes`;
  return {
    rule: 'heater',
    severity: 3,
    title: "You're on a heater",
    message: `${streak} wins in a row and ${why}. That rush is the moment gamblers give it all back: winning feels like skill, so the bets get bigger and faster. Bank the streak, don't feed it.`,
  };
};

export const afterWinRule: Rule = (ctx, s) => {
  if (s.bigWinUsd <= 0 || s.cooldownAfterWinMin <= 0) return null;
  const win = graded(ctx.trades).find((t) => t.outcome === 'win' && (t.pnl ?? 0) >= s.bigWinUsd);
  if (!win) return null;
  const mins = (ctx.now - (win.outcomeTs ?? win.ts)) / MIN;
  if (mins > s.cooldownAfterWinMin) return null;
  return {
    rule: 'afterWin',
    severity: 2,
    title: 'Cool down after a big win',
    message: `You just booked ${money(win.pnl!)}. Fresh profits feel like free money, and that's exactly how they get handed back. Sit out ${Math.ceil(s.cooldownAfterWinMin - mins)} more minutes.`,
  };
};

// ---------- entry discipline (memecoin plan) ----------

export const bankrollRule: Rule = (ctx, s) => {
  const { unit, balance, side } = ctx.intent;
  if (s.bankrollMaxSol <= 0 || unit !== 'SOL' || side === 'sell' || balance == null || balance <= s.bankrollMaxSol) return null;
  const excess = Math.max(0, balance - s.bankrollTargetSol);
  return {
    rule: 'bankroll',
    severity: 4,
    title: 'Profit leaves the wallet first',
    message: `Your balance is ${fmtAmount(balance, 'SOL')}, above your ${fmtAmount(s.bankrollMaxSol, 'SOL')} bankroll cap. Send ${fmtAmount(excess, 'SOL')} to your vault wallet before the next buy, so fresh profit can't be recycled into the next gamble. TradeGuard SI never moves funds. You make the transfer.`,
    points: s.vaultAddress ? [`Vault: ${s.vaultAddress}`, `Amount: ${fmtAmount(excess, 'SOL')} (leaves ${fmtAmount(s.bankrollTargetSol, 'SOL')} to trade)`] : ['Set a vault wallet address in TradeGuard SI settings.'],
  };
};

export const bigSizeRule: Rule = (ctx, s) => {
  const { unit, notional, side } = ctx.intent;
  if (!notional || side === 'sell') return null;
  const cap = unit === 'SOL' ? s.typedConfirmAboveSol : s.typedConfirmAboveUsd;
  if (cap <= 0 || notional <= cap) return null;
  return {
    rule: 'bigSize',
    severity: 3,
    title: 'Above your quick-buy size',
    message: `${fmtAmount(notional, unit)} is above your ${fmtAmount(cap, unit)} quick-buy size. Size above that is for A-setups only. If this is one, type the phrase. If you're not sure, it isn't.`,
  };
};

export const sameTokenRebuyRule: Rule = (ctx, s) => {
  if (!s.sameTokenRebuyBlock || ctx.intent.side === 'sell') return null;
  const key = ctx.intent.tokenAddress ?? ctx.intent.symbol;
  if (!key) return null;
  const lost = ctx.trades.find(
    (t) => t.outcome === 'loss' && (t.outcomeTs ?? t.ts) >= startOfDay(ctx.now) && (t.token ?? t.symbol) === key,
  );
  if (!lost) return null;
  return {
    rule: 'sameTokenRebuy',
    severity: 3,
    title: 'No rebuys after a stop-out',
    message: `You already took a loss on ${lost.symbol ? '$' + lost.symbol : 'this token'} today${lost.pnl != null ? ` (${money(lost.pnl)})` : ''}. Every loss in your history followed a fast re-entry. The chart didn't change your mind. The loss did.`,
  };
};

export const fomoCopyRule: Rule = (ctx, s) => {
  const hits = ctx.intent.fomoHits ?? [];
  if (!s.fomoCopyWarning || ctx.intent.side === 'sell' || hits.length < 2) return null;
  return {
    rule: 'fomoCopy',
    severity: 2,
    title: 'This page is selling you FOMO',
    message: `The callouts here are written to rush you. Reading them before you buy is the first move of the gamble. Decide on the chart and your rules, not the feed.`,
    points: hits.slice(0, 3).map((h) => `“${h}”`),
  };
};

// ---------- Max's rules: SOL cap, buy count, open positions, A-setups ----------

export const dailyLossSolRule: Rule = (ctx, s) => {
  if (s.dailyLossLimitSol <= 0) return null;
  const pnl = pnlSince(ctx, startOfDay(ctx.now), 'SOL');
  if (pnl > -s.dailyLossLimitSol) return null;
  return {
    rule: 'dailyLossSol',
    severity: 4,
    title: 'Daily loss cap hit',
    message: `You're down ${fmtAmount(Math.abs(pnl), 'SOL')} realized today. Your cap is ${fmtAmount(s.dailyLossLimitSol, 'SOL')}. "One more trade to get back to even" is the sentence that loses the money. Close Axiom${s.lossLockoutHours ? ` for ${s.lossLockoutHours} hours` : ' until tomorrow'}.`,
    lockout: { minutes: lossLockMinutes(ctx.now, s.lossLockoutHours), kind: 'loss' },
  };
};

const todaysBuys = (ctx: EvalContext) => ctx.trades.filter((t) => t.side !== 'sell' && t.ts >= startOfDay(ctx.now));

export const maxBuysRule: Rule = (ctx, s) => {
  if (s.maxBuysPerDay <= 0 || ctx.intent.side === 'sell') return null;
  const n = todaysBuys(ctx).length;
  if (n < s.maxBuysPerDay) return null;
  return {
    rule: 'maxBuys',
    severity: 4,
    title: `${n} buys today: that's the max`,
    message: `Your plan allows ${s.maxBuysPerDay} buys a day. The best entries of the day are already behind you. Manage what's open, then close the tab.`,
  };
};

export const openPositionsRule: Rule = (ctx, s) => {
  if (s.maxOpenPositions <= 0 || ctx.intent.side === 'sell') return null;
  const open = ctx.trades.filter((t) => t.side !== 'sell' && !t.outcome && !t.partOf && t.ts > ctx.now - 24 * 60 * MIN);
  if (open.length < s.maxOpenPositions) return null;
  return {
    rule: 'openPositions',
    severity: 4,
    title: `${open.length} positions already open`,
    message: `Your max is ${s.maxOpenPositions}. Close one (and log how it went) before opening another. More positions means more screens to watch and more exits to miss.`,
    points: open.slice(-3).map((t) => `${t.symbol ? '$' + t.symbol : 'Open trade'} · ${t.notional ? fmtAmount(t.notional, t.unit) : ''}`.trim()),
  };
};

export const aSetupRule: Rule = (ctx, s) => {
  const { notional, unit, side } = ctx.intent;
  if (s.maxASetupsPerDay <= 0 || unit !== 'SOL' || side === 'sell' || !notional || notional < s.aSetupSizeSol) return null;
  const used = todaysBuys(ctx).filter((t) => t.unit === 'SOL' && (t.notional ?? 0) >= s.aSetupSizeSol).length;
  if (used < s.maxASetupsPerDay) return null;
  return {
    rule: 'aSetupLimit',
    severity: 4,
    title: 'A-setup already used today',
    message: `${fmtAmount(notional, 'SOL')} is A-setup size, and you've used your ${s.maxASetupsPerDay} for today. A second "A-setup" in one day is usually a B-setup with a story. Size down to standard.`,
  };
};

// ---------- re-entry: the "three ARENA buys in five minutes" pattern ----------

const sameToken = (ctx: EvalContext) => {
  const key = ctx.intent.tokenAddress ?? ctx.intent.symbol;
  return key ? ctx.trades.filter((t) => (t.token ?? t.symbol) === key) : [];
};

export const tokenEntriesRule: Rule = (ctx, s) => {
  if (s.maxEntriesPerTokenPerDay <= 0 || ctx.intent.side === 'sell') return null;
  const n = sameToken(ctx).filter((t) => t.side !== 'sell' && t.ts >= startOfDay(ctx.now)).length;
  if (n < s.maxEntriesPerTokenPerDay) return null;
  return {
    rule: 'tokenEntries',
    severity: 4,
    title: `Entry #${n + 1} on this token today`,
    message: `Your max is ${s.maxEntriesPerTokenPerDay} entries per token per day. Re-buying the same chart again and again is chasing it, not trading it. Find a new setup or close the tab.`,
  };
};

export const reentryRule: Rule = (ctx, s) => {
  if (s.tokenReentryCooldownMin <= 0 || ctx.intent.side === 'sell') return null;
  const exits = sameToken(ctx)
    .map((t) => (t.side === 'sell' ? t.ts : t.outcome ? t.outcomeTs ?? null : null))
    .filter((x): x is number => x != null);
  if (!exits.length) return null;
  const mins = (ctx.now - Math.max(...exits)) / MIN;
  if (mins >= s.tokenReentryCooldownMin) return null;
  return {
    rule: 'reentry',
    severity: 3,
    title: 'Re-entry too soon',
    message: `You exited this token ${mins < 1 ? 'just now' : Math.round(mins) + ' min ago'}. Your re-entry cooldown is ${s.tokenReentryCooldownMin} minutes. Every loss in your history followed a fast re-entry.`,
  };
};

// ---------- risk budget: a single stop-out may never exceed what's left of today's cap ----------

export const riskBudgetRule: Rule = (ctx, s) => {
  const { unit, notional, side } = ctx.intent;
  if (s.dailyLossLimitSol <= 0 || s.stopLossPct <= 0 || unit !== 'SOL' || side === 'sell' || !notional) return null;
  const today = pnlSince(ctx, startOfDay(ctx.now), 'SOL');
  const left = Math.max(0, s.dailyLossLimitSol + Math.min(0, today));
  const risk = (notional * s.stopLossPct) / 100;
  if (risk <= left + 1e-9) return null;
  const maxSize = (left * 100) / s.stopLossPct;
  return {
    rule: 'riskBudget',
    severity: 4,
    title: 'This trade can blow your daily cap',
    message: `At your −${s.stopLossPct}% stop, ${fmtAmount(notional, 'SOL')} risks ${fmtAmount(risk, 'SOL')}, but only ${fmtAmount(left, 'SOL')} of today's ${fmtAmount(s.dailyLossLimitSol, 'SOL')} cap is left. One stop-out would take you past it.`,
    points: [left > 0.001 ? `Max size right now: ${fmtAmount(Math.floor(maxSize * 100) / 100, 'SOL')}` : 'No budget left today. Close the tab.'],
  };
};

// ---------- late entry: buying after the move, from the people who bought before it ----------

export const lateEntryRule: Rule = (ctx, s) => {
  const m = ctx.intent.marketData;
  if (s.lateEntryPct <= 0 || !m || ctx.intent.side === 'sell') return null;
  const windows: [string, number | null][] = [['1h', m.h1], ['6h', m.h6], ['24h', m.h24]];
  const worst = windows.filter((w): w is [string, number] => w[1] != null).sort((a, b) => b[1] - a[1])[0];
  if (!worst || worst[1] < s.lateEntryPct) return null;
  const since = m.ageMin != null && m.ageMin < 24 * 60 ? 'since launch' : `in ${worst[0]}`;
  return {
    rule: 'lateEntry',
    severity: 3,
    title: 'Late entry',
    message: `This token is already up ${Math.round(worst[1]).toLocaleString('en-US')}% ${since}. Your limit is ${s.lateEntryPct}%. At this point you'd be buying from the early callers who are selling.`,
  };
};

export const PROTECTION_RULES: Rule[] = [
  stopWinRule, weeklyLossRule, monthlyLossRule, stopOutsRule, screenTimeRule, sessionBreakRule, dailyLossSolRule,
  maxBuysRule, openPositionsRule, aSetupRule, tokenEntriesRule, riskBudgetRule, reentryRule, lateEntryRule, quietHoursRule, bankrollRule, bigSizeRule, sameTokenRebuyRule, escalationRule, heaterRule, afterWinRule, fomoCopyRule, rapidFireRule, realityCheckRule,
];

/** Loss lockouts: N hours if configured, else until midnight. */
export const lossLockMinutes = (now: number, hours: number) => (hours > 0 ? hours * 60 : minutesUntil(now, endOfDay(now)));
