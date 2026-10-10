// The interceptor. Runs on supported exchanges, catches order clicks in the capture
// phase (before the exchange's own handlers), judges the order, and only replays the
// click if the trader makes it through the friction.
import { adapterFor } from '../adapters';
import { readFlowStats, readTokenStats, sideFromText, textOf, type SiteAdapter } from '../adapters/heuristics';
import { PREVIEW_LABEL, type LiveSnapshot } from '../core/live';
import { summarize } from '../core/series';
import { DEFAULT_SETTINGS } from '../core/defaults';
import { evaluate } from '../core/engine';
import { currentMood } from '../core/mood';
import { scamFindings } from '../core/token-rules';
import type { LockoutKind, OrderIntent, ScamReport, Settings, TradeRecord } from '../core/types';
import { addMood, addSave, addTrade, isLocked, loadState, pendingOutcome, startLockout, uid, updateTrade, type StoredState } from '../storage';
import { checklist, coachChip, intervene, preflight, riskChip, toast } from './overlay';
import { startOfDay } from '../core/rules';
import { siteBlockActive } from '../core/site-block';

declare global {
  interface Window {
    __tradeguard?: boolean;
  }
}

if (!window.__tradeguard) {
  window.__tradeguard = true;
  void main();
}

async function main() {
  {
    const st = await loadState();
    if (siteBlockActive(st.lockout, st.settings)) return void location.replace(chrome.runtime.getURL('blocked.html'));
  }
  let settings: Settings = DEFAULT_SETTINGS;
  let adapter: SiteAdapter | null = null;

  const refresh = async () => {
    settings = (await loadState()).settings;
    adapter = adapterFor(location.hostname, settings.disabledAdapters, location.pathname);
  };
  await refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void refresh();
  });

  // ---- Price sampling for the chasing rule ----
  // We watch the price ourselves while the tab is open, so chasing works on any site
  // that shows a price, without an API.
  const samples: { ts: number; price: number }[] = [];
  const sample = () => {
    const p = adapter?.readPrice();
    if (p == null) return;
    samples.push({ ts: Date.now(), price: p });
    const cutoff = Date.now() - 2 * 60 * 60_000;
    while (samples.length && samples[0].ts < cutoff) samples.shift();
  };
  sample();
  setInterval(sample, 3000);

  function priceChange(windowMin: number): { pct: number; min: number } | null {
    const now = Date.now();
    const inWindow = samples.filter((s) => s.ts >= now - windowMin * 60_000);
    if (inWindow.length < 2) return null;
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    // Need at least ~1 minute of history before we say anything about a move.
    if (last.ts - first.ts < 60_000 || first.price <= 0) return null;
    // Use the low (for buys) so "dipped then ripped" still counts as a run-up from the bottom.
    const low = Math.min(...inWindow.map((s) => s.price));
    const high = Math.max(...inWindow.map((s) => s.price));
    const up = ((last.price - low) / low) * 100;
    const down = ((last.price - high) / high) * 100;
    return { pct: Math.abs(up) >= Math.abs(down) ? up : down, min: Math.max(1, Math.round((last.ts - first.ts) / 60_000)) };
  }

  // ---- Scam / bundle check ----
  // Looked up as soon as a token page opens, so the answer is ready before any click.
  const scans = new Map<string, Promise<{ report: ScamReport | null; error: string | null }>>();
  const scan = (address: string) => {
    let p = scans.get(address);
    if (!p) {
      p = chrome.runtime
        .sendMessage({ type: 'scan', address })
        .then((r: { ok: boolean; report?: ScamReport; error?: string }) => (r?.ok ? { report: r.report!, error: null } : { report: null, error: r?.error ?? 'unavailable' }))
        .catch((e: Error) => ({ report: null, error: e.message }));
      p.then((r) => r.error && scans.delete(address)); // retry failures next time
      scans.set(address, p);
    }
    return p;
  };
  const scanDone = new Map<string, { report: ScamReport | null; error: string | null }>();
  const scanTracked = (address: string) => scan(address).then((r) => (scanDone.set(address, r), r));

  // Cached stored state for the live preview (refreshed whenever storage changes).
  let state: StoredState | null = null;
  const reloadState = async () => (state = await loadState());
  await reloadState();
  chrome.storage.onChanged.addListener((_c, area) => area === 'local' && void reloadState());

  // ---- Live snapshot: what the coach sees, and what a Buy would trigger right now ----
  function findBuyControl(): HTMLElement | null {
    for (const b of document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')) {
      const c = adapter?.findOrderControl(b);
      if (c && sideFromText(textOf(c)) === 'buy') return c;
    }
    return null;
  }

  function buildSnapshot(): LiveSnapshot {
    const now = Date.now();
    const address = adapter?.tokenAddress() ?? null;
    const scanned = address ? scanDone.get(address) : undefined;
    const control = findBuyControl();
    let intent: OrderIntent | null = null;
    try {
      intent = control && adapter ? { ...adapter.readIntent(control), side: 'buy' } : null;
    } catch {
      intent = null;
    }
    const chg = priceChange(settings.chaseWindowMin);
    if (intent) {
      intent.priceChangePct = chg?.pct ?? null;
      intent.priceWindowMin = chg?.min ?? null;
      intent.scam = scanned?.report ?? null;
    }
    let preview: LiveSnapshot['preview'] = null;
    if (intent && state) {
      const v = evaluate({ now, intent, settings: state.settings, trades: state.trades, mood: currentMood(state.moods, now), lockout: state.lockout });
      preview = { level: v.level, label: PREVIEW_LABEL[v.level], hits: v.hits.map((h) => ({ rule: h.rule, title: h.title, points: h.points })) };
    }
    const token = intent?.token ?? (adapter?.tokenAddress() ? readTokenStats() : null);
    const notional = intent?.notional ?? null;
    const balance = intent?.balance ?? null;
    return {
      ts: now,
      site: adapter?.name ?? 'unknown',
      url: location.origin + location.pathname,
      title: document.title.slice(0, 120),
      symbol: intent?.symbol ?? scanned?.report?.symbol ?? null,
      tokenAddress: address,
      price: adapter?.readPrice() ?? null,
      series: summarize(samples, now),
      token,
      flow: address ? readFlowStats() : null,
      scam: scanned?.report ?? null,
      scamStatus: !address ? 'n/a' : !settings.scamCheckEnabled ? 'off' : !scanned ? 'pending' : scanned.report ? 'ok' : 'error',
      order: intent
        ? { side: 'buy', notional, unit: intent.unit, balance, leverage: intent.leverage, pctOfBalance: notional && balance ? (notional / (intent.leverage && intent.market === 'perp' ? intent.leverage : 1) / balance) * 100 : null }
        : null,
      preview,
      locked: state && isLocked(state.lockout, now) ? { reason: state.lockout.reason, until: state.lockout.until } : null,
    };
  }

  // ---- Token tracking: scam chip + on-page AI auto-check ----
  let watched: string | null = null;
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  const watchToken = async () => {
    const address = settings.enabled ? adapter?.tokenAddress() ?? null : null;
    if (address === watched) return;
    watched = address;
    samples.length = 0; // new token: its own price history
    riskChip(null);
    coachChip(null);
    clearTimeout(autoTimer);
    if (!address) return;

    if (settings.scamCheckEnabled) {
      const { report } = await scanTracked(address);
      if (report && watched === address) {
        const { severity, reasons } = scamFindings(report, settings);
        const level = report.risk === 'extreme' ? 'extreme' : severity >= 3 || report.risk === 'high' ? 'high' : severity >= 2 || report.risk === 'medium' ? 'medium' : null;
        if (level) {
          riskChip({
            level,
            headline: `${report.symbol ? '$' + report.symbol + ': ' : ''}${level === 'extreme' ? 'likely scam launch' : 'bundled launch'}`,
            detail: [report.risk ? `Risk ${report.risk.toUpperCase()}` : null, report.bundledPct != null ? `${Math.round(report.bundledPct)}% bundled` : null, reasons[2] ?? null].filter(Boolean).join(' · '),
            href: report.report,
          });
        }
      }
    }

    // Give the page a moment to render its stats, then ask for a quick verdict (works with the panel closed).
    if (settings.coachAutoCheck) {
      autoTimer = setTimeout(async () => {
        if (watched !== address) return;
        const res = await chrome.runtime.sendMessage({ type: 'autoCheck', snapshot: buildSnapshot() }).catch(() => null);
        if (watched === address && res?.verdict) coachChip({ verdict: res.verdict, symbol: res.symbol, withChart: res.withChart, source: res.source });
      }, 2500);
    }
  };
  void watchToken();
  setInterval(() => void watchToken(), 1500); // SPA navigation between tokens

  // ---- After an exit: leftover-orders reminder + post-exit high/low (to test stop width with data) ----
  function trackPostExit(recordId: string, exitPrice: number | null) {
    const startTs = Date.now();
    const token = adapter?.tokenAddress();
    setTimeout(async () => {
      if (adapter?.tokenAddress() !== token) return; // navigated away: no clean read
      const after = samples.filter((x) => x.ts >= startTs).map((x) => x.price);
      if (!after.length) return;
      await updateTrade(recordId, { exitPrice, postExitHigh: Math.max(...after), postExitLow: Math.min(...after) });
    }, 10 * 60_000);
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'positionClosed') return;
    if (!adapter?.tokenAddress()) return; // only memecoin terminals
    const sym = msg.mint === adapter.tokenAddress() ? '' : ` (${String(msg.mint).slice(0, 4)}…)`;
    riskChip({
      level: msg.pnlSol < 0 ? 'high' : 'medium',
      headline: `Position closed${sym}: ${msg.pnlSol >= 0 ? '+' : ''}${Number(msg.pnlSol).toFixed(3)} SOL`,
      detail: 'Its take-profit / stop / trailing orders may still be armed. Axiom → Orders → Cancel All. Logged automatically.',
    });
    if (msg.mint === adapter.tokenAddress()) {
      void loadState().then((st) => {
        const rec = st.trades.find((t) => t.chainId === msg.chainId);
        if (rec) trackPostExit(rec.id, adapter?.readPrice() ?? null);
      });
    }
  });

  // ---- Coach connections ----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ping') return void sendResponse({ ok: true, site: adapter?.name });
    if (msg?.type !== 'snapshot') return false;
    (async () => {
      const address = adapter?.tokenAddress();
      if (address && settings.scamCheckEnabled && !scanDone.has(address)) await scanTracked(address);
      sendResponse(buildSnapshot());
    })();
    return true;
  });

  // Side panel holds a port open while it's visible; push a fresh snapshot whenever something changes.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'live') return;
    let last = '';
    let lastSent = 0;
    const push = () => {
      const snap = buildSnapshot();
      const { ts, ...rest } = snap;
      void ts;
      const key = JSON.stringify(rest);
      if (key === last && Date.now() - lastSent < 10_000) return;
      last = key;
      lastSent = Date.now();
      port.postMessage(snap);
    };
    push();
    const timer = setInterval(push, 2000);
    port.onDisconnect.addListener(() => clearInterval(timer));
  });

  // ---- FOMO copy in callouts/chat ----
  // Callout feeds are written to rush you ("it'll be too late later", "this one sends, dont sleep").
  const FOMO = [
    /(it'?ll be |before it'?s |don'?t be )too late( later)?/i, /\bdon'?t sleep\b/i, /\b(this one |it )sends\b/i, /\blast chance\b/i,
    /\bdon'?t miss\b/i, /\bnext (100|1000|10)x\b/i, /\beasy (10|100)x\b/i, /\bape (in|now)\b/i, /\bsend it\b/i,
    /\blfg+\b/i, /\bfull port\b/i, /\bngmi\b/i, /\bguaranteed\b/i, /\bcan'?t lose\b/i, /\bbefore (it )?(moons|rips|pumps)\b/i,
  ];
  let fomoHits: string[] = [];
  let fomoShownFor: string | null = null;
  const scanFomo = () => {
    if (!settings.fomoCopyWarning || !adapter?.tokenAddress()) return void (fomoHits = []);
    const text = (document.body.innerText || '').slice(0, 80_000);
    const found = new Map<string, string>();
    for (const re of FOMO) {
      const m = text.match(re);
      if (!m || m.index == null) continue;
      const snip = text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12).replace(/\s+/g, ' ').trim();
      found.set(re.source, snip.slice(0, 60));
    }
    fomoHits = [...found.values()];
    const addr = adapter.tokenAddress();
    if (fomoHits.length >= 2 && fomoShownFor !== addr) {
      fomoShownFor = addr;
      riskChip({ level: 'medium', headline: 'This page is selling you FOMO', detail: fomoHits.slice(0, 2).map((h) => `“${h}”`).join(' · ') + '. Decide on your rules, not the feed.' });
    }
  };
  setTimeout(scanFomo, 2500);
  setInterval(scanFomo, 20_000);

  // ---- Time in the charts: reality checks, session breaks, screen-time caps ----
  setInterval(async () => {
    if (!settings.enabled || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const r = (await chrome.runtime.sendMessage({ type: 'activityTick' }).catch(() => null)) as { realityCheck?: string } | null;
    if (r?.realityCheck) toast(r.realityCheck, 'warn', 15_000);
  }, 60_000);

  // ---- Lockouts take over the page the moment they start (from any tab, Telegram or a logged outcome) ----
  const closeTab = () => void chrome.runtime.sendMessage({ type: 'closeTab' }).catch(() => {});
  let showingLock = false;
  chrome.storage.onChanged.addListener(async (c, area) => {
    if (area !== 'local' || !c.lockout?.newValue || showingLock || busy) return;
    const l = c.lockout.newValue as { until: number; startedAt: number; kind?: LockoutKind };
    const prev = c.lockout.oldValue as { startedAt?: number } | undefined;
    if (l.until <= Date.now() || prev?.startedAt === l.startedAt) return;
    const st0 = await loadState();
    if (siteBlockActive(st0.lockout, st0.settings)) {
      location.replace(chrome.runtime.getURL('blocked.html'));
      return;
    }
    showingLock = true;
    const st = await loadState();
    const v = evaluate({ now: Date.now(), intent: idleIntent(), settings: st.settings, trades: st.trades, mood: currentMood(st.moods, Date.now()), lockout: st.lockout, activity: st.activity });
    await intervene(v, st.settings, l.until, { kind: l.kind, closeTab, unit: adapter?.tokenAddress() ? 'SOL' : 'USD' });
    showingLock = false;
  });
  const idleIntent = (): OrderIntent => ({ site: adapter?.id ?? '', symbol: null, side: null, market: 'spot', unit: 'USD', notional: null, leverage: null, balance: null, priceChangePct: null, priceWindowMin: null });

  // ---- Interception ----
  let allowOnce: HTMLElement | null = null;
  let busy = false;
  let warnedUnreadable = false;

  const swallow = (e: Event) => {
    if (!settings.enabled || !adapter) return;
    const control = adapter.findOrderControl(e.target);
    if (!control) return;
    if (allowOnce === control) {
      if (e.type === 'click') allowOnce = null;
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' && !busy) {
      busy = true;
      guard(control)
        .catch((err) => {
          // Fail open on our own bugs, but tell them protection didn't run.
          console.error('[TradeGuard SI]', err);
          toast('Something went wrong checking this order, so it was NOT placed. Click again to place it unguarded.', 'warn');
          allowOnce = control;
        })
        .finally(() => (busy = false));
    }
  };
  // Some UIs fire orders on pointerdown/mousedown, so swallow the whole gesture.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
    window.addEventListener(type, swallow, { capture: true });
  }
  // Enter inside an order form.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || !settings.enabled || !adapter) return;
      const form = (e.target as Element | null)?.closest?.('form');
      if (!form) return;
      const control = [...form.querySelectorAll('button, input[type="submit"]')].map((b) => adapter!.findOrderControl(b)).find(Boolean);
      if (!control) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      control.click(); // goes through `swallow` like a normal click
    },
    { capture: true },
  );

  function replay(control: HTMLElement) {
    allowOnce = control;
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    control.dispatchEvent(new PointerEvent('pointerdown', opts));
    control.dispatchEvent(new MouseEvent('mousedown', opts));
    control.dispatchEvent(new PointerEvent('pointerup', opts));
    control.dispatchEvent(new MouseEvent('mouseup', opts));
    control.click();
    allowOnce = null;
  }

  async function guard(control: HTMLElement) {
    let state = await loadState();
    const s = state.settings;

    let intent: OrderIntent;
    try {
      intent = adapter!.readIntent(control);
    } catch (err) {
      console.warn('[TradeGuard SI] could not read order', err);
      intent = { site: adapter!.id, symbol: null, side: null, market: 'spot', unit: 'USD', notional: null, leverage: null, balance: null, priceChangePct: null, priceWindowMin: null };
    }
    const chg = priceChange(s.chaseWindowMin);
    if (chg) {
      intent.priceChangePct = chg.pct;
      intent.priceWindowMin = chg.min;
    }
    const address = adapter!.tokenAddress();
    intent.tokenAddress = address;
    intent.fomoHits = fomoHits;
    const entryPrice = adapter!.readPrice();
    if (address && s.lateEntryPct > 0 && intent.side !== 'sell') {
      intent.marketData = await Promise.race([
        chrome.runtime.sendMessage({ type: 'marketData', address }).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 2500)),
      ]);
    }
    if (address && s.scamCheckEnabled && intent.side !== 'sell') {
      // Usually already cached from page load; never hold the click longer than 3s.
      const res = await Promise.race([scan(address), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
      intent.scam = res?.report ?? null;
      if (!res?.report) toast(`Scam check unavailable (${res?.error ?? 'timed out'}). Check the launch yourself before buying.`, 'warn', 8000);
    }

    // Lockouts come first: no check-ins, no questions.
    if (!isLocked(state.lockout)) {
      const mood = currentMood(state.moods, Date.now());
      const pending = s.askLastOutcome ? pendingOutcome(state.trades) : null;
      const needMood = s.requireMoodCheckIn && !mood;
      if (needMood || pending) {
        const res = await preflight({ needMood, pending });
        if (!res) return; // cancelled the order themselves
        if (res.mood) await addMood({ ts: Date.now(), ...res.mood });
        if (res.outcome && pending) await updateTrade(pending.id, { ...res.outcome, outcomeTs: Date.now() });
        state = await loadState();
      }

    }

    const now = Date.now();
    const mood = currentMood(state.moods, now);
    const verdict = evaluate({ now, intent, settings: state.settings, trades: state.trades, mood, lockout: state.lockout, activity: state.activity });

    let lockoutUntil = state.lockout?.until;
    let lockKind = state.lockout?.kind;
    if (verdict.startLockout) {
      const l = await startLockout(verdict.startLockout.minutes, verdict.startLockout.reason, verdict.startLockout.kind);
      lockoutUntil = l.until;
      lockKind = l.kind;
      verdict.level = 4;
    }

    if (intent.notional == null && !warnedUnreadable && verdict.level < 4) {
      warnedUnreadable = true;
      toast(`Couldn't read the order size on ${adapter!.name}, so the size rules are skipped here. Set your account size in TradeGuard SI options for better coverage.`);
    }

    const locked = isLocked(state.lockout) || !!verdict.startLockout;
    const go = await intervene(verdict, state.settings, lockoutUntil, {
      kind: lockKind,
      closeTab,
      unit: intent.unit,
      // Only timed lockouts can be overridden (never self-exclusion or hard blocks like a scam launch).
      allowOverride: locked && state.settings.lockoutOverride === 'typed',
    });
    await chrome.storage.local.set({
      lastIntervention: {
        ts: Date.now(),
        site: intent.site,
        order: { side: intent.side, symbol: intent.symbol, notional: intent.notional, unit: intent.unit, leverage: intent.leverage, tokenAddress: address },
        level: verdict.level,
        hits: verdict.hits.map((h) => ({ rule: h.rule, title: h.title, message: h.message, points: h.points })),
        decision: verdict.level === 0 ? 'allowed' : go ? 'proceeded' : verdict.level === 4 ? 'blocked' : 'cancelled',
      },
    });
    if (!go) {
      if (verdict.level >= 2 && verdict.level < 4) {
        await addSave({ ts: Date.now(), site: intent.site, rules: verdict.hits.map((h) => h.rule), notional: intent.notional, unit: intent.unit });
        toast('Good call. That one’s logged as a trade you didn’t need to take.', 'info', 4000);
      }
      return;
    }

    let preTradeCard: string | undefined;
    // The 3-line check: the last gate before a memecoin buy goes through. One "no" means skip.
    if (state.settings.preBuyChecklist && address && intent.unit === 'SOL' && intent.side !== 'sell') {
      const st = state.settings;
      const today = state.trades.filter((t) => t.ts >= startOfDay(Date.now()));
      const losses = today.filter((t) => t.outcome === 'loss').length;
      const buys = today.filter((t) => t.side !== 'sell').length;
      const solPnl = today.filter((t) => t.pnlUnit === 'SOL' && typeof t.pnl === 'number').reduce((a, t) => a + (t.pnl as number), 0);
      const parts = [
        st.maxLossesPerDay ? `${losses}/${st.maxLossesPerDay} losses` : null,
        st.maxBuysPerDay ? `${buys}/${st.maxBuysPerDay} buys` : null,
        st.dailyLossLimitSol ? `${solPnl.toFixed(2)} / −${st.dailyLossLimitSol} SOL` : null,
      ].filter(Boolean);
      const limitsOk = (!st.maxLossesPerDay || losses < st.maxLossesPerDay) && (!st.maxBuysPerDay || buys < st.maxBuysPerDay) && (!st.dailyLossLimitSol || solPnl > -st.dailyLossLimitSol);
      const c = await checklist({ limitsLine: parts.join(' · ') || 'No daily limits set', limitsOk, symbol: intent.symbol });
      if (c.card) preTradeCard = c.card;
      if (!c.pass) {
        await addSave({ ts: Date.now(), site: intent.site, rules: ['checklist'], notional: intent.notional, unit: intent.unit });
        toast(`Skipped (${c.failed}). That’s the rule working.`, 'info', 4000);
        return;
      }
    }

    const record: TradeRecord = {
      id: uid(),
      ts: Date.now(),
      site: intent.site,
      symbol: intent.symbol,
      token: address,
      entryPrice,
      side: intent.side,
      unit: intent.unit,
      notional: intent.notional,
      leverage: intent.leverage,
      friction: verdict.level,
      hits: verdict.hits.map((h) => h.rule),
      overrode: verdict.level >= 2,
      moodScore: mood?.score ?? null,
      moodTags: mood?.tags ?? [],
      ...(preTradeCard ? { note: preTradeCard } : {}),
    };
    await addTrade(record);
    replay(control);
    if (record.side === 'sell') trackPostExit(record.id, entryPrice);
  }
}
