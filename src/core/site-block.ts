// Which lockouts close the trading sites entirely (not just the Buy button).
import type { Lockout, Settings } from './types';

export function siteBlockActive(lockout: Lockout | null, settings: Settings, now = Date.now()): boolean {
  if (!settings.enabled || !settings.siteBlockOnLockout || !lockout) return false;
  const left = lockout.until - now;
  // Short breaks keep the page (the overlay handles them); significant lockouts close the sites.
  return left > 30 * 60_000 && ['loss', 'self', 'time', 'win'].includes(lockout.kind ?? 'loss');
}
