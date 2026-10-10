// Service worker: badge, lockout expiry, onboarding, and custom-site registration.
// No state lives in variables here. The service worker is ephemeral, so everything is read from storage.
import { startOfDay } from '../core/rules';
import type { Settings } from '../core/types';
import { fetchScamReport } from '../scam/isitbundled';
import { autoCheck } from '../coach/autocheck';
import { getAccount, refreshMe, syncNow } from '../account';
import type { LiveSnapshot } from '../core/live';
import { isLocked, loadState, saveSettings, startLockout } from '../storage';
import { evaluate } from '../core/engine';
import { currentMood } from '../core/mood';
import { realityCheckRule } from '../core/protect-rules';
import { syncWalletPnl } from '../onchain/rpc';
import { siteBlockActive } from '../core/site-block';
import type { Activity, OrderIntent } from '../core/types';

const LOCK_ALARM = 'lockout-end';

async function refreshBadge() {
  const { lockout, trades, settings } = await loadState();
  if (!settings.enabled) {
    await chrome.action.setBadgeText({ text: 'off' });
    await chrome.action.setBadgeBackgroundColor({ color: '#555b66' });
    return;
  }
  if (isLocked(lockout)) {
    await chrome.action.setBadgeText({ text: 'LOCK' });
    await chrome.action.setBadgeBackgroundColor({ color: '#ff6159' });
    await chrome.alarms.create(LOCK_ALARM, { when: lockout.until + 500 });
    return;
  }
  const today = trades.filter((t) => t.ts >= startOfDay(Date.now())).length;
  const left = settings.maxTradesPerDay - today;
  await chrome.action.setBadgeText({ text: today ? `${today}` : '' });
  await chrome.action.setBadgeBackgroundColor({ color: left <= 1 ? '#f3b74f' : '#2b3240' });
}

export async function registerCustomSites() {
  const { settings } = await loadState();
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ids = existing.filter((s) => s.id.startsWith('custom-')).map((s) => s.id);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  const granted = await Promise.all(
    settings.customSites.map(async (host) => ((await chrome.permissions.contains({ origins: [`https://${host}/*`] })) ? host : null)),
  );
  const scripts = granted
    .filter((h): h is string => !!h)
    .map((host) => ({ id: `custom-${host}`, matches: [`https://${host}/*`], js: ['content.js'], runAt: 'document_idle' as const, allFrames: false }));
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await chrome.runtime.openOptionsPage();
  // Periodic tick so the "trades today" badge resets after midnight.
  await chrome.alarms.create('tick', { periodInMinutes: 30 });
  await chrome.alarms.create('sync', { periodInMinutes: 1 });
  await registerCustomSites();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create('sync', { periodInMinutes: 1 });
  await refreshMe().catch(() => {});
  await registerCustomSites();
  await refreshBadge();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.lockout || changes.trades || changes.settings) await refreshBadge();
  // Local changes waiting to sync: push soon (a lockout immediately, so Telegram knows).
  if (changes.dirty?.newValue && (await getAccount())) {
    const d = changes.dirty.newValue as { trades: string[]; moods: number[]; lockout: boolean };
    if (d.lockout) await syncNow().catch(() => {});
    else if (d.trades.length || d.moods.length) await chrome.alarms.create('sync-soon', { delayInMinutes: 0.5 });
  }
  if (changes.settings) {
    const before = (changes.settings.oldValue as Settings | undefined)?.customSites ?? [];
    const after = (changes.settings.newValue as Settings | undefined)?.customSites ?? [];
    if (JSON.stringify(before) !== JSON.stringify(after)) await registerCustomSites();
  }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'sync' || a.name === 'sync-soon') {
    if (await getAccount()) await syncNow().catch(() => {});
    return;
  }
  await refreshBadge();
});

// Bundle/scam lookups for content scripts and the coach. Done here (not in the page) so the
// exchange's CSP can't block it and results are cached once per browser session.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'scan' || typeof msg.address !== 'string') return false;
  (async () => {
    try {
      const { settings } = await loadState();
      if (!settings.scamCheckEnabled) return sendResponse({ ok: false, error: 'Scam check is turned off in settings.' });
      sendResponse({ ok: true, report: await fetchScamReport(msg.address, settings.scamApiBase) });
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message ?? String(err) });
    }
  })();
  return true; // async response
});

