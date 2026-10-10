// DOM heuristics shared by every site adapter.
//
// Exchange UIs change constantly, so adapters lean on what's stable — button
// wording, input labels, "Available"/"Balance" text, the price in the tab title —
// and only use CSS selectors as optional hints. When nothing can be read we
// return nulls and the interceptor fails open (rules that need the value skip).
import type { FlowStats, Market, OrderIntent, Side, TokenStats, Unit } from '../core/types';

export interface AdapterConfig {
  id: string;
  name: string;
  /** Hostname test. */
  host: RegExp;
  /** Clickable text that places an order. Matched against trimmed, whitespace-collapsed text. */
  orderText: RegExp;
  /** Optional: only treat controls inside this selector as order buttons. */
  orderScope?: string;
  /** Optional: selector for the order-entry panel; otherwise we climb to the nearest ancestor with inputs. */
  panel?: string;
  /** spot | perp | 'url' (perp if path mentions futures/perp/swap). */
  market: Market | 'url';
  unit: Unit;
  /** Optional selector for the last price; otherwise the first number in document.title. */
  priceSelector?: string;
  /** Optional selector for the balance; otherwise "Available/Balance/Equity" text in the panel/page. */
  balanceSelector?: string;
  /** Memecoin terminal: read token safety tiles (Top 10, Dev, LP burned…) and the token address from the URL. */
  token?: boolean;
}

const CLICKABLE = 'button, [role="button"], input[type="submit"], input[type="button"], a[href], [data-testid*="buy" i], [data-testid*="sell" i]';

export function textOf(el: Element | null): string {
  if (!el) return '';
  const t = el instanceof HTMLInputElement ? el.value : (el as HTMLElement).innerText ?? el.textContent ?? '';
  return t.replace(/\s+/g, ' ').trim();
}

/** "1,234.5" → 1234.5, "$2.4K" → 2400, "0.5 SOL" → 0.5. Returns null when no number. */
export function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/−/g, '-').match(/-?\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*([kmb])?\b/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, '') + (m[2] ?? ''));
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[3] ?? '').toLowerCase() as 'k' | 'm' | 'b'];
  if (mult) n *= mult;
  if (m[0].trim().startsWith('-')) n = -n;
  return Number.isFinite(n) ? n : null;
}

export function sideFromText(t: string): Side | null {
  if (/\b(buy|long|bid)\b/i.test(t)) return 'buy';
  if (/\b(sell|short|ask)\b/i.test(t)) return 'sell';
  return null;
}

function labelFor(input: HTMLInputElement): string {
  const parts = [input.getAttribute('aria-label'), input.placeholder, input.name, input.id];
  if (input.id) parts.push(textOf(document.querySelector(`label[for="${CSS.escape(input.id)}"]`)));
  parts.push(textOf(input.closest('label')));
  // Nearby text: the wrapper often holds the label and unit ("Amount … USDT").
  const wrap = input.parentElement?.parentElement;
  if (wrap && textOf(wrap).length < 80) parts.push(textOf(wrap));
  return parts.filter(Boolean).join(' ');
}

function visibleInputs(root: ParentNode): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('input')].filter(
    (i) => !['hidden', 'checkbox', 'radio', 'submit', 'button', 'range'].includes(i.type) && !i.disabled,
  );
}

function findPanel(control: HTMLElement, cfg: AdapterConfig): HTMLElement {
  if (cfg.panel) {
    const p = control.closest<HTMLElement>(cfg.panel);
    if (p) return p;
  }
  let el: HTMLElement | null = control;
  for (let i = 0; i < 10 && el; i++) {
    if (el.tagName === 'FORM' || visibleInputs(el).length > 0) return el;
    el = el.parentElement;
  }
  return document.body;
}

const UNIT_RE: Record<Unit, RegExp> = { USD: /\$|\busd[tc]?\b|\bfdusd\b|\busd\b/i, SOL: /\bsol\b/i };

/** Read order value (in `unit`) from the panel's inputs, or from the button text ("Buy 0.5 SOL"). */
function readNotional(panel: HTMLElement, control: HTMLElement, unit: Unit, price: number | null): number | null {
  const btn = textOf(control);
  if (UNIT_RE[unit].test(btn)) {
    const n = parseNumber(btn.replace(/^\D+/, ''));
    if (n && n > 0) return n;
  }
  let total: number | null = null;
  let qty: number | null = null;
  for (const input of visibleInputs(panel)) {
    const label = labelFor(input);
    const v = parseNumber(input.value);
    if (v == null || v <= 0) continue;
    if (/\b(total|cost|order value|value|margin)\b/i.test(label) || (/\b(amount|size)\b/i.test(label) && UNIT_RE[unit].test(label))) {
      total ??= v;
    } else if (/\b(amount|size|qty|quantity|buy|sell)\b/i.test(label) || UNIT_RE[unit].test(label)) {
      qty ??= v;
    }
  }
  if (total != null) return total;
  if (qty != null) return price ? qty * price : qty;
  return null;
}

