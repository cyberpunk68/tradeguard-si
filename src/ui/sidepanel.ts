// Coach side panel: a streaming Claude chat with a manual tool loop.
// Transport is "bring your own key" for now; switching to a backend later means pointing
// `coachBaseUrl` at a proxy that holds the key (the client code below doesn't change).
import Anthropic from '@anthropic-ai/sdk';
import type { AutoCheckResult } from '../coach/autocheck';
import { captureChart } from '../coach/chart';
import { traderContext } from '../coach/context';
import { COACH_SYSTEM } from '../coach/prompt';
import { COACH_TOOLS, runCoachTool, type Proposal, type VerdictCard } from '../coach/tools';
import { COACH_MODELS } from '../core/defaults';
import { snapshotForPrompt, type LiveSnapshot } from '../core/live';
import { isLocked, loadState, saveSettings } from '../storage';
import { coachTransport, getAccount } from '../account';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $('log');
const input = $<HTMLTextAreaElement>('input');
const MAX_STORED = 80;
const MAX_TOOL_ROUNDS = 8;

let messages: Anthropic.MessageParam[] = [];
let busy = false;

// ---------- rendering ----------

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const scroll = () => (log.scrollTop = log.scrollHeight);

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Tiny, safe markdown: escape everything first, then allow bold, code, bullet lists and http(s) links. */
function md(src: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => list.length && (out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`), (list = []));
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*[-*•]\s+(.*)/);
    if (m) list.push(inline(m[1]));
    else {
      flush();
      if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join('');
}

const VERDICT_LABEL: Record<VerdictCard['verdict'], string> = { avoid: 'AVOID', no_trade: 'NO TRADE', wait: 'WAIT', fits_rules: 'FITS YOUR RULES' };

function verdictCard(v: VerdictCard): HTMLElement {
  const card = node('div', `verdict v-${v.verdict}`);
  const top = node('div', 'v-top');
  top.append(node('span', 'v-badge', VERDICT_LABEL[v.verdict] ?? v.verdict), node('span', 'v-head', v.headline));
  card.append(top);
  if (v.reasons?.length) {
    const ul = node('ul', 'v-reasons');
    for (const r of v.reasons) ul.append(node('li', '', r));
    card.append(ul);
  }
  const row = (k: string, val?: string) => {
    if (!val) return;
    const r = node('div', 'v-row');
    r.append(node('b', '', k), node('span', '', val));
    card.append(r);
  };
  row('Watch', v.watch);
  row('Do now', v.next);
  const foot = node('div', 'v-foot');
  const more = node('button', '', 'Details →');
  more.addEventListener('click', () => void send('Give me the full breakdown behind that verdict.'));
  foot.append(more);
  card.append(foot);
  return card;
}

function proposalCard(p: Proposal): HTMLElement {
  const card = node('div', 'proposal');
  card.append(node('h4', '', 'Suggested rule change'), node('p', '', p.reason));
  const table = node('table');
  for (const [k, v] of Object.entries(p.changes)) {
    const tr = node('tr');
    tr.append(node('td', '', k), node('td', '', `${String(p.before[k as keyof typeof p.before])} → ${String(v)}`));
    table.append(tr);
  }
  card.append(table);
  const row = node('div', 'row');
  const no = node('button', '', 'Dismiss');
  const yes = node('button', 'primary', 'Apply');
  no.addEventListener('click', () => card.remove());
  yes.addEventListener('click', async () => {
    const { settings, lockout } = await loadState();
    if (settings.commitmentMode && isLocked(lockout)) {
      row.replaceChildren(node('span', 'muted', 'Rules are frozen during a commitment-mode lockout.'));
      return;
    }
    await saveSettings(p.changes);
    row.replaceChildren(node('span', 'muted', 'Applied ✓'));
  });
  row.append(no, yes);
  card.append(row);
  return card;
}

const TOOL_LABEL: Record<string, string> = {
  get_current_page: 'Read this page', get_trading_summary: 'Checked your stats', get_recent_trades: 'Read your trade log',
  get_mood_history: 'Read your check-ins', get_rules_and_status: 'Checked your rules', get_last_intervention: 'Read the last intervention',
  check_token: 'Ran a bundle check',
};

function renderHistory() {
  log.replaceChildren();
  if (!messages.length) return renderEmpty();
  for (const m of messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        log.append(m.content.startsWith('[Auto-check') ? node('div', 'autoline', m.content.slice(1, -1)) : node('div', 'msg user', m.content));
      } else {
        const texts = m.content.filter((b): b is Anthropic.TextBlockParam => b.type === 'text' && !b.text.startsWith('<live_page>'));
        if (texts.length && !m.content.some((b) => b.type === 'tool_result')) log.append(node('div', 'msg user', texts[texts.length - 1].text));
      }
      continue;
    }
    for (const b of m.content as Anthropic.ContentBlock[]) {
      if (b.type === 'text' && b.text.trim()) {
        const d = node('div', 'msg ai');
        d.innerHTML = md(b.text);
        log.append(d);
      } else if (b.type === 'tool_use') {
        if (b.name === 'show_verdict') log.append(verdictCard(b.input as VerdictCard));
        else if (b.name === 'propose_rule_change') log.append(node('div', 'tool', 'Suggested a rule change'));
        else log.append(node('div', 'tool', TOOL_LABEL[b.name] ?? b.name));
      }
    }
  }
  scroll();
}

function renderEmpty() {
  const e = node('div', 'empty');
  e.append(node('b', '', 'Your coach is here.'), node('span', '', 'Open a token on Axiom and tap ⚡ Quick check. You get a verdict in seconds: avoid, no trade, wait, or fits your rules.'));
  log.append(e);
}

async function renderKeySetup(show: boolean) {
  log.replaceChildren();
  if (!show) return renderHistory();
  const box = node('div', 'setup card');
  const acct = await getAccount();
  const hosted = acct?.plan && acct.plan !== 'free';
  box.append(
    node('h2', '', hosted ? 'Coach connected' : 'Connect Claude'),
    node('p', '', hosted
      ? `Using your ${acct!.plan === 'ultra' ? 'Ultra' : 'Pro'} plan's hosted coach. Optionally paste your own Anthropic key to use it instead (unmetered, billed by Anthropic).`
      : 'Paste your Anthropic API key (console.anthropic.com → API keys). It stays in this browser and is only sent to Anthropic. Or link a Pro/Ultra account in TradeGuard SI settings to use the hosted coach, no key needed.'),
  );
  const field = node('input');
  field.type = 'password';
  field.placeholder = 'sk-ant-…';
  field.autocomplete = 'off';
  const row = node('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  const save = node('button', 'primary', 'Save key');
  const remove = node('button', 'danger', 'Remove key');
  save.addEventListener('click', async () => {
    const k = field.value.trim();
    if (!k) return;
    await chrome.storage.local.set({ coachApiKey: k });
    field.value = '';
    await renderKeySetup(false);
  });
  remove.addEventListener('click', async () => {
    await chrome.storage.local.remove('coachApiKey');
    field.value = '';
  });
  row.append(remove, save);
  box.append(field, row);
  log.append(box);
}

