// Patterns that suggest gambling harm rather than one bad day. Used to route people to real help.
// Not a diagnosis: it decides when to put helplines in front of someone, nothing more.
import type { Lockout, MoodEntry, Settings, TradeRecord } from './types';

export interface DistressEvent {
  ts: number;
  kind: 'chaseRefused' | 'unlockRefused' | 'override' | 'selfExclusion';
}

export interface DistressInput {
  now: number;
  settings: Settings;
  trades: TradeRecord[];
  moods: MoodEntry[];
  lockoutHistory: Lockout[];
  events: DistressEvent[];
}

export interface Distress {
  level: 'none' | 'watch' | 'reach-out';
  reasons: string[];
}

const DAY = 86_400_000;

export function assessDistress(i: DistressInput): Distress {
  const week = i.now - 7 * DAY;
  const reasons: string[] = [];
  let score = 0;

  const lossLocks = i.lockoutHistory.filter((l) => l.startedAt >= week && (l.kind ?? 'loss') === 'loss').length;
  if (lossLocks >= 3) (score += 2), reasons.push(`${lossLocks} loss lockouts in the past week`);
  else if (lossLocks === 2) (score += 1), reasons.push('2 loss lockouts in the past week');

  const selfEx = i.lockoutHistory.some((l) => l.startedAt >= i.now - 30 * DAY && l.kind === 'self') || i.events.some((e) => e.kind === 'selfExclusion' && e.ts >= i.now - 30 * DAY);
  if (selfEx) (score += 1), reasons.push('you chose a self-exclusion recently');

  const chase = i.events.filter((e) => (e.kind === 'chaseRefused' || e.kind === 'unlockRefused') && e.ts >= week).length;
  if (chase >= 2) (score += 3), reasons.push(`${chase} times this week you tried to override or loosen a limit to win money back`);
  else if (chase === 1) (score += 1), reasons.push('you tried to override a lockout to win money back');

  const overrides = i.trades.filter((t) => t.overrode && t.hits.includes('lockout') && t.ts >= week).length + i.events.filter((e) => e.kind === 'override' && e.ts >= week).length;
  if (overrides >= 3) (score += 2), reasons.push(`${overrides} trades placed through a lockout this week`);

  const low = i.moods.filter((m) => m.ts >= week && (m.score <= 2 || m.tags.includes('angry') || m.tags.includes('anxious'))).length;
  if (low >= 3) (score += 1), reasons.push(`${low} low or anxious check-ins this week`);

  const cap = i.settings.dailyLossLimitSol;
  const solWeek = i.trades.filter((t) => t.pnlUnit === 'SOL' && typeof t.pnl === 'number' && (t.outcomeTs ?? t.ts) >= week).reduce((a, t) => a + (t.pnl as number), 0);
  if (cap > 0 && solWeek <= -3 * cap) (score += 2), reasons.push(`down ${Math.abs(solWeek).toFixed(2)} SOL this week, more than 3 days of your cap`);

  return { level: score >= 3 ? 'reach-out' : score >= 1 ? 'watch' : 'none', reasons };
}

/** Days in a row (ending today) with no lockout started and no trade forced through a lockout. */
export function cleanStreakDays(now: number, lockoutHistory: Lockout[], trades: TradeRecord[], firstUseTs: number): number {
  const day = (ts: number) => new Date(ts).toLocaleDateString('en-CA');
  const bad = new Set([...lockoutHistory.filter((l) => l.kind !== 'win').map((l) => day(l.startedAt)), ...trades.filter((t) => t.overrode && t.hits.includes('lockout')).map((t) => day(t.ts))]);
  let n = 0;
  for (let d = new Date(now); d.getTime() >= firstUseTs - DAY && n < 3650; d.setDate(d.getDate() - 1)) {
    if (bad.has(day(d.getTime()))) break;
    n++;
  }
  return Math.max(0, n - 1); // today isn't over yet
}
