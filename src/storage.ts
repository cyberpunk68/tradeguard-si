// Typed wrapper over chrome.storage.local. Usable from content scripts, extension pages and the service worker.
// All data stays on this device. Nothing is ever sent over the network.
import { DEFAULT_SETTINGS } from './core/defaults';
import type { Activity, Lockout, LockoutKind, MoodEntry, RuleId, Settings, TradeRecord } from './core/types';
import type { PendingChange } from './core/limits';
import type { DistressEvent } from './core/distress';

/** A trade the trader backed out of after a warning. */
export interface SaveRecord {
  ts: number;
  site: string;
  rules: RuleId[];
  notional: number | null;
  unit: TradeRecord['unit'];
}

export interface StoredState {
  settings: Settings;
  trades: TradeRecord[];
  moods: MoodEntry[];
  lockout: Lockout | null;
  saves: SaveRecord[];
  activity: Activity | null;
  pendingSettings: PendingChange | null;
  lockoutHistory: Lockout[];
  distressEvents: DistressEvent[];
}

const MAX_TRADES = 3000;
const MAX_MOODS = 2000;

export async function loadState(): Promise<StoredState> {
  const raw = (await chrome.storage.local.get(['settings', 'trades', 'moods', 'lockout', 'saves', 'activity', 'pendingSettings', 'lockoutHistory', 'distressEvents'])) as Partial<StoredState>;
  return {
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    trades: raw.trades ?? [],
    moods: raw.moods ?? [],
    lockout: raw.lockout ?? null,
    saves: raw.saves ?? [],
    activity: raw.activity ?? null,
    pendingSettings: raw.pendingSettings ?? null,
    lockoutHistory: raw.lockoutHistory ?? [],
    distressEvents: raw.distressEvents ?? [],
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const { settings } = await loadState();
  const next = { ...settings, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** Records changed locally since the last successful sync (ids for trades, timestamps for moods). */
async function markDirty(kind: 'trades' | 'moods' | 'lockout', key?: string | number) {
  const { dirty = { trades: [], moods: [], lockout: false } } = (await chrome.storage.local.get('dirty')) as { dirty?: { trades: string[]; moods: number[]; lockout: boolean } };
  if (kind === 'lockout') dirty.lockout = true;
  else if (kind === 'trades' && !dirty.trades.includes(key as string)) dirty.trades.push(key as string);
  else if (kind === 'moods' && !dirty.moods.includes(key as number)) dirty.moods.push(key as number);
  await chrome.storage.local.set({ dirty });
}

export async function addTrade(t: TradeRecord): Promise<void> {
  const { trades } = await loadState();
  await chrome.storage.local.set({ trades: [...trades, t].slice(-MAX_TRADES) });
  await markDirty('trades', t.id);
}

export async function updateTrade(id: string, patch: Partial<TradeRecord>): Promise<void> {
  const { trades } = await loadState();
  await chrome.storage.local.set({ trades: trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  await markDirty('trades', id);
}

export async function addMood(m: MoodEntry): Promise<void> {
  const { moods } = await loadState();
  await chrome.storage.local.set({ moods: [...moods, m].slice(-MAX_MOODS) });
  await markDirty('moods', m.ts);
}

export async function addSave(r: SaveRecord): Promise<void> {
  const { saves } = await loadState();
  await chrome.storage.local.set({ saves: [...saves, r].slice(-MAX_TRADES) });
}

export async function startLockout(minutes: number, reason: string, kind: LockoutKind = 'loss'): Promise<Lockout> {
  const now = Date.now();
  const { lockout: cur } = await loadState();
  // Never shorten an active lockout by starting a new one.
  if (cur && cur.until > now + minutes * 60_000) return cur;
  const lockout: Lockout = { startedAt: now, until: now + minutes * 60_000, reason, kind, updatedMs: now };
  const { lockoutHistory } = await loadState();
  await chrome.storage.local.set({ lockout, lockoutHistory: [...lockoutHistory, lockout].slice(-200) });
  if (kind === 'self') await logDistress('selfExclusion');
  await markDirty('lockout');
  return lockout;
}

/** Ending a lockout early is refused in commitment mode and for self-exclusion. */
export async function endLockout(): Promise<boolean> {
  const { settings, lockout } = await loadState();
  if (!lockout || lockout.until <= Date.now()) return true;
  if (settings.commitmentMode || settings.rulesLocked || lockout.kind === 'self') return false;
  // Keep startedAt so tilt/daily-loss counters still reset from this point.
  await chrome.storage.local.set({ lockout: { ...lockout, until: Date.now(), updatedMs: Date.now() } });
  await markDirty('lockout');
  return true;
}

export function isLocked(l: Lockout | null, now = Date.now()): l is Lockout {
  return !!l && l.until > now;
}

/** The most recent trade still waiting for its outcome (within 24h). */
export function pendingOutcome(trades: TradeRecord[], now = Date.now()): TradeRecord | null {
  for (let i = trades.length - 1; i >= 0; i--) {
    const t = trades[i];
    if (now - t.ts > 24 * 3600_000) return null;
    if (!t.outcome && !t.partOf && t.side !== 'sell') return t;
  }
  return null;
}

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Record a risky moment (refused chase override, refused unlock, override, self-exclusion). Local only. */
export async function logDistress(kind: DistressEvent['kind']): Promise<void> {
  const { distressEvents } = await loadState();
  await chrome.storage.local.set({ distressEvents: [...distressEvents, { ts: Date.now(), kind }].slice(-200) });
}
