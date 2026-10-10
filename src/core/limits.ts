// Cooling-off for limit changes (a responsible-gambling standard): making a limit STRICTER applies
// immediately; making it LOOSER waits `limitChangeDelayHours`, so a tilted moment can't undo a calm rule.
import type { Settings } from './types';

/** Numeric limits where a bigger number is looser. 0 means "off", the loosest of all. */
const HIGHER_IS_LOOSER_OFF_AT_0 = new Set<keyof Settings>([
  'dailyLossLimitUsd', 'weeklyLossLimitUsd', 'monthlyLossLimitUsd', 'maxLossesPerDay', 'tiltStreak', 'dailyScreenLimitMinutes',
  'sessionMaxMinutes', 'realityCheckMinutes', 'heaterWinStreak', 'bigWinUsd', 'bankrollMaxSol', 'typedConfirmAboveSol',
  'typedConfirmAboveUsd', 'escalationMultiple', 'dailyProfitTargetUsd', 'dailyLossLimitSol', 'maxBuysPerDay', 'maxOpenPositions',
  'maxASetupsPerDay', 'tokenReentryCooldownMin', 'maxEntriesPerTokenPerDay', 'lateEntryPct', 'stopLossPct',
]);
/** Numeric limits where a bigger number is looser (no off-switch). */
const HIGHER_IS_LOOSER = new Set<keyof Settings>([
  'maxPositionPct', 'maxLeverage', 'maxTradesPerHour', 'maxTradesPerDay', 'chaseThresholdPct', 'revengeSizeMultiple',
  'gateDevMaxPct', 'gateTop10MaxPct', 'gateInsidersMaxPct', 'scamMaxBundledPct', 'scamMaxFlaggedHoldPct', 'bankrollTargetSol',
]);
/** Numeric limits where a smaller number is looser. */
const LOWER_IS_LOOSER = new Set<keyof Settings>([
  'revengeWindowMin', 'countdownSeconds', 'lockoutMinutes', 'gateLpBurnedMinPct', 'gateMinLiquidityX', 'gateSeverity',
  'breakMinutes', 'cooldownAfterWinMin', 'rapidFireSeconds', 'lossLockoutHours', 'limitChangeDelayHours',
]);
/** Switches where turning OFF is looser. */
const OFF_IS_LOOSER = new Set<keyof Settings>([
  'enabled', 'gateEnabled', 'scamCheckEnabled', 'scamBlockExtreme', 'requireMoodCheckIn', 'askLastOutcome', 'commitmentMode',
  'quietHoursEnabled', 'sameTokenRebuyBlock', 'preBuyChecklist', 'fomoCopyWarning', 'gateBlockUnverified', 'siteBlockOnLockout', 'rulesLocked', 'helpRedirect',
]);

export function isLoosening(key: keyof Settings, from: unknown, to: unknown): boolean {
  if (from === to) return false;
  if (key === 'lockoutOverride') return from === 'none' && to !== 'none';
  if (OFF_IS_LOOSER.has(key)) return from === true && to === false;
  if (typeof from !== 'number' || typeof to !== 'number') return false;
  if (HIGHER_IS_LOOSER_OFF_AT_0.has(key)) return to === 0 ? from !== 0 : from !== 0 && to > from;
  if (HIGHER_IS_LOOSER.has(key)) return to > from;
  if (LOWER_IS_LOOSER.has(key)) return to < from;
  return false;
}

export interface PendingChange {
  changes: Partial<Settings>;
  effectiveAt: number;
}

/** Split a settings edit into what applies now and what waits out the cooling-off period. */
export function splitChanges(current: Settings, next: Partial<Settings>, now = Date.now()): { now: Partial<Settings>; later: PendingChange | null } {
  const immediate: Record<string, unknown> = {};
  const delayed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next) as [keyof Settings, unknown][]) {
    if (current[k] === v) continue;
    if (current.limitChangeDelayHours > 0 && isLoosening(k, current[k], v)) delayed[k] = v;
    else immediate[k] = v;
  }
  return {
    now: immediate as Partial<Settings>,
    later: Object.keys(delayed).length ? { changes: delayed as Partial<Settings>, effectiveAt: now + current.limitChangeDelayHours * 3600_000 } : null,
  };
}

/** Locked rules wait at least 72h to loosen. */
export const lockedDelayHours = (s: Settings) => (s.rulesLocked ? Math.max(72, s.limitChangeDelayHours) : s.limitChangeDelayHours);