// ---------- live page connection ----------

let live: LiveSnapshot | null = null;
let liveWindow: number | undefined;
let port: chrome.runtime.Port | null = null;
let connectGen = 0;

const fmtBig = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n >= 1 ? String(Math.round(n)) : n.toPrecision(3));
const fmtMove = (label: string, v: number | null | undefined) => {
  const span = node('span', v == null ? '' : v >= 0 ? 'up' : 'dn', `${label} ${v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'}`);
  return span;
};

async function renderStrip() {
  const box = $('live');
  box.replaceChildren();
  box.className = live ? 'l-on' : '';
  const { settings } = await loadState();

  const top = node('div', 'l-top');
  top.append(node('span', 'l-dot'));
  const name = node('span', 'l-name');
  if (live) {
    name.textContent = `LIVE · ${live.site}${live.symbol ? ' · $' + live.symbol : ''} `;
    if (live.price != null) name.append(node('small', '', fmtBig(live.price)));
  } else name.textContent = 'Not live';
  const auto = node('label', 'l-auto');
  auto.title = 'Quick AI verdict whenever you open a new token';
  const sw = node('span', 'switch');
  const cb = node('input');
  cb.type = 'checkbox';
  cb.checked = settings.coachAutoCheck;
  cb.addEventListener('change', () => void saveSettings({ coachAutoCheck: cb.checked }));
  sw.append(cb, node('span'));
  auto.append('Auto ⚡', sw);
  top.append(name, auto);
  box.append(top);

  if (!live) {
    box.append(node('div', 'l-off', 'Open a token on Axiom, Photon, GMGN or BullX (or any supported exchange) and the coach follows along live.'));
    return;
  }
  const sr = live.series;
  const moves = node('div', 'l-moves');
  moves.append(fmtMove('1m', sr?.moves.m1), fmtMove('5m', sr?.moves.m5), fmtMove('15m', sr?.moves.m15));
  if (sr && sr.trend !== 'unknown') moves.append(node('span', sr.trend === 'down' ? 'dn' : sr.trend === 'up' ? 'up' : '', sr.trend === 'down' ? '↓ lower highs' : sr.trend === 'up' ? '↑ higher highs' : '↔ range'));
  if (sr && sr.fromHighPct < -5) moves.append(node('span', 'dn', `${sr.fromHighPct.toFixed(0)}% from high`));
  box.append(moves);

  if (live.preview) {
    const pre = node('div', 'l-pre');
    pre.title = 'What TradeGuard SI would do if you pressed Buy right now';
    pre.append(node('span', `l-badge lv-${live.preview.level}`, `BUY → ${live.preview.label}`));
    const top1 = live.preview.hits.find((h) => h.rule !== 'mood') ?? live.preview.hits[0];
    pre.append(node('span', 'l-why', top1 ? top1.title : 'Nothing breaks your rules at this size'));
    box.append(pre);
  }
  const tags = node('div', 'l-tags');
  const tag = (t: string, cls = '') => tags.append(node('span', `l-tag ${cls}`, t));
  const gate = live.preview?.hits.find((h) => h.rule === 'gate');
  if (live.token) tag(gate ? `Gate ✗ ${gate.points?.length ?? ''}` : 'Gate ✓', gate ? 'bad' : 'ok');
  if (live.scam?.risk) tag(`Bundle ${live.scam.risk.toUpperCase()}`, ['high', 'extreme'].includes(live.scam.risk) ? 'bad' : live.scam.risk === 'low' ? 'ok' : '');
  else if (live.scamStatus === 'pending') tag('Bundle check…');
  if (live.flow?.netUsd != null) tag(`5m net ${live.flow.netUsd >= 0 ? '+' : '−'}$${fmtBig(Math.abs(live.flow.netUsd))}`, live.flow.netUsd < 0 ? 'bad' : '');
  if (live.order?.pctOfBalance != null) tag(`Size ${live.order.pctOfBalance.toFixed(1)}% of bal`);
  if (live.locked) tag('LOCKED', 'bad');
  if (tags.childElementCount) box.append(tags);
}