export function readLeverage(panel: HTMLElement): number | null {
  // Prefer an element that's clearly a leverage control; fall back to "20x" anywhere in the panel.
  const el = panel.querySelector('[class*="leverage" i], [data-testid*="leverage" i], [aria-label*="leverage" i]');
  for (const src of [textOf(el), textOf(panel)]) {
    const m = src.match(/\b(\d{1,3}(?:\.\d+)?)\s*[x×]\b/i);
    if (m) {
      const n = parseFloat(m[1]);
      if (n >= 1 && n <= 200) return n;
    }
  }
  return null;
}

function readBalance(panel: HTMLElement, cfg: AdapterConfig): number | null {
  if (cfg.balanceSelector) {
    const n = parseNumber(textOf(document.querySelector(cfg.balanceSelector)));
    if (n != null) return n;
  }
  const re = /\b(available|avbl|avail\.?|balance|equity|buying power)\b[^\d$-]{0,20}(\$?\s*[\d,.]+\s*[kmb]?)/i;
  for (const root of [panel, document.body]) {
    const m = textOf(root).slice(0, 20000).match(re);
    if (m) {
      const n = parseNumber(m[2]);
      if (n != null && n > 0) return n;
    }
  }
  return null;
}

export function readPrice(cfg: AdapterConfig): number | null {
  if (cfg.priceSelector) {
    const n = parseNumber(textOf(document.querySelector(cfg.priceSelector)));
    if (n != null) return n;
  }
  // Most exchanges put the live price first in the tab title: "67,123.4 | BTCUSDT | Binance".
  const n = parseNumber(document.title);
  return n != null && n > 0 ? n : null;
}

function readSymbol(): string | null {
  // Memecoin terminals title tabs like "$WIF 2.1M | Axiom".
  const ticker = document.title.match(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/);
  if (ticker) return ticker[1].toUpperCase();
  const fromTitle = document.title.match(/\b([A-Z0-9]{2,10})[\/\-_ ]?(USDT|USDC|USD|PERP|SOL)\b/);
  if (fromTitle) return fromTitle[1];
  const fromPath = location.pathname.match(/([A-Z0-9]{2,10})[_\-\/]?(USDT|USDC|USD)/i);
  if (fromPath) return fromPath[1].toUpperCase();
  const seg = location.pathname.split('/').filter(Boolean).pop();
  // Never report a token address as a symbol.
  return seg && seg.length <= 12 && !BASE58.test(seg) ? seg : null;
}

// ---------- Token safety stats (memecoin terminals) ----------

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Token mint or pool address from the URL: /meme/<addr>, /sol/token/<addr>, ?address=<addr>. */
export function tokenAddressFromUrl(loc: { pathname: string; search: string } = location): string | null {
  for (const v of new URLSearchParams(loc.search).values()) if (BASE58.test(v)) return v;
  for (const seg of loc.pathname.split('/').reverse()) if (BASE58.test(seg)) return seg;
  return null;
}

// Label wording used by Axiom-style token info panels ("Top 10 H.", "Dev H.", "LP Burned"…).
const PCT_LABELS: [keyof TokenStats, RegExp][] = [
  ['top10Pct', /^top\s*10(\s*h(\.|olders?)?)?$/i],
  ['devHoldPct', /^dev\s*h(\.|old(ing|s)?)?$/i],
  ['snipersPct', /^snipers?(\s*h(\.|old(ing|s)?)?)?$/i],
  ['insidersPct', /^insiders?(\s*h(\.|old(ing|s)?)?)?$/i],
  ['bundlersPct', /^bundl(ers?|ed)(\s*h(\.|old(ing|s)?)?)?$/i],
  ['lpBurnedPct', /^lp\s*burn(ed|t)?$/i],
];
const USD_LABELS: [keyof TokenStats, RegExp][] = [
  ['liquidityUsd', /^liq(uidity|\.)?$/i],
  ['marketCapUsd', /^(mkt\.?\s*cap|market\s*cap|mc)$/i],
];

/** Climb from a label to the smallest container holding its value, e.g. <div><span>18.2%</span><span>Top 10 H.</span></div>. */
function valueNear(el: Element | null, label: string, re: RegExp): number | null {
  const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
    const t = (el.textContent ?? '').replace(/\s+/g, ' ');
    if (t.length > 80) return null;
    // Prefer the value right after the label ("MC $2.1M"), else the nearest one before it ("18% Top 10 H.").
    const at = t.indexOf(label);
    const after = at >= 0 ? t.slice(at + label.length) : t;
    const m = after.match(re);
    if (m) return parseNumber(m[0]);
    const before = at >= 0 ? [...t.slice(0, at).matchAll(all)] : [];
    if (before.length) return parseNumber(before[before.length - 1][0]);
  }
  return null;
}

