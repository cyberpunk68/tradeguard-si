// On-page auto-check: one fast Claude call when a new token page opens, returning a verdict card.
// Runs in the service worker so it works with the side panel closed ("installed" mode).
import Anthropic from '@anthropic-ai/sdk';
import { snapshotForPrompt, type LiveSnapshot } from '../core/live';
import { coachClient, coachTransport, getAccount } from '../account';
import { acceptsImages, isClaude } from './providers';
import { rulesVerdict } from './rules-verdict';
import { loadState } from '../storage';
import { captureChart } from './chart';
import { traderContext } from './context';
import { COACH_SYSTEM } from './prompt';
import { normalizeVerdict, SHOW_VERDICT_TOOL, type VerdictCard } from './tools';

const PER_TOKEN_MS = 10 * 60_000;

export interface AutoCheckResult {
  tokenAddress: string;
  symbol: string | null;
  verdict: VerdictCard;
  ts: number;
  withChart: boolean;
  /** rules = decided locally, no AI · shared = cached token read · ai = fresh AI call */
  source: 'rules' | 'shared' | 'ai';
}

export async function autoCheck(snap: LiveSnapshot, windowId?: number): Promise<AutoCheckResult | { skipped: string }> {
  const state = await loadState();
  const { settings } = state;
  if (!settings.coachAutoCheck) return { skipped: 'auto-check off' };
  if (!snap.tokenAddress) return { skipped: 'no token on page' };
  // 1. Rules first: if TradeGuard SI's own rules already decide, answer instantly with no AI call.
  const ruled = rulesVerdict({ settings, lockout: state.lockout, scam: snap.scam, preview: snap.preview });
  if (ruled) {
    const r: AutoCheckResult = { tokenAddress: snap.tokenAddress, symbol: snap.symbol, verdict: ruled, ts: Date.now(), withChart: false, source: 'rules' };
    await chrome.storage.local.set({ lastAutoCheck: r });
    return r;
  }

  const transport = await coachTransport();
  if (!transport) return { skipped: 'no API key or hosted plan' };

  // Once per token per 10 minutes; reuse the last verdict in between.
  const key = `ac:${snap.tokenAddress}`;
  const prev = (await chrome.storage.session.get(key))[key] as AutoCheckResult | undefined;
  if (prev && Date.now() - prev.ts < PER_TOKEN_MS) return prev;

  let verdict: VerdictCard | null = null;
  let withChart = false;
  let source: AutoCheckResult['source'] = 'ai';
  if (transport.hosted) {
    // 2. Hosted: send only the token address (and the chart on Ultra). The server builds the read from
    //    data it fetches itself and shares it across users, so popular tokens cost nothing.
    const account = await getAccount();
    const image = account?.plan === 'ultra' && settings.coachChartCapture ? await captureChart(windowId) : null;
    const res = await fetch(`${account!.apiBase}/api/coach/token-check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${account!.token}` },
      body: JSON.stringify({ address: snap.tokenAddress, ...(image ? { image } : {}) }),
    });
    if (!res.ok) return { skipped: `hosted check ${res.status}` };
    const j = (await res.json()) as { verdict: VerdictCard; source: string };
    verdict = normalizeVerdict(j.verdict as unknown as Record<string, unknown>);
    withChart = !!image && j.source === 'ai-chart';
    source = j.source === 'shared-cache' ? 'shared' : 'ai';
  } else {
    // 3. Your own key: one short call to your provider's auto-check model (you pay the provider).
    const model = transport.autoModel;
    const image = settings.coachChartCapture && acceptsImages(transport.provider, model) ? await captureChart(windowId) : null;
    const client = coachClient(transport);
    const content: Anthropic.ContentBlockParam[] = [];
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
    content.push({
      type: 'text',
      text: `Auto-check: I just opened this token and may buy soon. Give me the verdict card now.${image ? ' The screenshot is my chart right now.' : ''}\n<live_page>${snapshotForPrompt(snap)}</live_page>\n<trader>${traderContext(state)}</trader>`,
    });
    const msg = await client.messages.create({
      model,
      max_tokens: 1500,
      system: isClaude(model) ? [{ type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } }] : COACH_SYSTEM,
      tools: [SHOW_VERDICT_TOOL],
      messages: [{ role: 'user', content }],
    });
    const use = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'show_verdict');
    verdict = use ? normalizeVerdict(use.input as Record<string, unknown>) : null;
    withChart = !!image;
    if (!verdict) return { skipped: msg.stop_reason === 'refusal' ? 'model declined' : 'no verdict returned' };
  }
  if (!verdict) return { skipped: 'no verdict returned' };

  const result: AutoCheckResult = { tokenAddress: snap.tokenAddress, symbol: snap.symbol, verdict, ts: Date.now(), withChart, source };
  await chrome.storage.session.set({ [key]: result });
  await chrome.storage.local.set({ lastAutoCheck: result });
  return result;
}
