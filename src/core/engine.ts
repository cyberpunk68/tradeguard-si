import { applyMood, moodAdjustment } from './mood';
import { ALL_RULES } from './rules';
import type { EvalContext, FrictionLevel, LockoutKind, RuleHit, Verdict } from './types';

const clamp = (n: number, max: FrictionLevel): FrictionLevel => Math.min(n, max) as FrictionLevel;

/**
 * Judge one order. Pure: same context in, same verdict out.
 *
 * Escalation:
 *  - level = the most severe rule hit
 *  - 3+ separate warnings at once → +1 (they compound: big + levered + chasing is much worse than any one)
 *  - a bad mood → +frictionBump
 *  - only lockout-class rules (lockout, daily loss, tilt) can reach level 4
 */
export function evaluate(ctx: EvalContext): Verdict {
  const adj = moodAdjustment(ctx.mood);
  const effective = applyMood(ctx.settings, adj);

  if (!ctx.settings.enabled) {
    return { level: 0, hits: [], startLockout: null, effective, moodNote: null };
  }

  const hits: RuleHit[] = [];
  for (const rule of ALL_RULES) {
    const hit = rule(ctx, effective);
    if (hit) hits.push(hit);
  }

  let level = hits.reduce<number>((m, h) => Math.max(m, h.severity), 0);

  if (level < 4) {
    const serious = hits.filter((h) => h.severity >= 2).length;
    if (serious >= 3) level += 1;
    if (level > 0) level += adj.frictionBump;
    else if (adj.frictionBump > 0) {
      // Nothing broke a rule, but they told us they're not in a good state.
      hits.push({
        rule: 'mood',
        severity: 1,
        title: 'Check your state',
        message: `${adj.note} Nothing here breaks your rules, but this is the state where good traders make bad calls. Is this trade in your plan?`,
      });
      level = 1;
    }
    level = Math.min(level, 3);
  }

  // Lockout-class rules (loss limits, stop-win, breaks…) start a lockout; the longest one wins.
  let startLockout: Verdict['startLockout'] = null;
  const alreadyLocked = hits.some((h) => h.rule === 'lockout');
  const lockHit = hits.filter((h) => h.lockout).sort((a, b) => b.lockout!.minutes - a.lockout!.minutes)[0];
  if (lockHit && !alreadyLocked) {
    startLockout = { minutes: lockHit.lockout!.minutes, reason: lockHit.title.replace(/\.?$/, '.'), kind: lockHit.lockout!.kind };
  }

  return { level: clamp(level, 4), hits, startLockout, effective, moodNote: adj.note };
}