/** Attach to the trading tab: the active one first, else the most recently used tab running TradeGuard SI. */
async function connectLive() {
  const gen = ++connectGen;
  port?.disconnect();
  port = null;
  const tabs = (await chrome.tabs.query({ lastFocusedWindow: true })).sort(
    (a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  );
  for (const tab of tabs.slice(0, 5)) {
    if (tab.id == null || gen !== connectGen) continue;
    const pong = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }).catch(() => null);
    if (!pong?.ok || gen !== connectGen) continue;
    port = chrome.tabs.connect(tab.id, { name: 'live' });
    liveWindow = tab.windowId;
    port.onMessage.addListener((snap: LiveSnapshot) => {
      live = snap;
      void renderStrip();
    });
    port.onDisconnect.addListener(() => {
      if (gen !== connectGen) return;
      port = null;
      live = null;
      void renderStrip();
      setTimeout(() => gen === connectGen && void connectLive(), 1500);
    });
    return;
  }
  live = null;
  void renderStrip();
  setTimeout(() => gen === connectGen && void connectLive(), 4000);
}

chrome.tabs.onActivated.addListener(() => void connectLive());
chrome.windows.onFocusChanged.addListener((w) => w !== chrome.windows.WINDOW_ID_NONE && void connectLive());

// Auto-checks run in the service worker; mirror them into the chat so follow-ups ("why?") work.
const pendingAuto: AutoCheckResult[] = [];
function addAutoCheck(r: AutoCheckResult) {
  if (busy) return void pendingAuto.push(r);
  if (!messages.length) log.replaceChildren();
  const sym = r.symbol ? `$${r.symbol}` : 'this token';
  const via = r.source === 'rules' ? ' · your rules, no AI' : r.source === 'shared' ? ' · shared read' : '';
  log.append(node('div', 'autoline', `Auto-check · ${sym}${via}${r.withChart ? ' · chart read' : ''}`), verdictCard(r.verdict));
  const v = r.verdict;
  messages.push(
    { role: 'user', content: `[Auto-check when I opened ${sym}]` },
    { role: 'assistant', content: [{ type: 'text', text: `${v.verdict.toUpperCase()}: ${v.headline}. ${v.reasons.join('; ')}.${v.watch ? ' Watch: ' + v.watch + '.' : ''} Do now: ${v.next}` }] },
  );
  void persist();
  scroll();
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.lastAutoCheck?.newValue) addAutoCheck(c.lastAutoCheck.newValue as AutoCheckResult);
  if (area === 'local' && c.settings) void renderStrip();
});

