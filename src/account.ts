// Link the extension to a TradeGuard SI account and sync with it (Pro/Ultra, opt-in).
//
// Security model for what comes BACK from the server: we only accept data that can make the
// trader safer — lockouts (e.g. /lock from Telegram), mood check-ins, and trade outcomes. We never
// pull settings, so a compromised account can't loosen limits or redirect the coach elsewhere.
import Anthropic from '@anthropic-ai/sdk';
import { keyStorageName, PROVIDERS, providerOf, type Provider } from './coach/providers';
import { API_BASE } from './config';
import type { Lockout, MoodEntry, TradeRecord } from './core/types';
import { loadState } from './storage';

export interface AccountLink {
  token: string;
  deviceId: string;
  apiBase: string;
  syncEnabled: boolean;
  cursor: string | null;
  plan?: 'free' | 'pro' | 'ultra';
  lastSyncAt?: number;
  lastError?: string | null;
}

export const getAccount = async () => ((await chrome.storage.local.get('account')) as { account?: AccountLink }).account ?? null;
const saveAccount = (a: AccountLink | null) => (a ? chrome.storage.local.set({ account: a }) : chrome.storage.local.remove('account'));

async function api<T>(a: Pick<AccountLink, 'apiBase' | 'token'> | { apiBase: string; token?: undefined }, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${a.apiBase}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(a.token ? { authorization: `Bearer ${a.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j?.error?.message ?? `Request failed (${res.status})`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return j as T;
}

export async function linkAccount(code: string, syncConsent: boolean, apiBase = API_BASE): Promise<AccountLink> {
  const r = await api<{ token: string; deviceId: string }>({ apiBase }, '/api/device/link', { code, syncConsent, label: 'Chrome extension' });
  const a: AccountLink = { token: r.token, deviceId: r.deviceId, apiBase, syncEnabled: syncConsent, cursor: null };
  await saveAccount(a);
  // First sync uploads the whole local journal.
  if (syncConsent) {
    const { trades, moods } = await loadState();
    await chrome.storage.local.set({ dirty: { trades: trades.map((t) => t.id), moods: moods.map((m) => m.ts), lockout: true } });
  }
  await refreshMe().catch(() => {});
  return a;
}

export async function unlinkAccount() {
  await saveAccount(null);
  await chrome.storage.local.remove(['dirty']);
}

export interface Me {
  plan: 'free' | 'pro' | 'ultra';
  planName: string;
  usage: { autoCheck: number; chat: number; deepReview: number };
  limits: { hostedAI: boolean; autoChecksPerMonth: number; chatMessagesPerMonth: number; deepReviewsPerMonth: number; sync: boolean; telegram: boolean };
  telegramLinked: boolean;
}

export async function refreshMe(): Promise<Me | null> {
  const a = await getAccount();
  if (!a) return null;
  try {
    const me = await api<Me>(a, '/api/me');
    await saveAccount({ ...a, plan: me.plan, lastError: null });
    return me;
  } catch (e) {
    if ((e as { status?: number }).status === 401) await saveAccount({ ...a, lastError: 'This device was unlinked from your account.' });
    throw e;
  }
}

/** Settings fields that are never uploaded (local-only plumbing). */
const LOCAL_ONLY = ['coachBaseUrl', 'coachProvider', 'coachProviderModels', 'scamApiBase', 'customSites', 'disabledAdapters'] as const;

export async function syncNow(): Promise<{ ok: boolean; reason?: string }> {
  let a = await getAccount();
  if (!a) return { ok: false, reason: 'not linked' };
  // Plan may have changed (e.g. just upgraded): re-check before deciding sync isn't available.
  if (!a.plan || a.plan === 'free') {
    await refreshMe().catch(() => {});
    a = (await getAccount())!;
  }
  if (!a.syncEnabled) return { ok: false, reason: 'sync off' };
  if (a.plan === 'free') return { ok: false, reason: 'free plan' };
  const state = await loadState();
  const { dirty = { trades: [], moods: [], lockout: false } } = (await chrome.storage.local.get('dirty')) as { dirty?: { trades: string[]; moods: number[]; lockout: boolean } };
  const settings = { ...state.settings } as Record<string, unknown>;
  for (const k of LOCAL_ONLY) delete settings[k];
  const l = state.lockout;
  const body = {
    cursor: a.cursor,
    trades: state.trades.filter((t) => dirty.trades.includes(t.id)).slice(-500),
    moods: state.moods.filter((m) => dirty.moods.includes(m.ts)).slice(-500),
    lockout: dirty.lockout && l ? { until: l.until, startedAt: l.startedAt, reason: l.reason.slice(0, 200), updatedMs: l.updatedMs ?? l.startedAt } : null,
    commitmentMode: state.settings.commitmentMode,
    settings: { value: settings, updatedMs: Date.now() },
  };

  let res: { cursor: string; trades: TradeRecord[]; moods: MoodEntry[]; lockout: Lockout & { updatedMs: number } | null; plan: AccountLink['plan'] };
  try {
    res = await api(a, '/api/sync', body);
  } catch (e) {
    const status = (e as { status?: number }).status;
    await saveAccount({ ...a, lastError: (e as Error).message, ...(status === 402 ? { plan: 'free' as const } : {}) });
    return { ok: false, reason: (e as Error).message };
  }

  // Merge what came back (safety-only).
  const cur = await loadState();
  const byId = new Map(cur.trades.map((t) => [t.id, t]));
  for (const t of res.trades) {
    const mine = byId.get(t.id);
    if (!mine) byId.set(t.id, t);
    else if (!mine.outcome && t.outcome) byId.set(t.id, { ...mine, outcome: t.outcome, outcomeTs: t.outcomeTs, pnl: t.pnl });
  }
  const moodTs = new Set(cur.moods.map((m) => m.ts));
  const moods = [...cur.moods, ...res.moods.filter((m) => !moodTs.has(m.ts))].sort((x, y) => x.ts - y.ts).slice(-2000);
  const trades = [...byId.values()].sort((x, y) => x.ts - y.ts).slice(-3000);
  const update: Record<string, unknown> = { trades, moods, dirty: { trades: [], moods: [], lockout: false } };
  // A remote lockout only ever extends protection; it never ends a local one early.
  const rl = res.lockout;
  if (rl && rl.until > Date.now() && (!cur.lockout || rl.until > cur.lockout.until)) {
    update.lockout = { until: rl.until, startedAt: rl.startedAt, reason: rl.reason, updatedMs: rl.updatedMs };
  }
  await chrome.storage.local.set(update);
  await saveAccount({ ...a, cursor: res.cursor, plan: res.plan, lastSyncAt: Date.now(), lastError: null });
  return { ok: true };
}

export interface CoachTransport {
  apiKey: string;
  baseURL?: string;
  hosted: boolean;
  provider: Provider;
  /** Model for the side-panel chat and for auto-checks, for this provider. */
  chatModel: string;
  autoModel: string;
}

/** Coach transport: your own key for the chosen provider first; otherwise the hosted coach if your plan includes it. */
export async function coachTransport(): Promise<CoachTransport | null> {
  const { settings } = await loadState();
  const provider = providerOf(settings.coachProvider);
  const keyName = keyStorageName(provider.id);
  const key = ((await chrome.storage.local.get(keyName)) as Record<string, string | undefined>)[keyName];
  if (key) {
    const picked = settings.coachProviderModels?.[provider.id] ?? {};
    const chatModel = provider.id === 'anthropic' ? settings.coachModel : picked.chat || provider.chat[0].id;
    return { apiKey: key, baseURL: settings.coachBaseUrl || provider.baseURL, hosted: false, provider, chatModel, autoModel: picked.auto || provider.auto };
  }
  // The hosted coach only serves Claude, so it always runs the Anthropic models.
  const a = await getAccount();
  if (a && a.plan && a.plan !== 'free') {
    const anthropic = PROVIDERS.anthropic;
    const chatModel = anthropic.chat.some((m) => m.id === settings.coachModel) ? settings.coachModel : anthropic.chat[0].id;
    return { apiKey: a.token, baseURL: `${a.apiBase}/api/coach`, hosted: true, provider: anthropic, chatModel, autoModel: anthropic.auto };
  }
  return null;
}

/** SDK client for a transport. OpenRouter wants a Bearer token and no x-api-key. */
export function coachClient(t: CoachTransport): Anthropic {
  const auth = !t.hosted && t.provider.auth === 'bearer' ? { apiKey: null, authToken: t.apiKey } : { apiKey: t.apiKey };
  return new Anthropic({ ...auth, dangerouslyAllowBrowser: true, ...(t.baseURL ? { baseURL: t.baseURL } : {}) });
}
