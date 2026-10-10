// Pure normalization of Is It Bundled? token responses (shared by the extension and the server).
import type { ScamReport, ScamRisk } from '../core/types';

const RISKS: ScamRisk[] = ['low', 'medium', 'high', 'extreme'];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 64) : null);

/** Only http(s) links from the API are rendered; anything else falls back to the site root. */
function safeUrl(v: unknown, base: string): string {
  try {
    const u = new URL(String(v));
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch {}
  return base;
}

export function normalizeReport(j: Record<string, unknown>, address: string, base: string): ScamReport {
  return {
    address,
    status: str(j.status) ?? 'unscanned',
    risk: RISKS.includes(j.risk as ScamRisk) ? (j.risk as ScamRisk) : null,
    symbol: str(j.symbol),
    bundledPct: num(j.bundledPct),
    firstSecondPct: num(j.firstSecondPct),
    devBoughtPct: num(j.devBoughtPct),
    insidersHoldPct: num(j.insidersHoldPct),
    flaggedHoldPct: num(j.flaggedHoldPct),
    bundleWallets: num(j.bundleWallets),
    devLaunches7d: num(j.devLaunches7d),
    devBundled7d: num(j.devBundled7d),
    fundedTogether: num(j.fundedTogether),
    throwawayFunded: num(j.throwawayFunded),
    wokenWallets: num(j.wokenWallets),
    madeWithProxima: j.madeWithProxima === true,
    madeWithSumo: j.madeWithSumo === true,
    estimate: j.estimate === true,
    report: safeUrl(j.report, base),
    fetchedAt: Date.now(),
  };
}

