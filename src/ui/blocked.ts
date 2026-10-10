import { siteBlockActive } from '../core/site-block';
import { assessDistress } from '../core/distress';
import { loadState } from '../storage';

const $ = (id: string) => document.getElementById(id)!;

async function render() {
  const st = await loadState();
  const { lockout, settings } = st;
  // A pattern of harm, not one bad day: lead with real help.
  const d = assessDistress({ now: Date.now(), settings, trades: st.trades, moods: st.moods, lockoutHistory: st.lockoutHistory, events: st.distressEvents });
  if (settings.helpRedirect && d.level === 'reach-out') return void location.replace(chrome.runtime.getURL('help.html'));
  if (settings.noteToSelf.trim()) {
    $('noteCard').hidden = false;
    $('note').textContent = settings.noteToSelf + (settings.supportContact.trim() ? `\n\nCall: ${settings.supportContact}` : '');
  }
  const active = siteBlockActive(lockout, settings);
  if (!lockout || !active) {
    $('title').textContent = 'Trading is open again';
    $('clock').textContent = '00:00';
    $('reason').textContent = 'The lock has ended. Start the next session with a check-in and your rules, not with this tab.';
    return;
  }
  const win = lockout.kind === 'win';
  document.body.classList.toggle('win', win);
  $('title').textContent = win ? 'You won today. CLOSE THE TAB AND ENJOY YOUR DAY.' : lockout.kind === 'self' ? 'Self-exclusion active' : 'Trading is closed';
  $('reason').textContent = lockout.reason;
  if (win) $('advice').textContent = 'Book it. The way a great day becomes a bad one is coming back to the chart tonight.';
  const tick = () => {
    const left = Math.max(0, lockout.until - Date.now());
    const d = Math.floor(left / 86_400_000);
    const h = Math.floor((left % 86_400_000) / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    $('clock').textContent = d ? `${d}d ${h}h ${m}m` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (left === 0) void render();
  };
  tick();
  setInterval(tick, 1000);
}
void render();

$('closeTab').addEventListener('click', async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) await chrome.tabs.remove(tab.id);
});
