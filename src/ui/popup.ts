import { applyMood, currentMood, moodAdjustment } from '../core/mood';
import { dayPnl, endOfDay, fmtAmount, startOfDay } from '../core/rules';
import { MOOD_TAGS, type MoodTag, type Outcome, type TradeRecord } from '../core/types';
import { cleanStreakDays } from '../core/distress';
import { addMood, endLockout, isLocked, loadState, pendingOutcome, saveSettings, startLockout, updateTrade } from '../storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const LABELS = ['Awful', 'Rough', 'Okay', 'Good', 'Sharp'];

let score: number | null = null;
const tags = new Set<MoodTag>();
let outcome: Outcome | null = null;
let lockTimer: ReturnType<typeof setInterval> | undefined;

function buildMoodInputs() {
  LABELS.forEach((label, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<b>${i + 1}</b><span>${label}</span>`;
    b.addEventListener('click', () => {
      score = i + 1;
      $('scale').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      $<HTMLButtonElement>('saveMood').disabled = false;
    });
    $('scale').append(b);
  });
  for (const tag of MOOD_TAGS) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = tag;
    c.addEventListener('click', () => {
      tags.has(tag) ? tags.delete(tag) : tags.add(tag);
      c.classList.toggle('on', tags.has(tag));
    });
    $('chips').append(c);
  }
}

async function render() {
  const { settings, trades, moods, lockout, saves } = await loadState();
  const now = Date.now();
  const locked = isLocked(lockout, now);

  const status = $('status');
  status.className = `pill ${!settings.enabled ? 'off' : locked ? 'locked' : 'ok'}`;
  status.textContent = !settings.enabled ? 'Off' : locked ? 'Locked' : 'Guarding';
  const en = $<HTMLInputElement>('enabled');
  en.checked = settings.enabled;
  // Locked rules: turning TradeGuard SI off is a loosening, so it goes through Settings (double ask + 72h).
  en.disabled = (locked && settings.commitmentMode) || settings.rulesLocked;
  en.title = settings.rulesLocked ? 'Your rules are locked. Change this in Settings.' : '';

  $('lockCard').classList.toggle('hidden', !locked);
  clearInterval(lockTimer);
  if (locked) {
    $('lockReason').textContent = lockout.reason;
    const end = $<HTMLButtonElement>('endLock');
    const fixed = settings.commitmentMode || settings.rulesLocked || lockout.kind === 'self';
    end.disabled = fixed;
    end.textContent = lockout.kind === 'self' ? 'Self-exclusion: no early exit' : settings.rulesLocked ? 'Rules locked: no early exit' : settings.commitmentMode ? 'Commitment mode: no early exit' : 'End lockout early';
    const tick = () => {
      const left = Math.max(0, lockout.until - Date.now());
      const h = Math.floor(left / 3600_000);
      const m = Math.floor((left % 3600_000) / 60_000);
      const s = Math.floor((left % 60_000) / 1000);
      $('lockClock').textContent = `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      if (left === 0) void render();
    };
    tick();
    lockTimer = setInterval(tick, 1000);
  }

  const mood = currentMood(moods, now);
  $('moodAge').textContent = mood ? `${mood.score}/5${mood.tags.length ? ' · ' + mood.tags.join(', ') : ''} · ${Math.round((now - mood.ts) / 60000)}m ago` : 'no check-in yet';

  const today = trades.filter((t) => t.ts >= startOfDay(now));
  $('tToday').innerHTML = `${today.length}<small>/${settings.maxTradesPerDay}</small>`;
  const pnl = dayPnl(trades, now);
  $('pnlToday').textContent = (pnl < 0 ? '−' : '') + fmtAmount(Math.abs(pnl), 'USD');
  $('pnlToday').style.color = pnl < 0 ? 'var(--red)' : pnl > 0 ? 'var(--teal)' : '';
  $('saves').textContent = String(saves.filter((s) => s.ts >= startOfDay(now)).length);

  const adj = moodAdjustment(mood);
  const eff = applyMood(settings, adj);
  const hourCount = trades.filter((t) => t.ts > now - 3600_000).length;
  $('limits').innerHTML = [
    ['Size', `${eff.maxPositionPct}%`],
    ['Leverage', `${eff.maxLeverage}x`],
    ['This hour', `${hourCount}/${eff.maxTradesPerHour}`],
    ['Today', `${today.length}/${eff.maxTradesPerDay}`],
    ['Chase', `${eff.chaseThresholdPct}%`],
  ]
    .map(([k, v]) => `<span>${k} <b>${v}</b></span>`)
    .join('');
  $('moodNote').textContent = adj.note ?? '';

  const st2 = await loadState();
  const first = Math.min(now, ...trades.map((t) => t.ts), ...st2.lockoutHistory.map((l) => l.startedAt));
  const streak = cleanStreakDays(now, st2.lockoutHistory, trades, first);
  $('streak').textContent = streak > 0 ? `${streak} day${streak === 1 ? '' : 's'} in a row within your rules` : '';
  const pending = pendingOutcome(trades, now);
  $('pendingCard').classList.toggle('hidden', !pending);
  if (pending) {
    const desc = [pending.side?.toUpperCase(), pending.symbol, pending.notional ? fmtAmount(pending.notional, pending.unit) : null].filter(Boolean).join(' ');
    $('pendingDesc').textContent = `${desc || 'Trade'} on ${pending.site} at ${new Date(pending.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    $('saveOutcome').dataset.id = pending.id;
    $('saveOutcome').dataset.unit = pending.unit;
    $<HTMLInputElement>('pnl').placeholder = `P&L in ${pending.unit === 'SOL' ? 'SOL' : '$'} (optional)`;
  }
}

buildMoodInputs();

$('saveMood').addEventListener('click', async () => {
  if (score == null) return;
  await addMood({ ts: Date.now(), score, tags: [...tags] });
  score = null;
  tags.clear();
  document.querySelectorAll('.scale button, .chip').forEach((b) => b.classList.remove('on'));
  $<HTMLButtonElement>('saveMood').disabled = true;
  await render();
});

$('seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
  b.addEventListener('click', () => {
    outcome = b.dataset.o as Outcome;
    $('seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    $<HTMLButtonElement>('saveOutcome').disabled = false;
  }),
);

$('saveOutcome').addEventListener('click', async () => {
  const id = $('saveOutcome').dataset.id;
  if (!id || !outcome) return;
  const raw = $<HTMLInputElement>('pnl').value;
  const unit = ($('saveOutcome').dataset.unit as 'USD' | 'SOL') || 'USD';
  const exitReason = ($<HTMLSelectElement>('exitReason').value || undefined) as TradeRecord['exitReason'];
  await updateTrade(id, { outcome, outcomeTs: Date.now(), ...(exitReason ? { exitReason } : {}), ...(raw !== '' && Number.isFinite(+raw) ? { pnl: +raw, pnlUnit: unit } : {}) });
  $<HTMLSelectElement>('exitReason').value = '';
  outcome = null;
  $<HTMLInputElement>('pnl').value = '';
  $('seg').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
  $<HTMLButtonElement>('saveOutcome').disabled = true;
  await render();
});

$('lockNow').addEventListener('click', async () => {
  const v = $<HTMLSelectElement>('lockMins').value;
  const minutes = v === 'eod' ? Math.ceil((endOfDay(Date.now()) - Date.now()) / 60000) : Number(v);
  const self = minutes >= 1440;
  if (self && !confirm(`Exclude yourself from trading for ${minutes >= 10080 ? Math.round(minutes / 1440) + ' days' : '24 hours'}? This can't be undone or ended early.`)) return;
  await startLockout(minutes, self ? `You excluded yourself for ${minutes >= 10080 ? Math.round(minutes / 1440) + ' days' : '24 hours'}.` : 'You locked yourself out.', self ? 'self' : 'break');
  await render();
});

$('endLock').addEventListener('click', async () => {
  if (!confirm('End the lockout early? You set it for a reason.')) return;
  await endLockout();
  await render();
});

$('enabled').addEventListener('change', async (e) => {
  await saveSettings({ enabled: (e.target as HTMLInputElement).checked });
  await render();
});

// sidePanel.open() needs the user gesture, so resolve the window id up front and call it synchronously on click.
let windowId: number | undefined;
void chrome.windows.getCurrent().then((w) => (windowId = w.id));
$('openCoach').addEventListener('click', () => {
  if (windowId == null) return;
  void chrome.sidePanel.open({ windowId });
  window.close();
});

void render();
