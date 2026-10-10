import { computeStats, insights } from '../core/insights';
import { fmtAmount } from '../core/rules';
import type { MoodEntry, Outcome, RuleId, TradeRecord } from '../core/types';
import { loadState, updateTrade, type SaveRecord } from '../storage';

const $ = (id: string) => document.getElementById(id)!;
const NS = 'http://www.w3.org/2000/svg';
const C = { mood: '#7aa7ff', win: '#4fd1a5', loss: '#ff6159', be: '#8b93a5', grid: '#242a35', axis: '#8b93a5', bar: '#7aa7ff', surface: '#12151b' };
const RULE_LABEL: Record<RuleId, string> = {
  oversize: 'Oversized', leverage: 'Leverage', overtrading: 'Overtrading', revenge: 'Revenge', chasing: 'Chasing',
  dailyLoss: 'Daily loss', tilt: 'Tilt', lockout: 'Locked out', mood: 'Mood', gate: 'Entry gate', scam: 'Scam check',
  stopWin: 'Goal hit', weeklyLoss: 'Weekly loss', monthlyLoss: 'Monthly loss', stopOuts: 'Losses/day', quietHours: 'Late night',
  screenTime: 'Screen time', sessionBreak: 'Break', realityCheck: 'Reality check', rapidFire: 'Rapid-fire', escalation: 'Doubling up',
  heater: 'Heater', afterWin: 'After big win', bankroll: 'Bankroll cap', bigSize: 'Big size', sameTokenRebuy: 'Same-token rebuy', fomoCopy: 'FOMO copy', checklist: 'Pre-buy check', dailyLossSol: 'SOL loss cap', maxBuys: 'Buys/day', openPositions: 'Open positions', aSetupLimit: 'A-setup limit', reentry: 'Re-entry', tokenEntries: 'Entries/token', riskBudget: 'Risk budget', lateEntry: 'Late entry',
};

let days = 30;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function td(text: string, cls = ''): HTMLTableCellElement {
  const c = document.createElement('td');
  c.textContent = text;
  if (cls) c.className = cls;
  return c;
}

