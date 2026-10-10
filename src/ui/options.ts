import { ADAPTERS } from '../adapters';
import { MEMECOIN_PRESET } from '../core/defaults';
import { lockedDelayHours, splitChanges } from '../core/limits';
import { SYSTEM_PRESETS } from '../core/defaults';
import { isChaseLanguage } from '../core/chase-language';
import { dayPnl, startOfDay } from '../core/rules';
import type { Settings } from '../core/types';
import { isLocked, loadState, logDistress, saveSettings } from '../storage';
import { getAccount, linkAccount, refreshMe, unlinkAccount, type Me } from '../account';
import { API_BASE } from '../config';

const form = document.getElementById('form') as HTMLFormElement;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let current: Settings;

function fill(s: Settings) {
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name || !(el.name in s)) continue;
    const v = s[el.name as keyof Settings];
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v);
  }
  const sites = $('sites');
  sites.replaceChildren();
  for (const a of ADAPTERS) {
    const row = document.createElement('label');
    row.className = 'site';
    const name = document.createElement('span');
    name.textContent = a.name;
    const sw = document.createElement('span');
    sw.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.adapter = a.id;
    cb.checked = !s.disabledAdapters.includes(a.id);
    sw.append(cb, document.createElement('span'));
    row.append(name, sw);
    sites.append(row);
  }
  renderCustom(s.customSites);
}

function renderCustom(list: string[]) {
  const box = $('customList');
  box.replaceChildren();
  for (const host of list) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = host;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = `Remove ${host}`;
    x.addEventListener('click', async () => {
      current = await saveSettings({ customSites: current.customSites.filter((h) => h !== host) });
      await chrome.permissions.remove({ origins: [`https://${host}/*`] }).catch(() => {});
      renderCustom(current.customSites);
    });
    tag.append(x);
    box.append(tag);
  }
}

function read(): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number' || (el.tagName === 'SELECT' && 'num' in el.dataset)) out[el.name] = Math.max(0, Number(el.value) || 0);
    else out[el.name] = el.tagName === 'TEXTAREA' ? el.value.slice(0, 500) : el.value.trim();
  }
  out.disabledAdapters = [...form.querySelectorAll<HTMLInputElement>('[data-adapter]')].filter((c) => !c.checked).map((c) => c.dataset.adapter);
  if (!out.confirmPhrase) delete out.confirmPhrase;
  return out as Partial<Settings>;
}

async function init() {
  const { settings, lockout } = await loadState();
  current = settings;
  fill(settings);
  const frozen = settings.commitmentMode && isLocked(lockout);
  ($('fs') as HTMLFieldSetElement).disabled = frozen;
  $('lockBanner').hidden = !frozen;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Re-check at save time: a lockout may have started since the page opened.
  const { settings, lockout } = await loadState();
  if (settings.commitmentMode && isLocked(lockout)) return void init();
  const next = read();
  for (const k of ['vaultAddress', 'tradingWallet'] as const) {
    if (next[k] && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(next[k] as string)) return void alert('Wallet fields take a public Solana address only. Never paste a private key or seed phrase anywhere.');
  }
  // A custom RPC needs permission for that one origin (asked while we still have the click gesture).
  if (next.solanaRpcUrl && next.solanaRpcUrl !== settings.solanaRpcUrl) {
    try {
      const u = new URL(next.solanaRpcUrl);
      if (u.protocol !== 'https:') return void alert('The RPC URL must be https.');
      if (u.origin !== 'https://api.mainnet-beta.solana.com' && !(await chrome.permissions.request({ origins: [`${u.origin}/*`] }))) return;
    } catch {
      return void alert('That RPC URL is not valid.');
    }
  }
  // Tightening applies now; loosening waits out the cooling-off period.
  const split = splitChanges(settings, next);
  if (split.later && settings.rulesLocked) {
    const ok = await lockedRulesGate(Object.keys(split.later.changes));
    if (!ok) return void init();
    split.later.effectiveAt = Date.now() + lockedDelayHours(settings) * 3600_000;
  }
  current = await saveSettings(split.now);
  if (split.later) {
    const { pendingSettings: prev } = await loadState();
    await chrome.storage.local.set({ pendingSettings: { changes: { ...(prev?.changes ?? {}), ...split.later.changes }, effectiveAt: split.later.effectiveAt } });
  }
  await renderPending();
  const saved = $('saved');
  saved.textContent = split.later ? 'Saved. Loosened limits apply later' : 'Saved';
  saved.style.opacity = '1';
  setTimeout(() => (saved.style.opacity = '0'), 2400);
});

