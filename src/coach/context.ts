// A compact picture of the trader for prompts: rules in force (after mood), today, lockout, and
// last-7-day patterns. Shared by the side panel, the on-page auto-check and the Telegram bot.
import { computeStats, insights } from '../core/insights';
import { compactJson } from '../core/live';
import { applyMood, currentMood, moodAdjustment } from '../core/mood';
import { dayPnl, lossStreak, startOfDay } from '../core/rules';
import type { Lockout, MoodEntry, Settings, TradeRecord } from '../core/types';

export interface TraderState {
  settings: Settings;
  trades: TradeRecord[];
  moods: MoodEntry[];
  lockout: Lockout | null;
}

export function traderContext(st: TraderState, now = Date.now()): string {
  const mood = currentMood(st.moods, now);
  const adj = moodAdjustment(mood);
  const s = applyMood(st.settings, adj);
  const week = st.trades.filter((t) => t.ts >= now - 7 * 86_400_000);
  const stats = computeStats(week);
  return compactJson({
    limitsInForce: {
      maxPositionPct: s.maxPositionPct, maxLeverage: s.maxLeverage, maxTradesPerHour: s.maxTradesPerHour, maxTradesPerDay: s.maxTradesPerDay,
      chaseThresholdPct: s.chaseThresholdPct, dailyLossLimitUsd: s.dailyLossLimitUsd || undefined,
    },
    entryGate: s.gateEnabled
      ? { lpBurnedMinPct: s.gateLpBurnedMinPct, devMaxPct: s.gateDevMaxPct, top10MaxPct: s.gateTop10MaxPct, snipersBundlersInsidersMaxPct: s.gateInsidersMaxPct, minLiquidityX: s.gateMinLiquidityX }
      : 'off',
    mood: mood ? { score: mood.score, tags: mood.tags, note: adj.note } : 'no recent check-in',
    today: { trades: st.trades.filter((t) => t.ts >= startOfDay(now)).length, loggedPnlUsd: dayPnl(st.trades, now), lossStreak: lossStreak(st.trades) },
    lockout: st.lockout && st.lockout.until > now ? { reason: st.lockout.reason, minutesLeft: Math.ceil((st.lockout.until - now) / 60_000) } : undefined,
    last7d: { trades: stats.total, winRate: stats.winRate, overrideWinRate: stats.overrideWinRate, patterns: insights(week).map((i) => i.text) },
  });
}