function money(n: number) {
  return (n < 0 ? '−' : n > 0 ? '+' : '') + fmtAmount(Math.abs(n), 'USD');
}
const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)}%`);

function tiles(trades: TradeRecord[], saves: SaveRecord[]) {
  const s = computeStats(trades);
  const data: [string, string, string][] = [
    ['Trades', String(s.total), `${s.graded} with outcome logged`],
    ['Win rate', pct(s.winRate), s.graded ? `${s.graded} graded` : 'log outcomes to see this'],
    ['Logged P&L', money(s.pnl), 'from outcomes you entered'],
    ['Trades skipped', String(saves.length), 'backed out after a warning'],
    ['After overriding', pct(s.overrideWinRate), `vs ${pct(s.cleanWinRate)} on clean trades`],
  ];
  const box = $('tiles');
  box.replaceChildren();
  for (const [k, v, d] of data) {
    const t = document.createElement('div');
    t.className = 'card tile';
    const e = document.createElement('div');
    e.className = 'eyebrow';
    e.textContent = k;
    const vv = document.createElement('div');
    vv.className = 'v';
    vv.textContent = v;
    if (k === 'Logged P&L') vv.style.color = s.pnl < 0 ? 'var(--red)' : s.pnl > 0 ? 'var(--teal)' : '';
    const dd = document.createElement('div');
    dd.className = 'd';
    dd.textContent = d;
    t.append(e, vv, dd);
    box.append(t);
  }
}

function tipFor(host: HTMLElement) {
  let tip = host.querySelector<HTMLDivElement>('.tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    host.append(tip);
  }
  return {
    show(x: number, y: number, lines: string[]) {
      tip!.replaceChildren(...lines.map((l, i) => {
        const d = document.createElement(i === 0 ? 'b' : 'div');
        d.textContent = l;
        return d;
      }));
      const r = host.getBoundingClientRect();
      const sv = host.querySelector('svg')!.getBoundingClientRect();
      const scale = sv.width / Number(host.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
      tip!.style.left = `${x * scale + (sv.left - r.left)}px`;
      tip!.style.top = `${y * scale + (sv.top - r.top)}px`;
      tip!.style.opacity = '1';
    },
    hide() {
      tip!.style.opacity = '0';
    },
  };
}

function moodChart(trades: TradeRecord[], moods: MoodEntry[], from: number, to: number) {
  const host = $('moodChart');
  host.replaceChildren();
  if (!trades.length && !moods.length) {
    host.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No check-ins or trades in this range yet.' }));
    return;
  }
  const W = 680, H = 240, L = 34, R = 10, T = 10, B = 26;
  const x = (ts: number) => L + ((ts - from) / Math.max(1, to - from)) * (W - L - R);
  const y = (score: number) => T + ((5 - score) / 4) * (H - T - B);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Mood check-ins and trade outcomes over time' });

  for (let v = 1; v <= 5; v++) {
    s.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: C.grid, 'stroke-width': 1 }));
    const t = svg('text', { x: L - 10, y: y(v) + 4, 'text-anchor': 'end', fill: C.axis, 'font-size': 11, 'font-family': 'ui-monospace, Menlo, monospace' });
    t.textContent = String(v);
    s.append(t);
  }
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const ts = from + ((to - from) * i) / ticks;
    const t = svg('text', { x: x(ts), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle', fill: C.axis, 'font-size': 11 });
    t.textContent = new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
    s.append(t);
  }

  const ms = [...moods].sort((a, b) => a.ts - b.ts);
  if (ms.length > 1) {
    s.append(svg('path', { d: ms.map((m, i) => `${i ? 'L' : 'M'}${x(m.ts).toFixed(1)},${y(m.score).toFixed(1)}`).join(''), fill: 'none', stroke: C.mood, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.85 }));
  }
  for (const m of ms) s.append(svg('circle', { cx: x(m.ts), cy: y(m.score), r: 2.5, fill: C.mood }));

  const tip = tipFor(host);
  for (const t of trades) {
    if (t.moodScore == null) continue;
    const cx = x(t.ts);
    const cy = y(t.moodScore) + ((t.ts % 7) - 3) * 1.5; // slight jitter so same-mood trades don't stack
    const g = svg('g', { cursor: 'default' });
    let mark: SVGElement;
    if (t.outcome === 'win') mark = svg('path', { d: `M${cx},${cy - 6} L${cx + 6},${cy + 5} L${cx - 6},${cy + 5} Z`, fill: C.win, stroke: C.surface, 'stroke-width': 2 });
    else if (t.outcome === 'loss') mark = svg('path', { d: `M${cx},${cy + 6} L${cx + 6},${cy - 5} L${cx - 6},${cy - 5} Z`, fill: C.loss, stroke: C.surface, 'stroke-width': 2 });
    else if (t.outcome === 'breakeven') mark = svg('circle', { cx, cy, r: 5, fill: C.be, stroke: C.surface, 'stroke-width': 2 });
    else mark = svg('circle', { cx, cy, r: 4.5, fill: C.surface, stroke: C.be, 'stroke-width': 1.5 });
    const hit = svg('circle', { cx, cy, r: 12, fill: 'transparent' });
    g.append(mark, hit);
    g.addEventListener('mouseenter', () =>
      tip.show(cx, cy, [
        `${t.side?.toUpperCase() ?? 'Trade'} ${t.symbol ?? ''} · ${t.outcome ?? 'not logged'}`,
        `${new Date(t.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · mood ${t.moodScore}/5${t.moodTags.length ? ' (' + t.moodTags.join(', ') + ')' : ''}`,
        ...(t.pnl != null ? [`P&L ${money(t.pnl)}`] : []),
        ...(t.hits.length ? [`Warnings: ${t.hits.map((h) => RULE_LABEL[h]).join(', ')}`] : []),
      ]),
    );
    g.addEventListener('mouseleave', () => tip.hide());
    s.append(g);
  }
  host.prepend(s);
}

function ruleChart(trades: TradeRecord[], saves: SaveRecord[]) {
  const host = $('ruleChart');
  host.replaceChildren();
  const counts = new Map<RuleId, number>();
  for (const t of trades) for (const r of t.hits) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const sv of saves) for (const r of sv.rules) counts.set(r, (counts.get(r) ?? 0) + 1);
  const rows = [...counts.entries()].filter(([r]) => r !== 'lockout').sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    host.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No warnings yet. Clean trading.' }));
    return;
  }
  const W = 320, rowH = 30, L = 92, R = 36;
  const H = rows.length * rowH;
  const max = Math.max(...rows.map((r) => r[1]));
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Count of each rule triggered' });
  const tip = tipFor(host);
  rows.forEach(([rule, n], i) => {
    const yy = i * rowH + 7;
    const w = Math.max(4, ((W - L - R) * n) / max);
    const label = svg('text', { x: L - 10, y: yy + 12, 'text-anchor': 'end', fill: '#c5cad6', 'font-size': 12 });
    label.textContent = RULE_LABEL[rule];
    const bar = svg('rect', { x: L, y: yy, width: w, height: 16, rx: 4, fill: C.bar });
    const val = svg('text', { x: L + w + 6, y: yy + 12, fill: '#eceef3', 'font-size': 12, 'font-family': 'ui-monospace, Menlo, monospace' });
    val.textContent = String(n);
    const hit = svg('rect', { x: 0, y: yy - 6, width: W, height: rowH, fill: 'transparent' });
    hit.addEventListener('mouseenter', () => tip.show(L + w / 2, yy, [`${RULE_LABEL[rule]}: ${n}`, `${saves.filter((sv) => sv.rules.includes(rule)).length} times you backed out`]));
    hit.addEventListener('mouseleave', () => tip.hide());
    s.append(bar, label, val, hit);
  });
  host.prepend(s);
}

function byMoodTable(trades: TradeRecord[]) {
  const s = computeStats(trades);
  const table = $('byMood');
  table.replaceChildren();
  const head = document.createElement('tr');
  for (const [h, num] of [['Mood', false], ['Trades', true], ['Win rate', true], ['P&L', true]] as const) {
    const th = document.createElement('th');
    th.textContent = h;
    if (num) th.className = 'num';
    head.append(th);
  }
  table.append(head);
  for (const b of s.byMood) {
    const tr = document.createElement('tr');
    tr.append(td(b.label), td(String(b.n), 'num mono'), td(pct(b.winRate), 'num mono'), td(money(b.pnl), 'num mono'));
    table.append(tr);
  }
}

function logTable(trades: TradeRecord[]) {
  const table = $('log');
  table.replaceChildren();
  if (!trades.length) {
    const tr = document.createElement('tr');
    tr.append(Object.assign(td('No trades recorded in this range.'), { colSpan: 7, className: 'empty' }));
    table.append(tr);
    return;
  }
  const head = document.createElement('tr');
  for (const h of ['When', 'Site', 'Order', 'Mood', 'Warnings', 'Outcome', 'P&L $']) {
    const th = document.createElement('th');
    th.textContent = h;
    head.append(th);
  }
  table.append(head);
  for (const t of [...trades].reverse().slice(0, 200)) {
    const tr = document.createElement('tr');
    const order = [t.side?.toUpperCase(), t.symbol, t.notional ? fmtAmount(t.notional, t.unit) : null, t.leverage ? `${t.leverage}x` : null].filter(Boolean).join(' ');
    const rules = document.createElement('td');
    rules.className = 'rules';
    for (const r of t.hits) rules.append(Object.assign(document.createElement('span'), { textContent: RULE_LABEL[r] }));
    if (t.overrode) rules.append(Object.assign(document.createElement('span'), { textContent: 'overrode', style: 'color:var(--amber);border-color:rgba(243,183,79,.4)' }));

    const sel = document.createElement('select');
    for (const [v, l] of [['', '—'], ['win', 'Win'], ['breakeven', 'Break-even'], ['loss', 'Loss']]) sel.append(new Option(l, v, false, (t.outcome ?? '') === v));
    sel.addEventListener('change', () => updateTrade(t.id, sel.value ? { outcome: sel.value as Outcome, outcomeTs: t.outcomeTs ?? Date.now() } : { outcome: undefined, outcomeTs: undefined }));
    const pnl = document.createElement('input');
    pnl.type = 'number';
    pnl.value = t.pnl != null ? String(t.pnl) : '';
    pnl.addEventListener('change', () => updateTrade(t.id, { pnl: pnl.value === '' ? undefined : Number(pnl.value) }));
    const c1 = document.createElement('td');
    c1.append(sel);
    const c2 = document.createElement('td');
    c2.append(pnl);

    tr.append(
      td(new Date(t.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), 'mono'),
      td(t.site),
      td(order || '–'),
      td(t.moodScore != null ? `${t.moodScore}/5 ${t.moodTags.join(', ')}` : '–'),
      rules,
      c1,
      c2,
    );
    table.append(tr);
  }
}

async function render() {
  const state = await loadState();
  const to = Date.now();
  const from = days ? to - days * 86_400_000 : Math.min(to - 86_400_000, ...state.trades.map((t) => t.ts), ...state.moods.map((m) => m.ts));
  const trades = state.trades.filter((t) => t.ts >= from);
  const moods = state.moods.filter((m) => m.ts >= from);
  const saves = state.saves.filter((s) => s.ts >= from);

  tiles(trades, saves);
  moodChart(trades, moods, from, to);
  ruleChart(trades, saves);
  byMoodTable(trades);
  logTable(trades);

  const list = $('insights');
  list.replaceChildren();
  for (const i of insights(trades)) list.append(Object.assign(document.createElement('li'), { className: i.tone, textContent: i.text }));
}

$('range').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  days = Number(b.dataset.d);
  $('range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  void render();
});

void render();
