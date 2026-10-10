// Tools the coach can call. All read local data or the active tab; the only write path is a
// rule-change *proposal* that the trader must approve in the UI.
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_SETTINGS } from '../core/defaults';
import { computeStats, insights } from '../core/insights';
import { applyMood, currentMood, moodAdjustment } from '../core/mood';
import { dayPnl, lossStreak, startOfDay } from '../core/rules';
import type { Settings } from '../core/types';
import { isLocked, loadState } from '../storage';

import { SHOW_VERDICT_TOOL, VERDICTS, normalizeVerdict, type VerdictCard } from './verdict';
export { SHOW_VERDICT_TOOL, VERDICTS, normalizeVerdict, type VerdictCard };

export const COACH_TOOLS: Anthropic.Tool[] = [
  SHOW_VERDICT_TOOL,
  {
    name: 'get_current_page',
    description:
      "Snapshot of the trading page in the trader's active tab: site, price and recent move, the token address, token safety stats read from the page (LP burned, dev/top-10/snipers/bundlers/insiders %, liquidity, market cap), and the Is It Bundled? launch report (bundled %, risk, dev history, report link). Use for any question about the token or trade in front of them.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_trading_summary',
    description:
      'Stats over a period: trade count, win rate, logged P&L, win rate when overriding a warning vs clean trades, results by mood bucket and mood tag, how often each rule fired, trades skipped after a warning, plus plain-language patterns. Use for reviews ("how am I doing", "review my week").',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 365, description: 'Look-back window in days. Default 7.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_recent_trades',
    description: 'Most recent trades, newest first: time, site, side, symbol, size, leverage, warnings shown, whether they overrode, mood at the time, outcome and P&L.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_mood_history',
    description: 'Mood check-ins (1-5 score plus tags like fomo, angry, tired) over a period, newest first.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 90, description: 'Default 7.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_rules_and_status',
    description: "The trader's configured rules, the limits currently in force after mood adjustment, today's counts (trades, P&L, loss streak) and any active lockout.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_last_intervention',
    description: 'The most recent time TradeGuard SI stepped in on an order: what the order was, which rules fired with their messages, and whether the trader cancelled, proceeded or was blocked.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'check_token',
    description: 'Look up any Solana token mint or pool address on Is It Bundled?: bundled supply at launch, insiders still holding, dev launch history, bundling tools used, risk rating and report link.',
    input_schema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Solana token mint or pool address.' } },
      required: ['address'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_rule_change',
    description:
      'Propose changes to TradeGuard SI settings. The trader sees the before/after and must press Apply. Keys must be existing setting names (e.g. maxPositionPct, maxLeverage, maxTradesPerHour, maxTradesPerDay, revengeWindowMin, chaseThresholdPct, dailyLossLimitUsd, tiltStreak, lockoutMinutes, countdownSeconds, gateTop10MaxPct, gateInsidersMaxPct, gateMinLiquidityX, gateLpBurnedMinPct, gateDevMaxPct, scamMaxBundledPct, scamMaxFlaggedHoldPct, commitmentMode). Values must match the setting type.',
    input_schema: {
      type: 'object',
      properties: {
        changes: { type: 'object', description: 'Map of setting name to new value.', additionalProperties: { type: ['number', 'boolean'] } },
        reason: { type: 'string', description: 'One sentence, grounded in their data.' },
      },
      required: ['changes', 'reason'],
      additionalProperties: false,
    },
  },
];

export interface Proposal {
  changes: Partial<Settings>;
  before: Partial<Settings>;
  reason: string;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  proposal?: Proposal;
  verdict?: VerdictCard;
}

const NOT_PROPOSABLE = new Set(['coachAutoCheck', 'coachChartCapture', 'enabled', 'customSites', 'disabledAdapters', 'coachBaseUrl', 'coachModel', 'coachProvider', 'coachProviderModels', 'scamApiBase', 'confirmPhrase']);
const DAY = 86_400_000;
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 100) / 100 : x));
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');

