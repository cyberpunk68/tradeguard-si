// Site adapters. To support a new venue:
//   1. Add a config below (host regex, wording on its order buttons, spot/perp, quote unit).
//   2. Add its origin to `host_permissions` + `content_scripts.matches` in public/manifest.json
//      (or just add it from the options page under "Custom sites", which uses the generic adapter).
//   3. Open the site, press an order button, and check the overlay shows the right size/leverage.
//      If it doesn't, add `panel` / `priceSelector` / `balanceSelector` hints.
//
// Selectors here are hints, not requirements: every adapter falls back to label/text heuristics.
import { createAdapter, type SiteAdapter } from './heuristics';
import { STORE_BUILD } from '../config';

// Order-button wording. Anchored so "Buy crypto" nav links or "Sell-side liquidity" labels don't match.
const SPOT = /^(buy|sell)(\s+[A-Z0-9$]{1,12})?(\s*[\d.,]+\s*\w*)?$|^(place|submit|confirm) (order|buy|sell)$|^(market|limit) (buy|sell)$/i;
// Memecoin terminals: "Buy", "Buy 0.5 SOL", "Quick Buy", "Sell 50%", instant-trade buttons. Amounts in SOL.
const MEME = /^(instant\s+|quick\s*)?(buy|sell)\b.{0,24}$|^(quick\s*)?buy\s*[\d.]+$/i;
const SWAP = /^(swap|confirm swap|instant swap|buy|sell|place order|confirm)$/i;
const PREDICTION = /^(buy|sell)\s+(yes|no)\b.{0,24}$|^(buy|sell)$|^(place|submit|confirm)\s+(order|trade|bet)$|^trade$|^confirm$/i;
const PERP = /^(buy|sell|long|short|open long|open short|buy\s*\/\s*long|sell\s*\/\s*short|place order|confirm|submit order)(\s+[A-Z0-9$]{1,12})?$/i;

export const ADAPTERS: SiteAdapter[] = [
  createAdapter({
    id: 'axiom',
    name: 'Axiom',
    host: /(^|\.)axiom\.trade$/,
    orderText: MEME,
    market: 'spot',
    unit: 'SOL',
    token: true,
  }),
  createAdapter({ id: 'photon', name: 'Photon', host: /(^|\.)photon-sol\.tinyastro\.io$/, orderText: MEME, market: 'spot', unit: 'SOL', token: true }),
  createAdapter({ id: 'gmgn', name: 'GMGN', host: /(^|\.)gmgn\.ai$/, orderText: MEME, market: 'spot', unit: 'SOL', token: true }),
  createAdapter({ id: 'bullx', name: 'BullX', host: /(^|\.)bullx\.io$/, orderText: MEME, market: 'spot', unit: 'SOL', token: true }),
  createAdapter({ id: 'binance', name: 'Binance', host: /(^|\.)binance\.(com|us)$/, orderText: new RegExp(`${SPOT.source}|${PERP.source}`, 'i'), market: 'url', unit: 'USD' }),
  createAdapter({ id: 'bybit', name: 'Bybit', host: /(^|\.)bybit\.com$/, orderText: new RegExp(`${SPOT.source}|${PERP.source}`, 'i'), market: 'url', unit: 'USD' }),
  createAdapter({ id: 'okx', name: 'OKX', host: /(^|\.)okx\.com$/, orderText: new RegExp(`${SPOT.source}|${PERP.source}`, 'i'), market: 'url', unit: 'USD' }),
  createAdapter({ id: 'coinbase', name: 'Coinbase Advanced', host: /(^|\.)coinbase\.com$/, orderText: SPOT, orderScope: undefined, market: 'spot', unit: 'USD' }),
  createAdapter({ id: 'kraken', name: 'Kraken Pro', host: /(^|\.)kraken\.com$/, orderText: new RegExp(`${SPOT.source}|${PERP.source}`, 'i'), market: 'url', unit: 'USD' }),
  createAdapter({ id: 'hyperliquid', name: 'Hyperliquid', host: /(^|\.)hyperliquid\.xyz$/, orderText: PERP, market: 'perp', unit: 'USD' }),
  // Prediction markets: same harms (chasing a spiking contract, longshots, loss streaks). Prices are in cents/USD.
  createAdapter({ id: 'polymarket', name: 'Polymarket', host: /(^|\.)polymarket\.com$/, orderText: PREDICTION, market: 'spot', unit: 'USD' }),
  createAdapter({ id: 'kalshi', name: 'Kalshi', host: /(^|\.)kalshi\.com$/, orderText: PREDICTION, market: 'spot', unit: 'USD' }),
  // On-chain stocks (xStocks, Ondo…) and stock apps: same sizing, loss-limit and chase rules.
  createAdapter({ id: 'jupiter', name: 'Jupiter', host: /(^|\.)jup\.ag$/, orderText: SWAP, market: 'spot', unit: 'USD' }),
  createAdapter({ id: 'robinhood', name: 'Robinhood', host: /(^|\.)robinhood\.com$/, orderText: new RegExp(`${SPOT.source}|^(review|submit|place) order$|^swipe up to submit$`, 'i'), market: 'spot', unit: 'USD' }),
  // ARC Terminal: AI execution layer on top of Hyperliquid perps; trading lives on trade.arcterminal.ai.
  createAdapter({ id: 'arc', name: 'ARC Terminal', host: /(^|\.)arcterminal\.ai$/, orderText: new RegExp(`${PERP.source}|^(execute|send)( trade| order)?$`, 'i'), market: 'perp', unit: 'USD' }),
];

/** Used for the local mock exchange and any custom site the trader adds. */
export const GENERIC = createAdapter({
  id: 'generic',
  name: 'Generic',
  host: /.*/,
  orderText: new RegExp(`${SPOT.source}|${PERP.source}`, 'i'),
  market: 'url',
  unit: 'USD',
});

export function adapterFor(host: string, disabled: string[] = [], path = '/'): SiteAdapter | null {
  // Test harness hook: on localhost, /axiom/<mint> etc. runs that venue's adapter against the mock pages.
  const local = !STORE_BUILD && /^(localhost|127\.0\.0\.1)$/.test(host) ? ADAPTERS.find((x) => path.split('/')[1] === x.id) : undefined;
  const a = local ?? ADAPTERS.find((x) => x.matches(host)) ?? GENERIC;
  return disabled.includes(a.id) ? null : a;
}