const WANTS_CHART = /quick check|breakdown|details|chart|entry|setup|level/i;

/** User turn = [chart screenshot?] + live page + trader context + their words. */
async function userTurn(text: string): Promise<Anthropic.MessageParam> {
  const { settings, trades, moods, lockout } = await loadState();
  const content: Anthropic.ContentBlockParam[] = [];
  if (live && Date.now() - live.ts < 15_000) {
    if (settings.coachChartCapture && WANTS_CHART.test(text)) {
      const img = await captureChart(liveWindow);
      if (img) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
    }
    content.push({ type: 'text', text: `<live_page>${snapshotForPrompt(live)}</live_page>\n<trader>${traderContext({ settings, trades, moods, lockout })}</trader>` });
  }
  content.push({ type: 'text', text });
  return { role: 'user', content };
}

// ---------- the loop ----------

async function client(): Promise<Anthropic | null> {
  const t = await coachTransport();
  if (!t) return null;
  // Your own key goes straight to Anthropic; on Pro/Ultra the device token goes to TradeGuard SI's proxy.
  return new Anthropic({ apiKey: t.apiKey, dangerouslyAllowBrowser: true, ...(t.baseURL ? { baseURL: t.baseURL } : {}) });
}

async function persist() {
  // Trim from the front at a clean boundary (a plain user message) so tool_use/tool_result pairs stay intact.
  while (messages.length > MAX_STORED) {
    const i = messages.findIndex((m, idx) => idx > 0 && m.role === 'user' && (typeof m.content === 'string' || !m.content.some((b) => b.type === 'tool_result')));
    if (i <= 0) break;
    messages = messages.slice(i);
  }
  // Screenshots are only useful for the turn they were taken; don't keep megabytes of base64 in storage.
  const slim = messages.map((m) =>
    Array.isArray(m.content) ? { ...m, content: m.content.map((b) => (b.type === 'image' ? { type: 'text' as const, text: '[chart screenshot]' } : b)) } : m,
  );
  await chrome.storage.local.set({ coachMessages: slim });
}

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Check it under ⚙.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your connection.';
  if (err instanceof Anthropic.APIError && (err.status === 402 || err.status === 403)) {
    const body = err.error as { error?: { message?: string } } | undefined;
    return body?.error?.message ?? 'This needs a higher plan.';
  }
  if (err instanceof Anthropic.APIError) return `Claude API error (${err.status ?? '?'}): ${err.message}`;
  return (err as Error)?.message ?? String(err);
}

