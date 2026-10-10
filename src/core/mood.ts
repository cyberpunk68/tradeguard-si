import { MOOD_TTL_MS } from './defaults';
import type { MoodEntry, MoodTag, Settings } from './types';

/** Tags that, on their own, signal a state where traders make worse decisions. */
export const HOT_TAGS: MoodTag[] = ['fomo', 'angry', 'euphoric'];
export const DRAINED_TAGS: MoodTag[] = ['tired', 'anxious', 'bored'];

export function currentMood(moods: MoodEntry[], now: number): MoodEntry | null {
  const latest = moods.reduce<MoodEntry | null>((a, m) => (!a || m.ts > a.ts ? m : a), null);
  return latest && now - latest.ts <= MOOD_TTL_MS ? latest : null;
}

export interface MoodAdjustment {
  /** Multiplier applied to size, leverage and trade-count limits (1 = unchanged, 0.5 = halved). */
  limitFactor: number;
  /** Added to the final friction level (capped below lockout). */
  frictionBump: 0 | 1 | 2;
  note: string | null;
}

/**
 * How much a check-in should tighten the rules.
 *
 * This is a judgment call more than a formula. Hot states (FOMO, anger,
 * euphoria) hurt traders by making them size up and act fast. Drained states
 * (tired, anxious) hurt through sloppy execution. The default treats hot
 * states as more dangerous.
 */
export function moodAdjustment(mood: MoodEntry | null): MoodAdjustment {
  if (!mood) return { limitFactor: 1, frictionBump: 0, note: null };

  const hot = mood.tags.filter((t) => HOT_TAGS.includes(t));
  const drained = mood.tags.filter((t) => DRAINED_TAGS.includes(t));

  if (mood.score <= 2 || hot.length > 0) {
    const why = hot.length ? `you checked in as ${hot.join(' + ')}` : `you rated your state ${mood.score}/5`;
    return { limitFactor: 0.5, frictionBump: 1, note: `Limits halved because ${why}.` };
  }
  if (mood.score === 3 || drained.length > 0) {
    const why = drained.length ? `you're feeling ${drained.join(' + ')}` : `you rated your state 3/5`;
    return { limitFactor: 0.75, frictionBump: 0, note: `Limits tightened 25% because ${why}.` };
  }
  return { limitFactor: 1, frictionBump: 0, note: null };
}

/** Apply a mood adjustment to the limits. Lower limits = stricter. */
export function applyMood(s: Settings, adj: MoodAdjustment): Settings {
  if (adj.limitFactor === 1) return s;
  const f = adj.limitFactor;
  return {
    ...s,
    maxPositionPct: round(s.maxPositionPct * f),
    maxLeverage: Math.max(1, round(s.maxLeverage * f)),
    maxTradesPerHour: Math.max(1, Math.floor(s.maxTradesPerHour * f)),
    maxTradesPerDay: Math.max(1, Math.floor(s.maxTradesPerDay * f)),
    chaseThresholdPct: round(s.chaseThresholdPct * f),
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
