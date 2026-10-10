import { assessDistress } from '../core/distress';
import { CRISIS, EVERYWHERE, GAMBLING, guessRegion, type Region, type Resource } from '../help/resources';
import { loadState, saveSettings } from '../storage';

const $ = (id: string) => document.getElementById(id)!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });

function card(r: Resource): HTMLElement {
  const d = el('div', `r ${r.urgent ? 'urgent' : ''}`);
  d.append(el('b', '', r.name), el('span', '', r.what));
  if (r.contact) d.append(el('span', 'c', r.contact));
  if (r.url) {
    const a = el('a', '', r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') + ' ↗');
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    d.append(a);
  }
  return d;
}

function renderRegion(region: Region) {
  $('gambling').replaceChildren(...GAMBLING[region].map(card));
  $('crisis').replaceChildren(card(CRISIS[region]));
}

async function init() {
  const st = await loadState();
  const { settings, lockout } = st;
  const region: Region = settings.helpRegion === 'auto' ? guessRegion() : settings.helpRegion;
  const sel = $('region') as HTMLSelectElement;
  sel.value = region;
  sel.addEventListener('change', () => {
    renderRegion(sel.value as Region);
    void saveSettings({ helpRegion: sel.value as Region });
  });
  renderRegion(region);
  $('everywhere').replaceChildren(...EVERYWHERE.map(card));

  if (lockout && lockout.until > Date.now()) {
    const tick = () => {
      const left = Math.max(0, lockout.until - Date.now());
      const h = Math.floor(left / 3_600_000);
      const m = Math.floor((left % 3_600_000) / 60_000);
      $('lockLine').replaceChildren('Trading closed for ', el('b', '', `${h}h ${String(m).padStart(2, '0')}m`));
    };
    tick();
    setInterval(tick, 30_000);
  }

  const d = assessDistress({ now: Date.now(), settings, trades: st.trades, moods: st.moods, lockoutHistory: st.lockoutHistory, events: st.distressEvents });
  if (d.level === 'reach-out') {
    $('headline').textContent = 'This keeps happening. Let’s get you some support.';
    $('lede').textContent = 'TradeGuard SI noticed a pattern, not just a bad day. That’s a signal to talk to someone, and it’s a strong move, not a weak one.';
  }
  if (d.reasons.length) {
    $('why').hidden = false;
    $('why').replaceChildren(...d.reasons.map((r) => el('li', '', r)));
  }
  if (settings.noteToSelf.trim()) {
    $('noteCard').hidden = false;
    $('note').textContent = settings.noteToSelf;
    if (settings.supportContact.trim()) $('contactLine').textContent = `You said you'd call: ${settings.supportContact}`;
  }
}

// Breathing guide: 4s in, 4s out.
const breath = $('breath');
setInterval(() => {
  const inNow = !breath.classList.contains('in');
  breath.classList.toggle('in', inNow);
  breath.textContent = inNow ? 'breathe in' : 'breathe out';
}, 4000);

$('urgeBtn').addEventListener('click', () => {
  const end = Date.now() + 10 * 60_000;
  ($('urgeBtn') as HTMLButtonElement).disabled = true;
  const t = setInterval(() => {
    const left = Math.max(0, end - Date.now());
    $('urgeLine').textContent = left
      ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left. Notice the urge without acting on it. It will pass.`
      : 'Ten minutes. The urge has peaked. If it’s still loud, call one of the numbers above. Then close this tab.';
    if (!left) clearInterval(t);
  }, 1000);
});

// Private self-check: our own plain-language questions, not a diagnostic test. Nothing is stored.
const QS = [
  'Have you traded with money you needed for bills, rent or savings?',
  'After a loss, do you feel you have to trade again to win it back?',
  'Have you hidden how much you trade or lose from people close to you?',
  'Do you feel restless or irritable when you try to trade less?',
  'Have you borrowed money or used credit to keep trading?',
  'Do you keep trading for the rush, even when you planned to stop?',
];
const answers: (boolean | null)[] = QS.map(() => null);
$('quiz').replaceChildren(
  ...QS.map((q, i) => {
    const row = el('div', 'q');
    const btns = el('div');
    for (const [label, v] of [['Yes', true], ['No', false]] as const) {
      const b = el('button', '', label);
      b.addEventListener('click', () => {
        answers[i] = v;
        btns.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        const yes = answers.filter((a) => a === true).length;
        $('quizResult').textContent = answers.includes(null)
          ? ''
          : yes >= 2
            ? `You answered yes to ${yes}. These are common signs of gambling harm. A free, confidential call to one of the helplines above is a good next step.`
            : yes === 1
              ? 'One yes is worth keeping an eye on. Keep your limits locked and check in again next week.'
              : 'No warning signs right now. Keep your rules locked and keep logging.';
      });
      btns.append(b);
    }
    row.append(el('span', '', q), btns);
    return row;
  }),
);

void init();