export async function runCoachTool(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const state = await loadState();
  const now = Date.now();
  switch (name) {
    case 'show_verdict': {
      const card = normalizeVerdict(input);
      if (!card) return { content: `verdict must be one of ${VERDICTS.join(', ')}`, isError: true };
      return { content: 'Card shown. Do not repeat it in text; add at most one short line, or nothing.', verdict: card };
    }
    case 'get_current_page': {
      // The active tab first, then the most recently used tabs in that window (covers the panel opened as a tab).
      const tabs = (await chrome.tabs.query({ lastFocusedWindow: true })).sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      for (const tab of tabs.slice(0, 4)) {
        if (tab.id == null) continue;
        try {
          const snap = await chrome.tabs.sendMessage(tab.id, { type: 'snapshot' });
          if (snap) return { content: json(snap) };
        } catch {
          // no TradeGuard SI content script in this tab
        }
      }
      return { content: 'No supported trading page is open in this window (TradeGuard SI is not running on the active tab).', isError: true };
    }
    case 'get_trading_summary': {
      const days = Number(input.days ?? 7);
      const trades = state.trades.filter((t) => t.ts >= now - days * DAY);
      const saves = state.saves.filter((s) => s.ts >= now - days * DAY);
      return { content: json({ days, ...computeStats(trades), tradesSkippedAfterWarning: saves.length, patterns: insights(trades).map((i) => i.text) }) };
    }
    case 'get_recent_trades': {
      const limit = Number(input.limit ?? 20);
      return {
        content: json(
          [...state.trades].reverse().slice(0, limit).map((t) => ({
            time: iso(t.ts), site: t.site, side: t.side, symbol: t.symbol, size: t.notional, unit: t.unit, leverage: t.leverage,
            warnings: t.hits, overrode: t.overrode, mood: t.moodScore, moodTags: t.moodTags, outcome: t.outcome ?? 'not logged', pnlUsd: t.pnl ?? null,
          })),
        ),
      };
    }
    case 'get_mood_history': {
      const days = Number(input.days ?? 7);
      return { content: json(state.moods.filter((m) => m.ts >= now - days * DAY).reverse().map((m) => ({ time: iso(m.ts), score: m.score, tags: m.tags }))) };
    }
    case 'get_rules_and_status': {
      const mood = currentMood(state.moods, now);
      const adj = moodAdjustment(mood);
      const { coachBaseUrl, scamApiBase, customSites, disabledAdapters, ...rules } = state.settings;
      void coachBaseUrl; void scamApiBase; void customSites; void disabledAdapters;
      return {
        content: json({
          rules,
          inForceAfterMood: applyMood(state.settings, adj),
          moodNote: adj.note,
          currentMood: mood ? { score: mood.score, tags: mood.tags, minutesAgo: Math.round((now - mood.ts) / 60000) } : null,
          today: { trades: state.trades.filter((t) => t.ts >= startOfDay(now)).length, loggedPnlUsd: dayPnl(state.trades, now), lossStreak: lossStreak(state.trades) },
          lockout: isLocked(state.lockout, now) ? { reason: state.lockout.reason, until: iso(state.lockout.until), minutesLeft: Math.ceil((state.lockout.until - now) / 60000) } : null,
        }),
      };
    }
    case 'get_last_intervention': {
      const { lastIntervention } = await chrome.storage.local.get('lastIntervention');
      return { content: lastIntervention ? json(lastIntervention) : 'TradeGuard SI has not stepped in on any order yet.' };
    }
    case 'check_token': {
      const res = (await chrome.runtime.sendMessage({ type: 'scan', address: String(input.address ?? '') })) as { ok: boolean; report?: unknown; error?: string };
      return res?.ok ? { content: json(res.report) } : { content: res?.error ?? 'Lookup failed.', isError: true };
    }
    case 'propose_rule_change': {
      const changes = (input.changes ?? {}) as Record<string, unknown>;
      if (state.settings.commitmentMode && isLocked(state.lockout, now)) {
        return { content: 'Rules are frozen: commitment mode is on and a lockout is active. No changes can be proposed until it ends.', isError: true };
      }
      const clean: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      const problems: string[] = [];
      for (const [k, v] of Object.entries(changes)) {
        const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k];
        if (def === undefined || NOT_PROPOSABLE.has(k)) problems.push(`${k}: not a changeable setting`);
        else if (typeof v !== typeof def) problems.push(`${k}: expected a ${typeof def}`);
        else if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) problems.push(`${k}: must be a non-negative number`);
        else if (k === 'commitmentMode' && v === false) problems.push('commitmentMode: the coach can turn commitment mode on, never off');
        else if (k === 'gateSeverity' && ![2, 3, 4].includes(v as number)) problems.push('gateSeverity: must be 2, 3 or 4');
        else {
          clean[k] = v;
          before[k] = (state.settings as unknown as Record<string, unknown>)[k];
        }
      }
      if (!Object.keys(clean).length) return { content: `Nothing to propose. ${problems.join('; ')}`, isError: true };
      return {
        content: `Shown to the trader as a card with an Apply button; nothing has changed yet.${problems.length ? ' Skipped: ' + problems.join('; ') : ''}`,
        proposal: { changes: clean as Partial<Settings>, before: before as Partial<Settings>, reason: String(input.reason ?? '') },
      };
    }
    default:
      return { content: `Unknown tool ${name}`, isError: true };
  }
}