// Live auto-check from a content script: a quick AI verdict when a new token page opens.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'autoCheck' || !msg.snapshot) return false;
  autoCheck(msg.snapshot as LiveSnapshot, sender.tab?.windowId)
    .then(sendResponse)
    .catch((err: Error) => sendResponse({ skipped: `error: ${err.message}` }));
  return true;
});

// Keyboard shortcut → coach side panel. Must call open() synchronously in the gesture.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-coach' && tab?.windowId != null) void chrome.sidePanel.open({ windowId: tab.windowId });
});

// Options page / panel ask for an immediate sync.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'syncNow') return false;
  syncNow().then(sendResponse, (e: Error) => sendResponse({ ok: false, reason: e.message }));
  return true;
});

// ---------- Gambling-harm protections that don't wait for a click ----------

const IDLE_INTENT: OrderIntent = { site: '', symbol: null, side: null, market: 'spot', unit: 'USD', notional: null, leverage: null, balance: null, priceChangePct: null, priceWindowMin: null };
const localDate = (ts = Date.now()) => new Date(ts).toLocaleDateString('en-CA'); // YYYY-MM-DD

/** Start any lockout the current state already calls for (stop-win, loss caps, screen time, breaks). */
async function enforceLockouts(): Promise<void> {
  const st = await loadState();
  if (!st.settings.enabled || isLocked(st.lockout)) return;
  const now = Date.now();
  const v = evaluate({ now, intent: IDLE_INTENT, settings: st.settings, trades: st.trades, mood: currentMood(st.moods, now), lockout: st.lockout, activity: st.activity });
  if (v.startLockout) await startLockout(v.startLockout.minutes, v.startLockout.reason, v.startLockout.kind);
}

/** One writer for time-on-site, so several open trading tabs don't double count. */
async function activityTick(): Promise<{ realityCheck?: string }> {
  const st = await loadState();
  const now = Date.now();
  const today = localDate(now);
  const prev = st.activity;
  const a: Activity =
    prev && prev.date === today
      ? { ...prev }
      : { date: today, minutesToday: 0, sessionMinutes: 0, lastActiveTs: now, realityCheckedAt: 0 };
  // Only the focused tab ticks, but guard against double counting within the same minute anyway.
  if (a.minutesToday > 0 && now - a.lastActiveTs < 50_000) return {};
  if (now - a.lastActiveTs > 10 * 60_000) a.sessionMinutes = 0; // a real break resets the session
  a.minutesToday += 1;
  a.sessionMinutes += 1;
  a.lastActiveTs = now;

  let realityCheck: string | undefined;
  const hit = realityCheckRule({ now, intent: IDLE_INTENT, settings: st.settings, trades: st.trades, mood: null, lockout: st.lockout, activity: a }, st.settings);
  if (hit) {
    realityCheck = hit.message;
    a.realityCheckedAt = a.minutesToday;
  }
  const { activityHistory = {} } = (await chrome.storage.local.get('activityHistory')) as { activityHistory?: Record<string, number> };
  activityHistory[today] = a.minutesToday;
  const keep = Object.keys(activityHistory).sort().slice(-60);
  await chrome.storage.local.set({ activity: a, activityHistory: Object.fromEntries(keep.map((k) => [k, activityHistory[k]])) });
  await enforceLockouts();
  return realityCheck ? { realityCheck } : {};
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'activityTick') {
    activityTick().then(sendResponse, () => sendResponse({}));
    return true;
  }
  if (msg?.type === 'closeTab' && sender.tab?.id != null) {
    void chrome.tabs.remove(sender.tab.id);
    return false;
  }
  return false;
});

// A logged outcome can cross a limit (stop-win, losses/day, SOL cap): lock right away, not at the next click.
chrome.storage.onChanged.addListener(async (c, area) => {
  if (area !== 'local') return;
  if (c.trades) await enforceLockouts();
  if (c.pendingSettings?.newValue) {
    const p = c.pendingSettings.newValue as { effectiveAt: number };
    await chrome.alarms.create('pendingSettings', { when: Math.max(Date.now() + 1000, p.effectiveAt) });
  }
});

