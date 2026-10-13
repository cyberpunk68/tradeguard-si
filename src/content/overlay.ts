// Full-page intervention UI, rendered in a shadow root so exchange CSS can't touch it
// and exchange hotkeys can't fire through it.
import { MOOD_TAGS, type FrictionLevel, type MoodEntry, type MoodTag, type Outcome, type RuleHit, type Settings, type TradeRecord, type Verdict } from '../core/types';
import { fmtAmount } from '../core/rules';
import { isChaseLanguage } from '../core/chase-language';
import { logDistress } from '../storage';
import type { LockoutKind } from '../core/types';
import type { VerdictCard } from '../coach/tools';
import { CSS } from './overlay-css';

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

function mount(): ShadowRoot {
  if (root && host?.isConnected) return root;
  host = document.createElement('tradeguard-overlay');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  root.append(style);
  // Keep keystrokes inside the overlay from reaching the exchange's hotkey handlers.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) host.addEventListener(type, (e) => e.stopPropagation());
  document.documentElement.append(host);
  return root;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function openModal(tone: 'warn' | 'danger' | 'calm'): { scrim: HTMLElement; card: HTMLElement; close: () => void } {
  const r = mount();
  const scrim = el('div', `scrim tone-${tone}`);
  const card = el('div', 'card');
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  scrim.append(card);
  r.append(scrim);
  requestAnimationFrame(() => scrim.classList.add('in'));
  return { scrim, card, close: () => scrim.remove() };
}

const LEVEL_LABEL: Record<FrictionLevel, string> = { 0: '', 1: 'Heads up', 2: 'Pause', 3: 'Hard stop', 4: 'Locked' };

function header(card: HTMLElement, level: FrictionLevel, title: string) {
  const top = el('div', 'eyebrow');
  top.append(el('span', 'brand', 'TradeGuard SI'), el('span', 'dot', '·'), el('span', `lvl lvl-${level}`, `${LEVEL_LABEL[level]} · level ${level}/4`));
  card.append(top, el('h2', 'title', title));
}

function hitList(hits: RuleHit[]): HTMLElement {
  const ul = el('ul', 'hits');
  for (const h of [...hits].sort((a, b) => b.severity - a.severity)) {
    const li = el('li', `hit sev-${h.severity}`);
    li.append(el('div', 'hit-title', h.title), el('p', 'hit-msg', h.message));
    if (h.points?.length) {
      const pts = el('ul', 'hit-points');
      for (const p of h.points) pts.append(el('li', '', p));
      li.append(pts);
    }
    if (h.link) li.append(extLink(h.link.href, h.link.label));
    ul.append(li);
  }
  return ul;
}

function extLink(href: string, label: string): HTMLAnchorElement {
  const a = el('a', 'hit-link', label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// ---------- Risk chip: shown as soon as a risky token page opens, before any click ----------

let chip: HTMLElement | null = null;
let coach: HTMLElement | null = null;

/** Bottom-left stack for the risk chip and the coach's auto-check card. */
function dock(): HTMLElement {
  const r = mount();
  let d = r.querySelector<HTMLElement>('.dock');
  if (!d) {
    d = el('div', 'dock');
    r.append(d);
  }
  return d;
}

const VERDICT_LABEL: Record<VerdictCard['verdict'], string> = { avoid: 'AVOID', no_trade: 'NO TRADE', wait: 'WAIT', fits_rules: 'FITS YOUR RULES' };

/** The coach's quick verdict on the token you just opened, readable at a glance. */
export function coachChip(opts: { verdict: VerdictCard; symbol: string | null; withChart: boolean; source?: 'rules' | 'shared' | 'ai' } | null) {
  coach?.remove();
  coach = null;
  if (!opts) return;
  const v = opts.verdict;
  coach = el('div', `chip-coach cv-${v.verdict}`);
  coach.setAttribute('role', 'status');
  const top = el('div', 'cc-top');
  top.append(el('span', 'cc-badge', VERDICT_LABEL[v.verdict]), el('span', 'cc-head', v.headline));
  const x = el('button', 'toast-x', '×');
  x.setAttribute('aria-label', 'Dismiss');
  x.addEventListener('click', () => coachChip(null));
  top.append(x);
  coach.append(top);
  if (v.reasons.length) {
    const ul = el('ul', 'cc-reasons');
    for (const r of v.reasons.slice(0, 3)) ul.append(el('li', '', r));
    coach.append(ul);
  }
  for (const [k, val] of [['Watch', v.watch], ['Do now', v.next]] as const) {
    if (!val) continue;
    const row = el('div', 'cc-row');
    row.append(el('b', '', k), el('span', '', val));
    coach.append(row);
  }
  const via = opts.source === 'rules' ? 'decided by your rules (no AI)' : opts.source === 'shared' ? 'shared token read' : 'TradeGuard SI coach';
  coach.append(el('div', 'cc-foot', `${via}${opts.symbol ? ' · $' + opts.symbol : ''}${opts.withChart ? ' · read your chart' : ''} · not financial advice`));
  dock().prepend(coach);
  requestAnimationFrame(() => coach?.classList.add('in'));
}

export function riskChip(opts: { level: 'medium' | 'high' | 'extreme'; headline: string; detail: string; href?: string } | null) {
  chip?.remove();
  chip = null;
  if (!opts) return;
  chip = el('div', `chip-risk risk-${opts.level}`);
  chip.setAttribute('role', 'status');
  const body = el('div', 'chip-body');
  body.append(el('div', 'chip-h', opts.headline), el('div', 'chip-d', opts.detail));
  if (opts.href) body.append(extLink(opts.href, 'Report ↗'));
  const x = el('button', 'toast-x', '×');
  x.setAttribute('aria-label', 'Dismiss');
  x.addEventListener('click', () => riskChip(null));
  chip.append(el('span', 'brand', 'TradeGuard SI'), body, x);
  dock().append(chip);
  requestAnimationFrame(() => chip?.classList.add('in'));
}

// ---------- Level 1: non-blocking banner ----------

export function toast(text: string, tone: 'warn' | 'info' = 'info', ms = 6000) {
  const r = mount();
  const t = el('div', `toast toast-${tone}`);
  t.append(el('span', 'brand', 'TradeGuard SI'), el('span', 'toast-text', text));
  const x = el('button', 'toast-x', '×');
  x.setAttribute('aria-label', 'Dismiss');
  x.addEventListener('click', () => t.remove());
  t.append(x);
  r.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => t.remove(), ms);
}

// ---------- Pre-flight: mood check-in + last trade outcome ----------

export interface PreflightResult {
  mood: Omit<MoodEntry, 'ts'> | null;
  outcome: { outcome: Outcome; pnl?: number; pnlUnit?: 'USD' | 'SOL' } | null;
}

export function preflight(opts: { needMood: boolean; pending: TradeRecord | null }): Promise<PreflightResult | null> {
  return new Promise((resolve) => {
    const { card, close } = openModal('calm');
    header(card, 0, opts.needMood ? 'Before you trade: how are you, really?' : 'First, close the loop on your last trade');
    card.querySelector('.lvl')!.textContent = 'Check-in';

    let score: number | null = null;
    const tags = new Set<MoodTag>();
    let outcome: Outcome | null = null;
    let stillOpen = false;

    if (opts.needMood) {
      card.append(el('p', 'lede', 'Thirty seconds of honesty here is the cheapest risk management there is.'));
      const scale = el('div', 'scale');
      const faces = ['Awful', 'Rough', 'Okay', 'Good', 'Sharp'];
      faces.forEach((label, i) => {
        const b = el('button', 'scale-btn');
        b.append(el('span', 'scale-n', String(i + 1)), el('span', 'scale-l', label));
        b.addEventListener('click', () => {
          score = i + 1;
          scale.querySelectorAll('.scale-btn').forEach((x) => x.classList.toggle('on', x === b));
          sync();
        });
        scale.append(b);
      });
      card.append(scale);
      const chips = el('div', 'chips');
      for (const tag of MOOD_TAGS) {
        const c = el('button', 'chip', tag);
        c.addEventListener('click', () => {
          tags.has(tag) ? tags.delete(tag) : tags.add(tag);
          c.classList.toggle('on', tags.has(tag));
        });
        chips.append(c);
      }
      card.append(chips);
    }

    let pnlInput: HTMLInputElement | null = null;
    if (opts.pending) {
      const p = opts.pending;
      const desc = [p.side?.toUpperCase(), p.symbol, p.notional ? fmtAmount(p.notional, p.unit) : null].filter(Boolean).join(' ');
      const box = el('div', 'pending');
      box.append(el('div', 'pending-q', `How did your last trade go?`), el('div', 'pending-d', `${desc || 'Trade'} · ${new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${p.site}`));
      const row = el('div', 'seg');
      (['win', 'breakeven', 'loss', 'still open'] as const).forEach((o) => {
        const b = el('button', `seg-btn seg-${o.replace(' ', '-')}`, o === 'breakeven' ? 'Break-even' : o[0].toUpperCase() + o.slice(1));
        b.addEventListener('click', () => {
          outcome = o === 'still open' ? null : o;
          row.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
          stillOpen = o === 'still open';
          sync();
        });
        row.append(b);
      });
      pnlInput = el('input', 'input');
      pnlInput.type = 'number';
      pnlInput.placeholder = p.unit === 'SOL' ? 'P&L in SOL (optional, e.g. -0.25)' : 'P&L in $ (optional, e.g. -120)';
      pnlInput.step = 'any';
      box.append(row, pnlInput);
      card.append(box);
    }

    const actions = el('div', 'actions');
    const cancel = el('button', 'btn ghost', 'Cancel order');
    const go = el('button', 'btn primary', 'Continue');
    actions.append(cancel, go);
    card.append(actions);

    function sync() {
      const moodOk = !opts.needMood || score != null;
      const outOk = !opts.pending || outcome != null || stillOpen;
      go.disabled = !(moodOk && outOk);
    }
    sync();

    cancel.addEventListener('click', () => (close(), resolve(null)));
    go.addEventListener('click', () => {
      const pnl = pnlInput && pnlInput.value !== '' ? Number(pnlInput.value) : undefined;
      close();
      resolve({
        mood: opts.needMood && score != null ? { score, tags: [...tags] } : null,
        outcome: outcome ? { outcome, ...(Number.isFinite(pnl) ? { pnl, pnlUnit: opts.pending?.unit ?? 'USD' } : {}) } : null,
      });
    });
    go.focus();
  });
}

// ---------- Levels 2–4 ----------

/** Resolves true if the trader chose to proceed. Level 1 shows a banner and resolves true. */
export interface LockoutExtras {
  kind?: LockoutKind;
  /** Typed override allowed (one trade, effortful). */
  allowOverride?: boolean;
  closeTab?: () => void;
  /** Stop-win: help book profits (non-custodial: links and details only). */
  unit?: 'USD' | 'SOL';
}

const OVERRIDE_PHRASE = 'I am choosing to trade after my own limit and I accept this loss';

export function intervene(v: Verdict, s: Settings, lockoutUntil?: number, extra: LockoutExtras = {}): Promise<boolean> {
  if (v.level <= 1) {
    if (v.level === 1) toast(v.hits.map((h) => h.message).join(' '), 'warn', 9000);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const { card, close } = openModal(v.level === 4 ? 'danger' : 'warn');
    let timer: ReturnType<typeof setInterval> | undefined;
    const done = (go: boolean) => {
      clearInterval(timer);
      close();
      resolve(go);
    };

    const timedLock = v.level === 4 && lockoutUntil != null && lockoutUntil > Date.now();
    if (v.level === 4 && !timedLock) {
      // A single blocked buy (scam / gate), not a lockout: no timer, nothing to override.
      header(card, 4, 'Trade blocked');
      card.querySelector('.lvl')!.textContent = 'Blocked · no override';
      card.append(hitList(v.hits));
      card.append(el('p', 'mentor', 'Not every coin is a trade. Skipping this one costs you nothing. Buying into a rigged launch can cost you everything you put in.'));
      const actions = el('div', 'actions');
      if (extra.closeTab) {
        const close = el('button', 'btn ghost', 'Close this tab');
        close.addEventListener('click', () => (done(false), extra.closeTab!()));
        actions.append(close);
      }
      const ok = el('button', 'btn primary', 'Good. Skip it');
      ok.addEventListener('click', () => done(false));
      actions.append(ok);
      card.append(actions);
      ok.focus();
      return;
    }

    if (v.level === 4) {
      const win = extra.kind === 'win';
      header(card, 4, win ? 'Goal hit' : 'Trading paused');
      if (win) {
        card.closest('.scrim')?.classList.replace('tone-danger', 'tone-win');
        const lvl = card.querySelector('.lvl')!;
        lvl.textContent = 'You won today';
        lvl.className = 'lvl lvl-0';
      }
      const hits = hitList(v.hits.filter((h) => h.severity === 4));
      if (win) hits.classList.add('hits-win');
      card.append(hits);
      const clock = el('div', `clock ${win ? 'clock-win' : ''}`);
      card.append(clock);
      const tick = () => {
        const left = Math.max(0, (lockoutUntil ?? Date.now()) - Date.now());
        const d = Math.floor(left / 86_400_000);
        const h = Math.floor((left % 86_400_000) / 3600_000);
        const m = Math.floor((left % 3600_000) / 60_000);
        const sec = Math.floor((left % 60_000) / 1000);
        clock.textContent = d ? `${d}d ${h}h ${m}m` : `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      };
      tick();
      timer = setInterval(tick, 1000);
      card.append(
        el('p', 'mentor', win
          ? 'You did the hard part. Book it, close the tab, and go enjoy your day. The next good setup will still be there tomorrow.'
          : 'Close the chart. Walk, drink water, write down what happened. You set this lock when you were thinking clearly. Trust that version of you.'),
      );
      if (win) card.append(bookProfits(s, extra.unit ?? 'USD'));
      if (!win && s.noteToSelf.trim()) {
        const n = el('div', 'book');
        n.append(el('div', 'book-h', 'A note from calm you'), el('span', 'book-note', s.noteToSelf + (s.supportContact.trim() ? ` · Call: ${s.supportContact}` : '')));
        card.append(n);
      }

      const actions = el('div', 'actions');
      if (extra.allowOverride && extra.kind !== 'self' && !s.commitmentMode) {
        const ov = el('button', 'btn ghost', 'Override for one trade…');
        ov.addEventListener('click', () => {
          ov.remove();
          card.append(overrideBox((ok2) => done(ok2)));
        });
        actions.append(ov);
      }
      if (extra.closeTab) {
        const close = el('button', 'btn primary', win ? 'Close the tab & enjoy your day' : 'Close this tab');
        close.addEventListener('click', () => (done(false), extra.closeTab!()));
        actions.append(close);
      }
      const ok = el('button', `btn ${extra.closeTab ? 'ghost' : 'primary'}`, 'I’ll step away');
      ok.addEventListener('click', () => done(false));
      actions.append(ok);
      card.append(actions);
      (actions.lastElementChild?.previousElementSibling as HTMLElement | null)?.focus();
      return;
    }

    header(card, v.level, v.level === 3 ? 'This trade breaks your rules' : 'Hold on. Read this first');
    if (v.moodNote) card.append(el('div', 'moodnote', v.moodNote));
    card.append(hitList(v.hits));

    const bar = el('div', 'bar');
    const fill = el('div', 'bar-fill');
    bar.append(fill);
    const hint = el('div', 'hint');
    card.append(bar, hint);

    let phraseOk = v.level < 3;
    let input: HTMLInputElement | null = null;
    if (v.level === 3) {
      const wrap = el('label', 'phrase');
      wrap.append(el('span', 'phrase-l', 'To continue, type exactly:'), el('code', 'phrase-c', s.confirmPhrase));
      input = el('input', 'input');
      input.autocomplete = 'off';
      input.spellcheck = false;
      // No pasting: typing it out is the point.
      input.addEventListener('paste', (e) => e.preventDefault());
      input.addEventListener('drop', (e) => e.preventDefault());
      input.addEventListener('input', () => {
        phraseOk = input!.value.trim().toLowerCase() === s.confirmPhrase.trim().toLowerCase();
        input!.classList.toggle('ok', phraseOk);
        sync();
      });
      wrap.append(input);
      card.append(wrap);
    }

    const actions = el('div', 'actions');
    const cancel = el('button', 'btn primary', 'Don’t take this trade');
    const go = el('button', 'btn ghost', 'Proceed anyway');
    actions.append(go, cancel);
    card.append(actions);

    const total = Math.max(3, s.countdownSeconds) * (v.level === 3 ? 2 : 1);
    const started = Date.now();
    let counted = false;
    function sync() {
      go.disabled = !(counted && phraseOk);
    }
    timer = setInterval(() => {
      const left = Math.max(0, total - (Date.now() - started) / 1000);
      fill.style.transform = `scaleX(${left / total})`;
      hint.textContent = left > 0 ? `Take a breath. You can decide in ${Math.ceil(left)}s.` : v.level === 3 && !phraseOk ? 'Type the phrase to unlock.' : 'Your call. Make it the one you’d defend tomorrow.';
      if (left === 0 && !counted) {
        counted = true;
        sync();
      }
    }, 100);
    sync();

    cancel.addEventListener('click', () => done(false));
    go.addEventListener('click', (e) => e.isTrusted && !go.disabled && done(true));
    card.addEventListener('keydown', (e) => e.key === 'Escape' && done(false));
    cancel.focus();
  });
}

/** Stop-win helpers: nothing here moves funds. Links and details only; the trader signs everything. */
function bookProfits(s: Settings, unit: 'USD' | 'SOL'): HTMLElement {
  const box = el('div', 'book');
  box.append(el('div', 'book-h', 'Book it'));
  const row = el('div', 'book-row');
  if (unit === 'SOL') row.append(extLink('https://jup.ag/swap/SOL-USDC', 'Swap SOL → USDC on Jupiter ↗'));
  else row.append(el('span', 'book-note', 'Convert today’s profit to USDT/USDC on your exchange before you close.'));
  box.append(row);
  if (s.vaultAddress) {
    const v = el('div', 'book-vault');
    v.append(el('span', 'book-note', `Send ${s.vaultPct}% of today’s profit to your vault:`), el('code', 'book-addr', s.vaultAddress));
    const copy = el('button', 'btn ghost small', 'Copy address');
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(s.vaultAddress).catch(() => {});
      copy.textContent = 'Copied ✓';
    });
    v.append(copy);
    box.append(v);
  } else {
    box.append(el('span', 'book-note', 'Tip: set a vault wallet in TradeGuard SI settings so profits leave the trading wallet.'));
  }
  return box;
}

/** The effortful override: a 60s wait, a written reason (chase language refused) and a long phrase. */
function overrideBox(done: (go: boolean) => void): HTMLElement {
  const box = el('div', 'override');
  box.append(el('div', 'hit-title', 'Override costs effort, on purpose'));
  const reason = el('textarea', 'input override-reason') as HTMLTextAreaElement;
  reason.placeholder = 'Why is this trade part of your plan? Be specific.';
  reason.rows = 2;
  const verdict = el('div', 'hint');
  const phraseL = el('span', 'phrase-l', 'Then type exactly:');
  const phraseC = el('code', 'phrase-c', OVERRIDE_PHRASE);
  const phrase = el('input', 'input') as HTMLInputElement;
  phrase.autocomplete = 'off';
  phrase.addEventListener('paste', (e) => e.preventDefault());
  phrase.addEventListener('drop', (e) => e.preventDefault());
  const go = el('button', 'btn ghost', 'Place this one trade') as HTMLButtonElement;
  go.disabled = true;
  const started = Date.now();
  let chase = false;
  let logged = false;
  const sync = () => {
    const left = Math.max(0, 60 - Math.floor((Date.now() - started) / 1000));
    chase = isChaseLanguage(reason.value);
    if (chase && !logged) {
      logged = true;
      void logDistress('chaseRefused');
    }
    verdict.textContent = chase
      ? '“Get it back” is the signal to close the tab, not to trade. Override refused.'
      : left > 0
        ? `Sit with it for ${left}s.`
        : reason.value.trim().length < 20
          ? 'Write a real reason (20+ characters).'
          : '';
    verdict.classList.toggle('refused', chase);
    go.disabled = chase || left > 0 || reason.value.trim().length < 20 || phrase.value.trim().toLowerCase() !== OVERRIDE_PHRASE.toLowerCase();
  };
  const t = setInterval(sync, 250);
  reason.addEventListener('input', sync);
  phrase.addEventListener('input', sync);
  go.addEventListener('click', (e) => {
    if (!e.isTrusted || go.disabled) return; // the page's own scripts can't click through an override
    clearInterval(t);
    void logDistress('override');
    done(true);
  });
  box.append(reason, verdict, phraseL, phraseC, phrase, go);
  sync();
  return box;
}

// ---------- The 3-line check (before every memecoin buy) ----------

export function checklist(opts: { limitsLine: string; limitsOk: boolean; symbol: string | null }): Promise<{ pass: boolean; failed: string | null; card?: string }> {
  return new Promise((resolve) => {
    const { card, close } = openModal('calm');
    header(card, 0, 'The 3-line check');
    card.querySelector('.lvl')!.textContent = 'Before every buy';
    card.append(el('p', 'lede', `${opts.symbol ? '$' + opts.symbol + ': ' : ''}one “no” means skip. Answer before you read the callout feed.`));
    const answers: (boolean | null)[] = [null, null];
    const q = (i: number, text: string, yes: string, no: string) => {
      const box = el('div', 'pending');
      box.append(el('div', 'pending-q', `${i + 1}. ${text}`));
      const row = el('div', 'seg seg-2');
      for (const [label, val] of [[yes, true], [no, false]] as const) {
        const b = el('button', `seg-btn ${val ? 'seg-win' : 'seg-loss'}`, label);
        b.addEventListener('click', () => {
          answers[i] = val;
          row.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
          sync();
        });
        row.append(b);
      }
      box.append(row);
      card.append(box);
    };
    q(0, 'Did you find this token yourself?', 'I found it', 'A callout / chat sent me');
    q(1, 'Is your entry market cap at or below 2× the top-10 wallets’ average buy (zero-cost wallets excluded)?', 'Yes', 'No / not sure');
    const lim = el('div', `pending ${opts.limitsOk ? '' : 'limits-bad'}`);
    lim.append(el('div', 'pending-q', `3. Limits today: ${opts.limitsOk ? 'clear ✓' : 'hit ✗'}`), el('div', 'pending-d', opts.limitsLine));
    card.append(lim);
    // The pre-trade card: one-sentence thesis + invalidation, logged with the trade to test later.
    const cardBox = el('div', 'pending');
    cardBox.append(el('div', 'pending-q', 'Pre-trade card'));
    // Two taps for the 20-trade review: which signal, if any, separates your winners from your losers.
    const journal: Record<'structure' | 'volume', string | null> = { structure: null, volume: null };
    const tap = (key: 'structure' | 'volume', options: string[]) => {
      const row = el('div', 'seg seg-2');
      for (const label of options) {
        const b = el('button', 'seg-btn', label);
        b.addEventListener('click', () => {
          journal[key] = label;
          row.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
          sync();
        });
        row.append(b);
      }
      cardBox.append(row);
    };
    tap('structure', ['Higher lows', 'No higher lows']);
    tap('volume', ['Volume building', 'Volume fading']);
    const thesis = el('input', 'input') as HTMLInputElement;
    thesis.placeholder = 'Thesis in one sentence: why this, why now (not after the +1,000%)';
    const inval = el('input', 'input') as HTMLInputElement;
    inval.placeholder = 'Invalidation: the market cap / price where you are wrong';
    cardBox.append(thesis, inval);
    card.append(cardBox);
    const msg = el('div', 'hint');
    const actions = el('div', 'actions');
    const skip = el('button', 'btn primary', 'Skip this trade');
    const buy = el('button', 'btn ghost', 'Continue to buy') as HTMLButtonElement;
    actions.append(buy, skip);
    card.append(msg, actions);
    const sync = () => {
      const no = answers.indexOf(false);
      const cardOk = !!journal.structure && !!journal.volume && thesis.value.trim().length >= 15 && inval.value.trim().length >= 2;
      buy.disabled = !opts.limitsOk || answers.includes(null) || no >= 0 || !cardOk;
      msg.textContent = no === 0 ? 'A callout sent you. That copy is built to trigger FOMO. Skip.' : no === 1 ? 'You’d be buying late, after the smart money. Skip.' : !opts.limitsOk ? 'You’ve hit a limit today. Skip.' : !cardOk && !answers.includes(null) ? 'Tap structure and volume, then write the thesis and the invalidation.' : '';
    };
    thesis.addEventListener('input', () => sync());
    inval.addEventListener('input', () => sync());
    sync();
    skip.addEventListener('click', () => {
      close();
      const no = answers.indexOf(false);
      resolve({ pass: false, failed: no === 0 ? 'callout' : no === 1 ? 'late entry' : !opts.limitsOk ? 'limits' : 'skipped' });
    });
    buy.addEventListener('click', (e) => {
      if (!e.isTrusted || buy.disabled) return;
      close();
      resolve({ pass: true, failed: null, card: `${journal.structure} | ${journal.volume} | Thesis: ${thesis.value.trim().slice(0, 200)} | Invalidation: ${inval.value.trim().slice(0, 60)}` });
    });
    skip.focus();
  });
}

// ---------- Rule 8: selling a winner by hand ----------

/**
 * "Manual sell only on a thesis break; otherwise {cap}% max." Pick the break you can actually see, or
 * keep the sell to the cap and let the stop and the runner rule handle the rest.
 */
export function sellCheck(opts: { gainPct: number; sellPct: number | null; cap: number; symbol: string | null; reasons: readonly { id: string; label: string }[] }): Promise<{ go: boolean; reason: string | null }> {
  return new Promise((resolve) => {
    const { card, close } = openModal('calm');
    const sizeKnown = opts.sellPct != null;
    header(card, 2, `You're up ${opts.gainPct.toFixed(0)}%. Is the thesis broken?`);
    card.querySelector('.lvl')!.textContent = 'Your exit rule';
    card.append(
      el('p', 'lede', `${opts.symbol ? '$' + opts.symbol + ': ' : ''}${sizeKnown ? `you're selling ${opts.sellPct}% by hand. ` : ''}Your rule: manual sell only on a thesis break; otherwise ${opts.cap}% max. Runners look like this before they run, and "I'm up and nervous" isn't a break.`),
    );
    let picked: string | null = null;
    const box = el('div', 'pending');
    box.append(el('div', 'pending-q', 'What broke?'));
    const row = el('div', 'seg');
    const choices = [...opts.reasons, { id: 'none', label: 'Nothing, I\'m just nervous' }];
    for (const r of choices) {
      const b = el('button', `seg-btn ${r.id === 'none' ? 'seg-loss' : ''}`, r.label);
      b.addEventListener('click', () => {
        picked = r.id;
        row.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('on', x === b));
        sync();
      });
      row.append(b);
    }
    box.append(row);
    card.append(box);
    const msg = el('div', 'hint');
    const actions = el('div', 'actions');
    const hold = el('button', 'btn primary', sizeKnown ? `Cancel and sell ≤${opts.cap}%` : 'Cancel this sell');
    const sell = el('button', 'btn ghost', 'Sell') as HTMLButtonElement;
    actions.append(sell, hold);
    card.append(msg, actions);
    const sync = () => {
      const isBreak = picked != null && picked !== 'none';
      // Size unknown: "nothing broke" can still go ahead, but only as a sale within the cap.
      sell.disabled = picked == null || (picked === 'none' && sizeKnown);
      sell.textContent = picked === 'none' && !sizeKnown ? `I'm selling ${opts.cap}% or less` : 'Sell';
      msg.textContent = picked === 'none'
        ? `Then take ${opts.cap}% at most and let your stop and runner rule handle the rest.`
        : isBreak ? 'A real break. Selling is the plan working.' : '';
    };
    sync();
    hold.addEventListener('click', () => (close(), resolve({ go: false, reason: null })));
    sell.addEventListener('click', (e) => {
      if (!e.isTrusted || sell.disabled) return;
      close();
      resolve({ go: true, reason: picked });
    });
    hold.focus();
  });
}