async function send(text: string) {
  text = text.trim();
  if (!text || busy) return;
  const api = await client();
  if (!api) return renderKeySetup(true);
  busy = true;
  $<HTMLButtonElement>('send').disabled = true;
  if (!messages.length) log.replaceChildren();

  const checkpoint = messages.length;
  messages.push(await userTurn(text));
  log.append(node('div', 'msg user', text));
  const thinking = node('div', 'thinking', 'Thinking');
  log.append(thinking);
  scroll();

  const { settings } = await loadState();
  const preset = COACH_MODELS.find((m) => m.id === settings.coachModel) ?? COACH_MODELS[0];
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = api.messages.stream({
        model: settings.coachModel,
        max_tokens: 16000,
        system: [{ type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: COACH_TOOLS,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: preset.effort },
      });
      let bubble: HTMLDivElement | null = null;
      let acc = '';
      stream.on('text', (delta) => {
        if (!bubble) {
          bubble = node('div', 'msg ai');
          log.insertBefore(bubble, thinking);
        }
        acc += delta;
        bubble.innerHTML = md(acc);
        scroll();
      });
      const msg = await stream.finalMessage();
      messages.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason === 'refusal') {
        log.insertBefore(node('div', 'err', 'Claude declined to answer that one.'), thinking);
        break;
      }
      if (msg.stop_reason === 'pause_turn') continue;
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!uses.length) break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        const out = await runCoachTool(u.name, u.input as Record<string, unknown>).catch((e: Error) => ({ content: e.message, isError: true }) as Awaited<ReturnType<typeof runCoachTool>>);
        if (out.verdict) log.insertBefore(verdictCard(out.verdict), thinking);
        else if (out.proposal) log.insertBefore(proposalCard(out.proposal), thinking);
        else log.insertBefore(node('div', 'tool', TOOL_LABEL[u.name] ?? u.name), thinking);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
        scroll();
      }
      messages.push({ role: 'user', content: results });
    }
    await persist();
  } catch (err) {
    messages = messages.slice(0, checkpoint); // keep history valid for the next attempt
    log.insertBefore(node('div', 'err', friendlyError(err)), thinking);
  } finally {
    thinking.remove();
    busy = false;
    $<HTMLButtonElement>('send').disabled = false;
    scroll();
    for (const r of pendingAuto.splice(0)) addAutoCheck(r);
  }
}

// ---------- wiring ----------

async function init() {
  const { settings } = await loadState();
  const sel = $<HTMLSelectElement>('model');
  for (const m of COACH_MODELS) sel.append(new Option(m.label, m.id, false, m.id === settings.coachModel));
  if (!COACH_MODELS.some((m) => m.id === settings.coachModel)) sel.append(new Option(settings.coachModel, settings.coachModel, true, true));
  sel.addEventListener('change', () => void saveSettings({ coachModel: sel.value }));

  messages = ((await chrome.storage.local.get('coachMessages')) as { coachMessages?: Anthropic.MessageParam[] }).coachMessages ?? [];
  await renderKeySetup(!(await coachTransport()));
  void renderStrip();
  void connectLive();
}

let keyOpen = false;
$('keyBtn').addEventListener('click', async () => {
  keyOpen = !keyOpen;
  await renderKeySetup(keyOpen);
});
$('newChat').addEventListener('click', async () => {
  if (busy) return;
  messages = [];
  await chrome.storage.local.remove('coachMessages');
  renderHistory();
});
$('send').addEventListener('click', () => {
  const t = input.value;
  input.value = '';
  void send(t);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('send').click();
  }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(140, input.scrollHeight)}px`;
});
$('quick').addEventListener('click', (e) => {
  const q = (e.target as HTMLElement).closest('button')?.dataset.q;
  if (q) void send(q);
});

void init();