// Loosened limits take effect only after the cooling-off period.
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'pendingSettings') return;
  const { pendingSettings } = await loadState();
  if (!pendingSettings) return;
  if (pendingSettings.effectiveAt > Date.now()) return void chrome.alarms.create('pendingSettings', { when: pendingSettings.effectiveAt });
  await saveSettings(pendingSettings.changes);
  await chrome.storage.local.remove('pendingSettings');
});

// ---------- On-chain P&L: the loss cap works even if nobody logs a trade ----------

async function chainTick() {
  const r = await syncWalletPnl();
  for (const c of r.closed) {
    // Tell open trading tabs: show the leftover-orders reminder and start post-exit tracking.
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'positionClosed', ...c }).catch(() => {});
    }
  }
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'chain') void chainTick();
});
async function scheduleChain() {
  const { settings } = await loadState();
  if (settings.tradingWallet) await chrome.alarms.create('chain', { periodInMinutes: 1 });
  else await chrome.alarms.clear('chain');
}
chrome.runtime.onStartup.addListener(() => void scheduleChain());
chrome.runtime.onInstalled.addListener(() => void scheduleChain());
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.settings) {
    const before = (c.settings.oldValue as { tradingWallet?: string } | undefined)?.tradingWallet;
    const after = (c.settings.newValue as { tradingWallet?: string } | undefined)?.tradingWallet;
    if (before !== after) void scheduleChain().then(chainTick);
  }
});
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type !== 'chainSyncNow') return false;
  chainTick().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});

// ---------- Public market data for the late-entry rule (DexScreener; only the token address is sent) ----------
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type !== 'marketData' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(msg.address))) return false;
  (async () => {
    const key = `md:${msg.address}`;
    const hit = (await chrome.storage.session.get(key))[key] as { at: number; data: unknown } | undefined;
    if (hit && Date.now() - hit.at < 120_000) return sendResponse(hit.data);
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${msg.address}`, { signal: AbortSignal.timeout(4000) });
      const j = (await r.json()) as { pairs?: Record<string, any>[] | null };
      const pair = (j.pairs ?? []).filter((p) => p.chainId === 'solana').sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const data = pair
        ? { h1: n(pair.priceChange?.h1), h6: n(pair.priceChange?.h6), h24: n(pair.priceChange?.h24), ageMin: n(pair.pairCreatedAt) ? Math.round((Date.now() - pair.pairCreatedAt) / 60000) : null }
        : null;
      await chrome.storage.session.set({ [key]: { at: Date.now(), data } });
      sendResponse(data);
    } catch {
      sendResponse(null);
    }
  })();
  return true;
});

// ---------- Literal site block: during significant lockouts, trading sites don't load at all ----------
const BLOCK_RULE_ID = 9001;

async function blockedDomains(): Promise<string[]> {
  const { settings } = await loadState();
  const fromManifest = (chrome.runtime.getManifest().content_scripts ?? []).flatMap((c) => c.matches ?? []);
  const hosts = [...fromManifest.map((m) => m.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')), ...settings.customSites];
  return [...new Set(hosts.filter(Boolean))];
}

async function applySiteBlock(): Promise<void> {
  const { lockout, settings } = await loadState();
  const on = siteBlockActive(lockout, settings);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [BLOCK_RULE_ID],
    addRules: on
      ? [{
          id: BLOCK_RULE_ID,
          priority: 1,
          action: { type: chrome.declarativeNetRequest.RuleActionType.REDIRECT, redirect: { extensionPath: '/blocked.html' } },
          condition: { requestDomains: await blockedDomains(), resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME] },
        }]
      : [],
  });
  if (on && lockout) await chrome.alarms.create('siteBlockEnd', { when: lockout.until + 1000 });
  else await chrome.alarms.clear('siteBlockEnd');
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && (c.lockout || c.settings)) void applySiteBlock();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'siteBlockEnd') void applySiteBlock();
});
chrome.runtime.onStartup.addListener(() => void applySiteBlock());
chrome.runtime.onInstalled.addListener(() => void applySiteBlock());