$('addSite').addEventListener('click', async () => {
  const input = $<HTMLInputElement>('newSite');
  const host = input.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    input.setCustomValidity('Enter a hostname like app.example.com');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  // Must run directly in the click handler so Chrome sees the user gesture.
  const ok = await chrome.permissions.request({ origins: [`https://${host}/*`] });
  if (!ok) return;
  if (!current.customSites.includes(host)) current = await saveSettings({ customSites: [...current.customSites, host] });
  input.value = '';
  renderCustom(current.customSites);
});

$('export').addEventListener('click', async () => {
  const state = await loadState();
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `tradeguard-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
});

$('wipe').addEventListener('click', async () => {
  const { settings, lockout } = await loadState();
  if (settings.commitmentMode && isLocked(lockout)) return alert('Not during a commitment-mode lockout.');
  if (!confirm('Delete all trades, check-ins and lockout history? Your rules are kept. This cannot be undone.')) return;
  await chrome.storage.local.set({ trades: [], moods: [], saves: [], lockout: null });
  alert('History deleted.');
});

chrome.storage.onChanged.addListener((c) => {
  if (c.lockout) void init();
});

void init();

// ---------- Account ----------

async function renderAccount() {
  const a = await getAccount();
  $('acctLinked').hidden = !a;
  $('acctUnlinked').hidden = !!a;
  ($('accountLink') as HTMLAnchorElement).href = `${API_BASE}/account`;
  if (!a) return;
  ($('manageLink') as HTMLAnchorElement).href = `${a.apiBase}/account`;
  let me: Me | null = null;
  try {
    me = await refreshMe();
  } catch {
    // shown via lastError below
  }
  const fresh = await getAccount();
  const parts = [
    me ? `${me.planName} plan` : fresh?.plan ? `${fresh.plan} plan` : 'Linked',
    me?.limits.hostedAI ? `coach ${me.usage.chat}/${me.limits.chatMessagesPerMonth} messages, ${me.usage.autoCheck}/${me.limits.autoChecksPerMonth} auto-checks this month` : 'hosted coach not included (use your own key, or upgrade)',
    fresh?.syncEnabled ? (fresh.lastSyncAt ? `synced ${new Date(fresh.lastSyncAt).toLocaleTimeString()}` : 'sync on') : 'sync off',
    me?.telegramLinked ? 'Telegram linked' : null,
  ].filter(Boolean);
  $('acctStatus').textContent = parts.join(' · ') + (fresh?.lastError ? ` · ⚠ ${fresh.lastError}` : '');
}

$('linkBtn').addEventListener('click', async () => {
  const code = ($('linkCode') as HTMLInputElement).value.trim();
  const msg = $('linkMsg');
  if (code.length < 6) return void (msg.textContent = 'Enter the code from your account page.');
  msg.textContent = 'Linking…';
  try {
    await linkAccount(code, ($('syncConsent') as HTMLInputElement).checked);
    msg.textContent = '';
    ($('linkCode') as HTMLInputElement).value = '';
    await chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
    await renderAccount();
  } catch (e) {
    msg.textContent = (e as Error).message;
  }
});
$('unlinkBtn').addEventListener('click', async () => {
  if (!confirm('Unlink this device? It stops syncing and loses hosted coach access. To fully revoke it, also remove it on your account page.')) return;
  await unlinkAccount();
  await renderAccount();
});
$('syncNowBtn').addEventListener('click', async () => {
  $('acctStatus').textContent = 'Syncing…';
  await chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
  await renderAccount();
});
void renderAccount();

// ---------- Pending loosened limits + preset ----------

async function renderPending() {
  const { pendingSettings } = await loadState();
  const b = $('pendingBanner');
  b.hidden = !pendingSettings;
  if (!pendingSettings) return;
  b.replaceChildren();
  const keys = Object.entries(pendingSettings.changes).map(([k, v]) => `${k} → ${String(v)}`).join(' · ');
  b.append(`Loosened limits apply ${new Date(pendingSettings.effectiveAt).toLocaleString()}: ${keys}. `);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel these changes';
  cancel.addEventListener('click', async () => {
    await chrome.storage.local.remove('pendingSettings');
    await renderPending();
  });
  b.append(cancel);
}

$('presetBtn').addEventListener('click', async () => {
  const { settings, lockout } = await loadState();
  if (settings.commitmentMode && isLocked(lockout)) return;
  const split = splitChanges(settings, MEMECOIN_PRESET);
  if (split.later && settings.rulesLocked && !(await lockedRulesGate(Object.keys(split.later.changes)))) return;
  current = await saveSettings(split.now);
  if (split.later) await chrome.storage.local.set({ pendingSettings: { ...split.later, effectiveAt: Date.now() + lockedDelayHours(settings) * 3600_000 } });
  fill(current);
  await renderPending();
  $('presetMsg').textContent = split.later ? 'Loaded. A few looser values wait out the cooling-off period.' : 'Loaded ✓';
});
void renderPending();

async function renderChain() {
  const st = (await chrome.storage.local.get(['chainSyncAt', 'chainSyncError'])) as { chainSyncAt?: number; chainSyncError?: string | null };
  const { settings } = await loadState();
  const b = $('chainStatus');
  b.hidden = !settings.tradingWallet;
  if (!settings.tradingWallet) return;
  b.textContent = st.chainSyncError
    ? `On-chain P&L: last read failed (${st.chainSyncError}). A dedicated RPC URL usually fixes this.`
    : st.chainSyncAt
      ? `On-chain P&L: reading your wallet every minute · last read ${new Date(st.chainSyncAt).toLocaleTimeString()}.`
      : 'On-chain P&L: first read in progress…';
}
chrome.storage.onChanged.addListener((c) => (c.chainSyncAt || c.chainSyncError) && void renderChain());
void renderChain();

// ---------- Locked rules: refuse on bad days, otherwise ask twice ----------

const LOCK_PHRASE = 'I am changing my rules while calm, rested and not chasing a loss';

async function lockedRulesGate(keys: string[]): Promise<boolean> {
  const { lockout, trades } = await loadState();
  const now = Date.now();
  if (lockout && lockout.until > now) return refuse('You are in a lockout. Rules can only be loosened on a calm day.');
  if (lockout && now - lockout.until < 24 * 3600_000) return refuse('A lockout ended less than 24 hours ago. Loosening is closed until tomorrow.');
  const solToday = trades.filter((t) => t.pnlUnit === 'SOL' && typeof t.pnl === 'number' && (t.outcomeTs ?? t.ts) >= startOfDay(now)).reduce((a, t) => a + (t.pnl as number), 0);
  if (dayPnl(trades, now) < 0 || solToday < 0) return refuse("Today is a red day. Rule changes made after losses are the emotional edits these locks exist to stop. Try again tomorrow.");

  // Ask #1: why (chase language refused) + typed phrase.
  const why = prompt(`Your rules are locked. You're loosening: ${keys.join(', ')}.\n\nWhy? Write a real reason (30+ characters):`) ?? '';
  if (why.trim().length < 30) return refuse('No change. A real reason is required.');
  if (isChaseLanguage(why)) {
    await logDistress('unlockRefused');
    return refuse('“Get it back” is the signal to close the tab, not to change the rules. No change.');
  }
  const typed = prompt(`Type exactly (no paste needed, but no shortcuts either):\n\n${LOCK_PHRASE}`) ?? '';
  if (typed.trim().toLowerCase() !== LOCK_PHRASE.toLowerCase()) return refuse('The phrase did not match. No change.');
  // Ask #2: are you sure, with the delay spelled out.
  return confirm(`Last check. These changes take effect in 72 hours, and you can cancel them any time before then.\n\nStill want this?`);
}

function refuse(msg: string): false {
  alert(msg);
  return false;
}

document.querySelectorAll<HTMLButtonElement>('.sysPreset').forEach((b) =>
  b.addEventListener('click', async () => {
    const p = SYSTEM_PRESETS.find((x) => x.id === b.dataset.id)!;
    const { settings, lockout } = await loadState();
    if (settings.commitmentMode && isLocked(lockout)) return;
    const split = splitChanges(settings, p.settings);
    if (split.later && settings.rulesLocked && !(await lockedRulesGate(Object.keys(split.later.changes)))) return;
    current = await saveSettings(split.now);
    if (split.later) await chrome.storage.local.set({ pendingSettings: { ...split.later, effectiveAt: Date.now() + lockedDelayHours(settings) * 3600_000 } });
    fill(current);
    await renderPending();
    $('presetMsg').textContent = `${p.name} loaded.${split.later ? ' Looser values wait out the cooling-off period.' : ''} ${p.blurb}`;
  }),
);