export function readTokenStats(root: HTMLElement = document.body): TokenStats {
  const out: TokenStats = {
    address: tokenAddressFromUrl(), lpBurnedPct: null, devHoldPct: null, top10Pct: null, snipersPct: null,
    bundlersPct: null, insidersPct: null, liquidityUsd: null, marketCapUsd: null, solUsd: null,
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(), budget = 30000; n && budget > 0; n = walker.nextNode(), budget--) {
    const label = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 20) continue;
    for (const [key, re] of PCT_LABELS) {
      if (out[key] == null && re.test(label)) (out[key] as number | null) = valueNear(n.parentElement, label, /-?\d+(?:\.\d+)?\s*%/);
    }
    for (const [key, re] of USD_LABELS) {
      if (out[key] == null && re.test(label)) (out[key] as number | null) = valueNear(n.parentElement, label, /\$\s*[\d,.]+\s*[kmb]?/i);
    }
  }
  const sol = (root.textContent ?? '').match(/\bSOL\b[^\d$]{0,8}\$\s*([\d,]+(?:\.\d+)?)/);
  out.solUsd = sol ? parseNumber(sol[1]) : null;
  return out;
}

/** Text of the smallest container around a label that has a number in it, minus the label. */
function tileText(el: Element | null, label: string): string | null {
  for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
    const t = (el.textContent ?? '').replace(/\s+/g, ' ');
    if (t.length > 80) return null;
    const rest = t.replace(label, ' ').trim();
    if (/\d/.test(rest)) return rest;
  }
  return null;
}

const USD_RE = /[-+\u2212]?\s*\$\s*[\d,.]+\s*[kmb]?/i;
const usdIn = (t: string | null) => {
  const m = t?.match(USD_RE);
  return m ? parseNumber(m[0].replace(/\s+/g, '')) : null;
};
const countIn = (t: string | null) => {
  const m = t?.match(/(?:^|\s)(\d[\d,]*)(?=\s*(?:\/|txns?\b|$|\s))/i);
  return m ? parseNumber(m[1]) : null;
};

export function readFlowStats(root: HTMLElement = document.body): FlowStats | null {
  const out: FlowStats = { volUsd: null, buys: null, buysUsd: null, sells: null, sellsUsd: null, netUsd: null };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(), budget = 30000; n && budget > 0; n = walker.nextNode(), budget--) {
    const label = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 14) continue;
    if (out.volUsd == null && /^(5m\s*)?vol(\.|ume)?$/i.test(label)) out.volUsd = usdIn(tileText(n.parentElement, label));
    else if (out.netUsd == null && /^net\s*vol(\.|ume)?$/i.test(label)) out.netUsd = usdIn(tileText(n.parentElement, label));
    else if (out.buys == null && /^buys$/i.test(label)) {
      const t = tileText(n.parentElement, label);
      out.buys = countIn(t);
      out.buysUsd = usdIn(t);
    } else if (out.sells == null && /^sells$/i.test(label)) {
      const t = tileText(n.parentElement, label);
      out.sells = countIn(t);
      out.sellsUsd = usdIn(t);
    }
  }
  if (out.netUsd == null && out.buysUsd != null && out.sellsUsd != null) out.netUsd = out.buysUsd - out.sellsUsd;
  return Object.values(out).some((v) => v != null) ? out : null;
}

export interface SiteAdapter {
  id: string;
  name: string;
  /** Token address for scam lookups (memecoin terminals only). */
  tokenAddress(): string | null;
  matches(host: string): boolean;
  /** If the event target is (inside) an order-placing control, return that control. */
  findOrderControl(target: EventTarget | null): HTMLElement | null;
  readIntent(control: HTMLElement): OrderIntent;
  readPrice(): number | null;
}

export function createAdapter(cfg: AdapterConfig): SiteAdapter {
  return {
    id: cfg.id,
    name: cfg.name,
    matches: (host) => cfg.host.test(host),
    findOrderControl(target) {
      if (!(target instanceof Element)) return null;
      const el = target.closest<HTMLElement>(CLICKABLE);
      if (!el) return null;
      if (cfg.orderScope && !el.closest(cfg.orderScope)) return null;
      const t = textOf(el);
      if (!t || t.length > 48) return null;
      return cfg.orderText.test(t) ? el : null;
    },
    readIntent(control) {
      const panel = findPanel(control, cfg);
      const market: Market =
        cfg.market === 'url' ? (/futures|perp|swap|contract/i.test(location.pathname) ? 'perp' : 'spot') : cfg.market;
      const price = readPrice(cfg);
      const leverage = market === 'perp' ? readLeverage(panel) : null;
      // Some perp UIs take the size as margin; if the input was labelled margin, scale up to notional.
      let notional = readNotional(panel, control, cfg.unit, price);
      if (notional && leverage && /\bmargin\b/i.test(textOf(panel)) && !/\b(size|qty|quantity)\b/i.test(textOf(panel))) {
        notional *= leverage;
      }
      return {
        site: cfg.id,
        symbol: readSymbol(),
        side: sideFromText(textOf(control)) ?? sideFromText(textOf(panel).slice(0, 200)),
        market,
        unit: cfg.unit,
        notional,
        leverage,
        balance: readBalance(panel, cfg),
        priceChangePct: null, // filled by the content script from sampled prices
        priceWindowMin: null,
        token: cfg.token ? readTokenStats() : null,
        scam: null, // filled by the content script from the prefetched bundle check
      };
    },
    readPrice: () => readPrice(cfg),
    tokenAddress: () => (cfg.token ? tokenAddressFromUrl() : null),
  };
}
