// End-to-end check: loads the built extension into Chromium, opens the mock exchange,
// and verifies interception, every friction level, the lockout, and the extension pages.
//   npm run build && npm run e2e         (set CHASE=1 to include the 70s chasing test)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'docs/screenshots');
const PORT = 5178;
mkdirSync(SHOTS, { recursive: true });

const server = spawn('node', [path.join(ROOT, 'scripts/mock-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? '  ' + extra : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'tg-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});

try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const setStore = (obj) => sw.evaluate((o) => chrome.storage.local.set(o), obj);
  const getStore = (k) => sw.evaluate((key) => chrome.storage.local.get(key), k);
  // Close the onboarding options tab that opens on install.
  await new Promise((r) => setTimeout(r, 800));
  for (const p of ctx.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();

  await setStore({ settings: { countdownSeconds: 3 } });

  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/futures/BTCUSDT`);
  await page.waitForTimeout(1200);
  const overlay = page.locator('tradeguard-overlay');
  // Host innerText skips shadow content, so read text from the card itself.
  const cardText = () => overlay.locator('.card').innerText();
  const shot = async (name) => (await page.waitForTimeout(350), page.screenshot({ path: `${SHOTS}/${name}.png` }));
  const orders = () => page.evaluate(() => window.__mockOrders.length);
  const setLev = async (x) => {
    for (let i = 0; i < 8 && (await page.textContent('#lev')) !== `${x}x`; i++) await page.click('#lev');
  };

  // 1. First order of the session → mood check-in, then a clean trade goes through.
  await setLev(3);
  await page.fill('#amount', '500');
  await page.click('#buyBtn');
  await overlay.getByText('how are you, really?').waitFor();
  check('order click intercepted before reaching the exchange', (await orders()) === 0);
  await shot('1-checkin');
  await overlay.locator('.scale-btn').nth(3).click();
  await overlay.getByRole('button', { name: 'calm' }).click();
  await overlay.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(400);
  check('clean trade replayed to the exchange after check-in', (await orders()) === 1);

  // 2. Oversized order → outcome prompt for the last trade, then level-2 countdown.
  await page.fill('#amount', '4500'); // 4500 / 3x = 1500 margin = 15% of 10k
  await page.click('#buyBtn');
  await overlay.getByText('How did your last trade go?').waitFor();
  await overlay.getByRole('button', { name: 'Win' }).click();
  await overlay.getByRole('button', { name: 'Continue' }).click();
  await overlay.getByText('Position too large').waitFor();
  const proceed = overlay.getByRole('button', { name: 'Proceed anyway' });
  check('level 2: proceed disabled during countdown', await proceed.isDisabled());
  check('level 2: message quotes real numbers', (await cardText()).includes('15%'));
  await shot('2-pause');
  await overlay.getByRole('button', { name: 'Don’t take this trade' }).click();
  await page.waitForTimeout(300);
  check('cancelling blocks the order', (await orders()) === 1);
  const { saves } = await getStore('saves');
  check('cancelled trade logged as a save', saves?.length === 1);

  // Same order again, wait out the countdown, proceed.
  await page.click('#buyBtn');
  await overlay.getByText('Position too large').waitFor();
  await page.waitForTimeout(3300);
  check('level 2: proceed enabled after countdown', await proceed.isEnabled());
  await proceed.click();
  await page.waitForTimeout(400);
  check('proceeding replays the order exactly once', (await orders()) === 2);

  // 3. 50x leverage → level 3: countdown + typed phrase, paste blocked.
  await setLev(50);
  await page.fill('#amount', '500');
  await page.click('#sellBtn');
  await overlay.getByText('How did your last trade go?').waitFor();
  await overlay.getByRole('button', { name: 'Loss' }).click();
  await overlay.getByPlaceholder(/P&L/).fill('-120');
  await overlay.getByRole('button', { name: 'Continue' }).click();
  await overlay.getByText('This trade breaks your rules').waitFor();
  const text3 = await cardText();
  check('level 3: leverage + revenge both flagged', text3.includes('Leverage above your cap') && text3.includes('Possible revenge trade'));
  await page.waitForTimeout(6300);
  check('level 3: still locked after countdown until phrase typed', await overlay.getByRole('button', { name: 'Proceed anyway' }).isDisabled());
  await shot('3-hardstop');
  const phrase = overlay.locator('input.input');
  await phrase.click();
  await page.keyboard.type('I accept this risk and I am not chasing');
  check('level 3: proceed unlocks after typing phrase', await overlay.getByRole('button', { name: 'Proceed anyway' }).isEnabled());
  await overlay.getByRole('button', { name: 'Proceed anyway' }).click();
  await page.waitForTimeout(400);
  check('level 3 override placed the order', (await orders()) === 3);

  // 4. Tilt: three logged losses → a significant lockout closes the trading site itself.
  const { trades } = await getStore('trades');
  const now = Date.now();
  const graded = trades.map((t, i) => ({ ...t, outcome: 'loss', outcomeTs: now - (3 - i) * 1000, pnl: -50 }));
  await setStore({ trades: graded });
  await page.waitForURL(/blocked\.html/, { timeout: 10000 });
  check('logged losses close the trading site immediately', page.url().includes('blocked.html'));
  await page.waitForTimeout(500);
  const blockedText = await page.textContent('body');
  check('closed page shows the reason and a timer', /losing trades today|Tilt detected/.test(blockedText) && /\d{2}:\d{2}/.test(await page.textContent('#clock')));
  await page.screenshot({ path: `${SHOTS}/4-lockout.png` });
  const fresh = await ctx.newPage();
  await fresh.goto(`http://localhost:${PORT}/spot/BTCUSDT`).catch(() => {});
  await fresh.waitForTimeout(800);
  check('the site stays blocked in a brand-new tab', fresh.url().includes('blocked.html'));
  check('no trading UI is reachable while blocked', (await fresh.locator('#buyBtn').count()) === 0);
  await fresh.close();

  // 5. Extension pages render with data.
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 760 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForTimeout(500);
  check('popup shows locked status', (await popup.textContent('#status')) === 'Locked');
  await popup.screenshot({ path: `${SHOTS}/5-popup.png`, fullPage: true });
  await popup.close();

  const dash = await ctx.newPage();
  await dash.goto(`chrome-extension://${extId}/dashboard.html`);
  await dash.waitForTimeout(600);
  check('dashboard lists trades', (await dash.locator('#log tr').count()) >= 4);
  await dash.screenshot({ path: `${SHOTS}/6-dashboard.png`, fullPage: true });
  await dash.close();

  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${extId}/options.html`);
  await opts.waitForTimeout(400);
  await opts.screenshot({ path: `${SHOTS}/7-options.png` });
  await opts.close();

  // 6. Memecoin terminal: scam check, entry gate, and the coach.
  const RUG = 'RugBundLaunch11111111111111111111111pump';
  const WHALE = 'GateFai1Token1111111111111111111111111pump';
  const GOOD = 'GoodLaunch1111111111111111111111111111pump';
  await setStore({
    lockout: null, trades: [], moods: [{ ts: Date.now(), score: 4, tags: ['calm'] }],
    settings: { countdownSeconds: 3, scamApiBase: `http://localhost:${PORT}`, coachBaseUrl: `http://localhost:${PORT}`, rapidFireSeconds: 0, preBuyChecklist: false },
    coachApiKey: 'test-key', // fake key accepted only by the local mock API
  });
  const ax = await ctx.newPage();
  const axOverlay = ax.locator('tradeguard-overlay');
  const axCard = () => axOverlay.locator('.card').innerText();
  const axOrders = () => ax.evaluate(() => window.__mockOrders.length);

  await ax.goto(`http://localhost:${PORT}/axiom/meme/${RUG}`);
  await axOverlay.locator('.chip-risk').waitFor({ timeout: 6000 });
  check('risky token shows a warning chip on page load', (await axOverlay.locator('.chip-risk').innerText()).includes('likely scam'));
  await ax.waitForTimeout(350);
  await ax.screenshot({ path: `${SHOTS}/9-scam-chip.png` });
  await ax.click('#buyBtn');
  await axOverlay.getByRole('heading', { name: 'Trade blocked' }).waitFor();
  const rugText = await axCard();
  check('extreme-risk buy blocked with no override', (await axOverlay.getByRole('button', { name: 'Proceed anyway' }).count()) === 0 && rugText.includes('46.8%'));
  check('blocked card links the Is It Bundled? report', (await axOverlay.locator('.card a.hit-link').getAttribute('href')).includes(`/report/${RUG}`));
  await ax.waitForTimeout(350);
  await ax.screenshot({ path: `${SHOTS}/10-scam-blocked.png` });
  await axOverlay.getByRole('button', { name: /Skip it/ }).click();
  check('blocked buy never reached the exchange', (await axOrders()) === 0);
  await ax.click('#sellBtn');
  await ax.waitForTimeout(500);
  check('selling a scam token is never blocked', (await axOrders()) === 1);
  // That sell is now "pending outcome"; mark it so the next buys don't stop at the pre-flight question.
  const { trades: afterSell } = await getStore('trades');
  await setStore({ trades: afterSell.map((t) => ({ ...t, outcome: 'breakeven', outcomeTs: Date.now() })) });

  await ax.goto(`http://localhost:${PORT}/axiom/meme/${WHALE}`);
  await ax.waitForTimeout(1200);
  await ax.click('#buyBtn');
  await axOverlay.getByText('Token fails your entry gate').waitFor();
  const gateText = await axCard();
  check('entry gate fails with page-read numbers', gateText.includes('Top 10 wallets hold 38.5%') && gateText.includes('LP burned is 0%'));
  await ax.waitForTimeout(350);
  await ax.screenshot({ path: `${SHOTS}/11-gate.png` });
  await axOverlay.getByRole('button', { name: 'Don’t take this trade' }).click();

  await ax.goto(`http://localhost:${PORT}/axiom/meme/${GOOD}`);
  await ax.waitForTimeout(1200);
  await ax.click('#buyBtn');
  await ax.waitForTimeout(800);
  check('clean launch that passes the gate goes straight through', (await axOrders()) === 1 && (await axOverlay.locator('.scrim').count()) === 0);

  // Live coach, "installed" mode. Rules first: a bundled launch is decided locally with no AI call.
  const before = (await (await fetch(`http://localhost:${PORT}/__requests`)).json()).auto.length;
  await ax.goto(`http://localhost:${PORT}/axiom/meme/${RUG}`);
  await axOverlay.locator('.chip-coach').waitFor({ timeout: 10000 });
  check('auto-check shows an on-page AVOID verdict without opening the panel', (await axOverlay.locator('.chip-coach .cc-badge').innerText()) === 'AVOID');
  check('scam token decided by rules: no AI call made', (await axOverlay.locator('.chip-coach .cc-foot').innerText()).includes('your rules') && (await (await fetch(`http://localhost:${PORT}/__requests`)).json()).auto.length === before);
  await ax.waitForTimeout(400);
  await ax.screenshot({ path: `${SHOTS}/13-auto-check.png` });

  // A clean token the rules can't settle goes to the AI: Haiku, with the live page.
  await setStore({ trades: [] });
  await ax.goto(`http://localhost:${PORT}/axiom/meme/${GOOD}`);
  await axOverlay.locator('.chip-coach').waitFor({ timeout: 10000 });
  const reqs = await (await fetch(`http://localhost:${PORT}/__requests`)).json();
  const autoReq = reqs.auto.at(-1);
  const autoText = JSON.stringify(autoReq?.messages ?? []);
  check('clean token gets an AI verdict', (await axOverlay.locator('.chip-coach .cc-badge').innerText()) === 'NO TRADE');
  check('auto-checks run on Haiku without thinking params', autoReq?.model === 'claude-haiku-5-5' && !autoReq.thinking && !autoReq.output_config);
  check('auto-check sent the live page (token stats, flow, bundle report, order preview)', ['top10Pct', 'buysUsd', 'bundledPct', 'preview', 'CLEAR'].every((k) => autoText.includes(k)));
  await ax.goto(`http://localhost:${PORT}/axiom/meme/${RUG}`);
  await axOverlay.locator('.chip-coach').waitFor({ timeout: 10000 });

  // Panel open: the live strip follows the page, and every message carries the live snapshot.
  await ax.waitForTimeout(3000); // let the price sampler collect a few points
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 400, height: 820 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.locator('#live.l-on').waitFor({ timeout: 10000 });
  const strip = await panel.locator('#live').innerText();
  check('live strip follows the trading tab', strip.includes('Axiom') && strip.includes('$RUG'));
  check('live strip previews what a Buy would trigger', strip.includes('BUY → BLOCKED') && strip.includes('Bundle EXTREME'));
  await panel.getByRole('button', { name: /Quick check/ }).click();
  await panel.locator('.verdict').last().waitFor({ timeout: 10000 });
  check('quick check returns an AVOID verdict card', (await panel.locator('.verdict .v-badge').last().innerText()) === 'AVOID');
  await panel.getByText('Patience is the edge').waitFor();
  const lastReq = await (await fetch(`http://localhost:${PORT}/__last-request`)).json();
  const b = lastReq.body;
  check(
    'coach request uses the SDK shape (model, adaptive thinking, effort, cached system, tools)',
    b.model === 'claude-sonnet-5-5' && b.thinking?.type === 'adaptive' && b.output_config?.effort === 'medium' &&
      b.system?.[0]?.cache_control?.type === 'ephemeral' && b.tools.some((t) => t.name === 'show_verdict') && b.stream === true,
  );
  const firstTurn = b.messages.find((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'text' && c.text.startsWith('<live_page>')));
  // The price series only appears after 2+ samples (~2s), so it isn't asserted here; tests/series.test.ts covers it.
  const turnText = firstTurn?.content.find((c) => c.type === 'text')?.text ?? '';
  check('every message carries the live page and trader context', /<live_page>{"site":"Axiom"/.test(turnText) && /<trader>{"limitsInForce"/.test(turnText));
  await panel.screenshot({ path: `${SHOTS}/12-coach.png` });

  // Own key via OpenRouter with a non-Claude, text-only model: Bearer auth, that model, and the
  // Claude-only features (thinking, effort, prompt caching) and chart images left out.
  const coachSettings = (await getStore("settings")).settings;
  await setStore({ settings: { ...coachSettings, coachProvider: 'openrouter', coachProviderModels: { openrouter: { chat: 'deepseek/deepseek-v4-flash' } } }, 'coachKey:openrouter': 'test-or-key' });
  await panel.reload();
  await panel.locator('#live.l-on').waitFor({ timeout: 10000 });
  check('model menu switches to the OpenRouter list', (await panel.locator('#model option:checked').innerText()).includes('DeepSeek'));
  await panel.getByRole('button', { name: /Quick check/ }).click();
  let orReq = null;
  for (let i = 0; i < 40 && orReq?.body?.model !== 'deepseek/deepseek-v4-flash'; i++) {
    await panel.waitForTimeout(250);
    orReq = await (await fetch(`http://localhost:${PORT}/__last-request`)).json();
  }
  const orBody = orReq.body;
  check(
    'OpenRouter key goes as a Bearer token, never as x-api-key',
    orReq.headers.authorization === 'Bearer test-or-key' && !orReq.headers['x-api-key'],
  );
  check(
    'non-Claude model gets a plain request (no thinking, effort, caching or images)',
    orBody.model === 'deepseek/deepseek-v4-flash' && !orBody.thinking && !orBody.output_config && typeof orBody.system === 'string' &&
      !JSON.stringify(orBody.messages).includes('"type":"image"') && orBody.tools.some((t) => t.name === 'show_verdict'),
  );
  await setStore({ settings: coachSettings });
  await sw.evaluate(() => chrome.storage.local.remove('coachKey:openrouter'));
  await panel.close();

  // 7. Gambling-harm protections in the browser.
  await setStore({ lockout: null, trades: [], saves: [], settings: { countdownSeconds: 3, scamApiBase: `http://localhost:${PORT}`, coachBaseUrl: `http://localhost:${PORT}`, rapidFireSeconds: 0, preBuyChecklist: true, coachAutoCheck: false } });
  const pp = await ctx.newPage();
  const po = pp.locator('tradeguard-overlay');
  const pOrders = () => pp.evaluate(() => window.__mockOrders.length);

  // The 3-line check: a callout-driven buy is skipped and logged as a save.
  await pp.goto(`http://localhost:${PORT}/axiom/meme/${GOOD}`);
  await pp.waitForTimeout(1500);
  await pp.click('#buyBtn');
  await po.getByRole('heading', { name: 'The 3-line check' }).waitFor({ timeout: 10000 });
  await po.getByRole('button', { name: 'A callout / chat sent me' }).click();
  check('3-line check: a callout answer disables Buy', await po.getByRole('button', { name: 'Continue to buy' }).isDisabled());
  await pp.waitForTimeout(350);
  await pp.screenshot({ path: `${SHOTS}/14-three-line-check.png` });
  await po.getByRole('button', { name: 'Skip this trade' }).click();
  await pp.waitForTimeout(300);
  check('3-line check: skipped buy never reaches the exchange and is logged', (await pOrders()) === 0 && (await getStore('saves')).saves.some((x) => x.rules.includes('checklist')));
  await pp.click('#buyBtn');
  await po.getByRole('button', { name: 'I found it' }).click();
  await po.getByRole('button', { name: 'Yes' }).click();
  check('pre-trade card is required before buying', await po.getByRole('button', { name: 'Continue to buy' }).isDisabled());
  await po.getByRole('button', { name: 'Higher lows', exact: true }).click();
  await po.getByRole('button', { name: 'Volume building' }).click();
  await po.getByPlaceholder(/Thesis in one sentence/).fill('Higher low after flush, 3 green 1m candles, early not late');
  await po.getByPlaceholder(/Invalidation/).fill('$48K');
  await po.getByRole('button', { name: 'Continue to buy' }).click();
  await pp.waitForTimeout(500);
  check('3-line check: three yeses + a card let the buy through', (await pOrders()) === 1);
  check('the pre-trade card is saved with the trade', ((await getStore('trades')).trades.at(-1)?.note ?? '').includes('Invalidation: $48K'));
  check('the entry journal (structure + volume) is logged for the 20-trade review', ((await getStore('trades')).trades.at(-1)?.note ?? '').startsWith('Higher lows | Volume building |'));

  // Rule 8: manual sell of a winner only on a thesis break; otherwise 40% max.
  const preSell = (await getStore('settings')).settings;
  await setStore({
    settings: { ...preSell, manualSellMaxPct: 40, askLastOutcome: false, requireMoodCheckIn: false, preBuyChecklist: false },
    lockout: null,
    trades: [{ id: 'w1', ts: Date.now() - 10 * 60_000, site: 'axiom', symbol: 'GOOD', token: GOOD, side: 'buy', unit: 'SOL', notional: 0.5, leverage: null, friction: 0, hits: [], overrode: false, moodScore: 4, moodTags: [], entryPrice: 1_500_000 }],
  });
  await pp.reload();
  await pp.waitForTimeout(600);
  await pp.locator('#sell100').click();
  await po.getByText(/Is the thesis broken/).waitFor({ timeout: 5000 });
  await po.getByRole('button', { name: /just nervous/ }).click();
  check('rule 8: gain uses matching market-cap units', /^You.re up (?:[3-5]\d)%/.test(await po.locator('h2').innerText()));
  check('rule 8: selling 100% of a winner with no thesis break is held', await po.getByRole('button', { name: 'Sell', exact: true }).isDisabled());
  await pp.waitForTimeout(350);
  await pp.screenshot({ path: `${SHOTS}/19-sell-check.png` });
  await po.getByRole('button', { name: /Cancel and sell/ }).click();
  await pp.waitForTimeout(300);
  check('rule 8: cancelling keeps the position', (await pOrders()) === 0);
  await pp.locator('#sell100').click();
  await po.getByText(/Is the thesis broken/).waitFor({ timeout: 5000 });
  await po.getByRole('button', { name: 'Dev or insider sold' }).click();
  await po.getByRole('button', { name: 'Sell', exact: true }).click();
  await pp.waitForTimeout(500);
  const soldRec = (await getStore('trades')).trades.at(-1);
  check('rule 8: a thesis-break sell goes through and logs the reason', (await pOrders()) === 1 && soldRec?.exitReason === 'devSell' && (soldRec?.note ?? '').includes('Dev or insider sold'));
  await pp.locator('#sell25').click();
  await pp.waitForTimeout(500);
  check('rule 8: trimming 25% of a winner passes without a question', (await pOrders()) === 2);
  await setStore({ settings: preSell, trades: [] });

  // FOMO copy in the callout feed is flagged on page load.
  await pp.goto(`http://localhost:${PORT}/axiom/meme/${WHALE}`);
  await po.getByText('This page is selling you FOMO').waitFor({ timeout: 8000 });
  check('FOMO-copy chip quotes the callouts', (await po.locator('.chip-risk').first().innerText()).includes('too late'));

  // Bankroll cap: balance 12.5 SOL > 2.5 → buys blocked until the excess is swept.
  await setStore({ trades: [], settings: { countdownSeconds: 3, scamApiBase: `http://localhost:${PORT}`, rapidFireSeconds: 0, preBuyChecklist: false, coachAutoCheck: false, bankrollMaxSol: 2.5, bankrollTargetSol: 2, vaultAddress: 'Vau1tWa11et1111111111111111111111111111' } });
  await pp.goto(`http://localhost:${PORT}/axiom/meme/${GOOD}`);
  await pp.waitForTimeout(1500);
  await pp.click('#buyBtn');
  await po.getByText('Profit leaves the wallet first').waitFor({ timeout: 8000 });
  const bank = await po.locator('.card').innerText();
  check('bankroll cap blocks the buy and names the sweep amount + vault', bank.includes('10.5 SOL') && bank.includes('Vau1tWa11et'));
  await pp.waitForTimeout(350);
  await pp.screenshot({ path: `${SHOTS}/15-bankroll.png` });
  await po.getByRole('button', { name: /Skip it/ }).click();

  // Stop-win: booking the goal closes the trading site with "close the tab and enjoy your day".
  await setStore({ settings: { countdownSeconds: 3, rapidFireSeconds: 0, preBuyChecklist: false, coachAutoCheck: false, bankrollMaxSol: 0, dailyProfitTargetUsd: 100 } });
  const winTrade = { id: 'winner01', ts: Date.now() - 600_000, site: 'axiom', symbol: 'GOOD', side: 'buy', unit: 'SOL', notional: 1, leverage: null, friction: 0, hits: [], overrode: false, moodScore: 4, moodTags: [], outcome: 'win', outcomeTs: Date.now(), pnl: 150 };
  await setStore({ trades: [winTrade] });
  await pp.waitForURL(/blocked\.html/, { timeout: 10000 });
  await pp.waitForTimeout(400);
  check('stop-win closes the site: CLOSE THE TAB AND ENJOY YOUR DAY', (await pp.textContent('#title')).includes('CLOSE THE TAB AND ENJOY YOUR DAY'));
  await pp.screenshot({ path: `${SHOTS}/16-stop-win.png` });
  const closed = pp.waitForEvent('close', { timeout: 5000 }).then(() => true).catch(() => false);
  await pp.click('#closeTab');
  check('the close-tab button actually closes the tab', await closed);
  await setStore({ lockout: null });

  // Typed override refuses chase language.
  await setStore({ settings: { countdownSeconds: 3, rapidFireSeconds: 0, preBuyChecklist: false, coachAutoCheck: false, dailyProfitTargetUsd: 0, lockoutOverride: 'typed', siteBlockOnLockout: false }, trades: [], lockout: { until: Date.now() + 3600_000, startedAt: Date.now(), reason: 'Daily loss cap hit.', kind: 'loss', updatedMs: Date.now() } });
  const op = await ctx.newPage();
  const oo = op.locator('tradeguard-overlay');
  await op.goto(`http://localhost:${PORT}/futures/BTCUSDT`);
  await op.waitForTimeout(1000);
  await op.click('#buyBtn');
  await oo.getByRole('button', { name: 'Override for one trade…' }).click();
  await oo.locator('textarea').fill('one more trade to get back to even');
  await oo.getByText('Override refused').waitFor({ timeout: 5000 });
  check('override refuses "get back to even"', await oo.getByRole('button', { name: 'Place this one trade' }).isDisabled());
  await op.waitForTimeout(300);
  await op.screenshot({ path: `${SHOTS}/17-override-refused.png` });
  await op.close();

  // A pattern of harm (repeated loss lockouts + "win it back" attempts) sends the closed page to real help.
  const dayMs = 86_400_000;
  await setStore({
    settings: { siteBlockOnLockout: true, helpRedirect: true, noteToSelf: 'You promised Mia you would stop at the cap.', supportContact: 'Mia', helpRegion: 'UK' },
    lockoutHistory: [0, 2, 4].map((d) => ({ startedAt: Date.now() - d * dayMs, until: Date.now() - d * dayMs + 3600_000, reason: 'x', kind: 'loss' })),
    distressEvents: [{ ts: Date.now() - dayMs, kind: 'chaseRefused' }],
    lockout: { until: Date.now() + 20 * 3600_000, startedAt: Date.now(), reason: 'Daily loss cap hit.', kind: 'loss', updatedMs: Date.now() },
  });
  const hp = await ctx.newPage();
  await hp.goto(`http://localhost:${PORT}/spot/BTCUSDT`).catch(() => {});
  await hp.waitForURL(/help\.html/, { timeout: 10000 }).catch(() => {});
  check('a harm pattern routes the blocked site to help', hp.url().includes('help.html'));
  await hp.waitForTimeout(600);
  const helpText = await hp.textContent('body');
  check('help page leads with the pattern and local helplines', helpText.includes('This keeps happening') && helpText.includes('0808 8020 133') && helpText.includes('116 123'));
  check('help page shows the note from calm you', helpText.includes('You promised Mia'));
  await hp.screenshot({ path: `${SHOTS}/18-help.png`, fullPage: true });
  await hp.close();
  await setStore({ lockout: null, lockoutHistory: [], distressEvents: [], settings: { siteBlockOnLockout: false } });

  // Locked rules: the popup's off switch can't be used as an escape hatch.
  await setStore({ settings: { rulesLocked: true, siteBlockOnLockout: false } });
  const lp = await ctx.newPage();
  await lp.goto(`chrome-extension://${extId}/popup.html`);
  await lp.waitForTimeout(500);
  check('locked rules disable the on/off switch', await lp.locator('#enabled').isDisabled());
  await lp.close();
  await setStore({ settings: { rulesLocked: false, siteBlockOnLockout: false } });

  // Self-exclusion from the popup can't be ended early.
  await setStore({ lockout: null });
  const pop = await ctx.newPage();
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  pop.on('dialog', (d) => d.accept());
  await pop.selectOption('#lockMins', '10080');
  await pop.click('#lockNow');
  await pop.waitForTimeout(600);
  const { lockout: ex } = await getStore('lockout');
  check('7-day self-exclusion starts with kind "self"', ex?.kind === 'self' && ex.until - Date.now() > 6.9 * 86_400_000);
  check('self-exclusion cannot be ended early', await pop.locator('#endLock').isDisabled());
  await pop.close();
  await setStore({ lockout: null });

  // 6. Optional: chasing (needs ~70s of price history).
  if (process.env.CHASE) {
    await setStore({ lockout: null, trades: [], moods: [{ ts: Date.now(), score: 4, tags: ['calm'] }] });
    const spot = await ctx.newPage();
    await spot.goto(`http://localhost:${PORT}/spot/BTCUSDT`);
    await spot.click('#pump');
    await spot.waitForTimeout(72_000);
    await spot.fill('#amount', '100');
    await spot.click('#buyBtn');
    await spot.locator('tradeguard-overlay').getByText('Chasing a pump').waitFor({ timeout: 5000 });
    check('chasing detected from sampled price run-up', true);
    await spot.screenshot({ path: `${SHOTS}/8-chasing.png` });
  }
} catch (err) {
  console.error(err);
  check('no unexpected errors', false, String(err).split('\n')[0]);
} finally {
  await ctx.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
