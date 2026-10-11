// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readSellPct } from '../src/adapters/heuristics';
import { DEFAULT_SETTINGS, MEMECOIN_PRESET, SYSTEM_PRESETS } from '../src/core/defaults';
import { isLoosening } from '../src/core/limits';
import { manualSellCheck } from '../src/core/exit-rules';
import type { EvalContext, OrderIntent, Settings, TradeRecord } from '../src/core/types';

const NOW = new Date('2026-10-14T14:00:00').getTime();
const MINT = 'MintX111111111111111111111111111111111pump';
const buy = (p: Partial<TradeRecord> = {}): TradeRecord => ({
  id: 'b1', ts: NOW - 30 * 60_000, site: 'axiom', symbol: 'X', token: MINT, side: 'buy', unit: 'SOL', notional: 1, leverage: null,
  friction: 0, hits: [], overrode: false, moodScore: 4, moodTags: [], entryPrice: 100_000, ...p,
});
const sell = (p: Partial<OrderIntent> = {}): OrderIntent => ({
  site: 'axiom', symbol: 'X', side: 'sell', market: 'spot', unit: 'SOL', notional: null, leverage: null, balance: null,
  priceChangePct: null, priceWindowMin: null, tokenAddress: MINT, price: 133_000, sellPct: 100, ...p,
});
const ctx = (intent: OrderIntent, s: Partial<Settings> = {}, trades = [buy()]): EvalContext => ({
  now: NOW, intent, settings: { ...DEFAULT_SETTINGS, manualSellMaxPct: 40, ...s }, trades, mood: null, lockout: null,
});

describe('rule 8: manual sell only on a thesis break; otherwise 40% max', () => {
  it('asks when you sell more than the cap of a winner', () => {
    expect(manualSellCheck(ctx(sell()))).toMatchObject({ sellPct: 100, cap: 40 });
    expect(manualSellCheck(ctx(sell()))!.gainPct).toBeCloseTo(33, 0);
  });
  it('lets a sell at or under the cap through', () => {
    expect(manualSellCheck(ctx(sell({ sellPct: 40 })))).toBeNull();
    expect(manualSellCheck(ctx(sell({ sellPct: 25 })))).toBeNull();
  });
  it('never slows down cutting a loser or selling flat', () => {
    expect(manualSellCheck(ctx(sell({ price: 75_000 })))).toBeNull();
    expect(manualSellCheck(ctx(sell({ price: 100_000 })))).toBeNull();
  });
  it('still asks when the page does not show the sell size', () => {
    expect(manualSellCheck(ctx(sell({ sellPct: null })))).toMatchObject({ sellPct: null });
  });
  it('fails open when it cannot price the position', () => {
    expect(manualSellCheck(ctx(sell({ price: null })))).toBeNull();
    expect(manualSellCheck(ctx(sell(), {}, [buy({ entryPrice: null })]))).toBeNull();
    expect(manualSellCheck(ctx(sell(), {}, [buy({ token: 'Other1111111111111111111111111111111111pump' })]))).toBeNull();
  });
  it('measures from your latest buy of the token', () => {
    const trades = [buy({ id: 'old', ts: NOW - 120 * 60_000, entryPrice: 50_000 }), buy({ id: 'new', entryPrice: 140_000 })];
    expect(manualSellCheck(ctx(sell(), {}, trades))).toBeNull(); // 133K vs latest 140K = down
  });
  it('ignores buys, and is off at 0', () => {
    expect(manualSellCheck(ctx(sell({ side: 'buy' })))).toBeNull();
    expect(manualSellCheck(ctx(sell(), { manualSellMaxPct: 0 }))).toBeNull();
  });
  it('raising the cap or turning it off is a loosening (waits out the cooling-off)', () => {
    expect(isLoosening('manualSellMaxPct', 40, 100)).toBe(true);
    expect(isLoosening('manualSellMaxPct', 40, 0)).toBe(true);
    expect(isLoosening('manualSellMaxPct', 40, 25)).toBe(false);
  });
  it('is on in the TradeGuard SI rules and the runner preset', () => {
    expect(MEMECOIN_PRESET.manualSellMaxPct).toBe(40);
    const runner = SYSTEM_PRESETS.find((p) => p.id === 'runner')!;
    expect(runner.settings).toMatchObject({ manualSellMaxPct: 40, stopLossPct: 25 });
    expect(runner.blurb).toMatch(/not financial advice/i);
    expect(DEFAULT_SETTINGS.manualSellMaxPct).toBe(0);
  });
});

describe('readSellPct', () => {
  const read = (html: string) => {
    document.body.innerHTML = `<form id="p">${html}</form>`;
    return readSellPct(document.querySelector('#go') as HTMLElement, document.querySelector('#p') as HTMLElement);
  };
  it('reads the % on the button, "sell all" and an active chip', () => {
    expect(read('<button id="go">Sell 50%</button>')).toBe(50);
    expect(read('<button id="go">Sell All</button>')).toBe(100);
    expect(read('<button aria-pressed="false">25%</button><button aria-pressed="true">100%</button><button id="go">Sell</button>')).toBe(100);
  });
  it('reads a percentage field, but not a SOL amount sitting next to % chips', () => {
    expect(read('<input placeholder="Amount %" value="75" /><button id="go">Sell</button>')).toBe(75);
    expect(read('<div><input placeholder="Amount" value="0.5" /><span>SOL</span></div><button>25%</button><button id="go">Sell</button>')).toBeNull();
  });
});
