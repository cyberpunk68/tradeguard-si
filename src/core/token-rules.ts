// Token-level rules for memecoin buys: your own entry gate (read off the page) and the
// launch/bundle scam check (Is It Bundled?). Both only apply to buys.
import type { FrictionLevel, RuleHit, ScamReport, Settings } from './types';
import type { Rule } from './rules';

const p = (n: number) => `${Math.round(n * 10) / 10}%`;
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);

export const gateRule: Rule = (ctx, s) => {
  const t = ctx.intent.token;
  if (!s.gateEnabled || !t || ctx.intent.side !== 'buy') return null;
  const fails: string[] = [];
  const unknown: string[] = [];

  const check = (v: number | null, label: string, ok: (v: number) => boolean, why: (v: number) => string) => {
    if (v == null) unknown.push(label);
    else if (!ok(v)) fails.push(why(v));
  };
  check(t.lpBurnedPct, 'LP burned', (v) => v >= s.gateLpBurnedMinPct, (v) => `LP burned is ${p(v)} (you require ${s.gateLpBurnedMinPct}%)`);
  check(t.devHoldPct, 'dev holding', (v) => v <= s.gateDevMaxPct, (v) => `dev still holds ${p(v)} (your max is ${s.gateDevMaxPct}%)`);
  check(t.top10Pct, 'top 10 holders', (v) => v <= s.gateTop10MaxPct, (v) => `top 10 wallets hold ${p(v)} (your max is ${s.gateTop10MaxPct}%)`);

  const parts = [t.snipersPct, t.bundlersPct, t.insidersPct];
  const known = parts.filter((v): v is number => v != null);
  check(known.length ? known.reduce((a, b) => a + b, 0) : null, 'snipers/bundlers/insiders', (v) => v <= s.gateInsidersMaxPct, (v) => `snipers + bundlers + insiders hold ${p(v)} combined (your max is ${s.gateInsidersMaxPct}%)`);

  const { notional, unit } = ctx.intent;
  const notionalUsd = notional == null ? null : unit === 'USD' ? notional : t.solUsd ? notional * t.solUsd : null;
  if (t.liquidityUsd == null || notionalUsd == null) unknown.push('liquidity vs size');
  else if (t.liquidityUsd < notionalUsd * s.gateMinLiquidityX) {
    fails.push(`liquidity is ${usd(t.liquidityUsd)}, only ${Math.floor(t.liquidityUsd / notionalUsd)}× your ${usd(notionalUsd)} order (you require ${s.gateMinLiquidityX}×)`);
  }

  const unverified = unknown.length ? ` Couldn't read: ${unknown.join(', ')}.` : '';
  if (fails.length) {
    return {
      rule: 'gate',
      severity: s.gateSeverity,
      title: 'Token fails your entry gate',
      message: `Your gate filters rugs before you look at the chart. This one fails ${fails.length} check${fails.length > 1 ? 's' : ''}.${unverified}`,
      points: fails.map(cap),
    };
  }
  if (unknown.length) {
    return {
      rule: 'gate',
      severity: s.gateBlockUnverified ? 2 : 1,
      title: 'Entry gate partly unverified',
      message: `TradeGuard SI couldn't verify part of your gate on this page (${unknown.join(', ')}). Check those yourself before you buy.`,
    };
  }
  return null;
};

const RISK_SEV: Record<string, FrictionLevel> = { medium: 2, high: 3, extreme: 3 };

export function scamFindings(r: ScamReport, s: Settings): { severity: FrictionLevel; reasons: string[] } {
  let severity: FrictionLevel = r.risk ? RISK_SEV[r.risk] ?? 0 : 0;
  if (r.risk === 'extreme' && s.scamBlockExtreme) severity = 4;
  const bump = (to: FrictionLevel) => (severity = Math.max(severity, to) as FrictionLevel);
  const reasons: string[] = [];

  if (r.bundledPct != null && r.bundledPct >= s.scamMaxBundledPct) {
    reasons.push(`${p(r.bundledPct)} of supply was bundled at launch (your max is ${s.scamMaxBundledPct}%)`);
    bump(r.bundledPct >= s.scamMaxBundledPct * 2 ? 3 : 2);
  }
  if (r.flaggedHoldPct != null && r.flaggedHoldPct >= s.scamMaxFlaggedHoldPct) {
    reasons.push(`insiders, bundlers and flagged wallets still hold ${p(r.flaggedHoldPct)} of supply`);
    bump(3);
  }
  if (r.madeWithProxima || r.madeWithSumo) {
    reasons.push(`launched with a bundling tool (${r.madeWithProxima ? 'Proxima' : 'Sumo'})`);
    bump(3);
  }
  if (r.devBundled7d != null && r.devBundled7d >= 2) {
    reasons.push(`this dev bundled ${r.devBundled7d} of ${r.devLaunches7d ?? '?'} launches in the past 7 days`);
    bump(3);
  }
  if (r.devLaunches7d != null && r.devLaunches7d >= 20) {
    reasons.push(`this dev launched ${r.devLaunches7d} tokens in the past 7 days`);
    bump(2);
  }
  if (r.fundedTogether) {
    reasons.push(`${r.fundedTogether} bundle wallets were funded within minutes of each other`);
    bump(2);
  }
  if (r.throwawayFunded) {
    reasons.push(`${r.throwawayFunded} wallets were funded through throwaway wallets`);
    bump(2);
  }
  return { severity, reasons };
}

export const scamRule: Rule = (ctx, s) => {
  if (!s.scamCheckEnabled || ctx.intent.side !== 'buy') return null;
  const r = ctx.intent.scam;
  if (!r) return null;
  const link = { href: r.report, label: 'Full report on Is It Bundled? ↗' };
  if (r.status === 'unscanned') {
    return {
      rule: 'scam',
      severity: 1,
      title: 'Launch not scanned yet',
      message: 'Is It Bundled? has no scan of this token yet, so its launch is unchecked. Open the report to run a scan before you buy.',
      link,
    };
  }
  const { severity, reasons } = scamFindings(r, s);
  if (severity === 0) return null;
  const riskTxt = r.risk ? `Is It Bundled? rates this launch ${r.risk.toUpperCase()} risk` : 'This launch looks manipulated';
  const hit: RuleHit = {
    rule: 'scam',
    severity,
    title: severity === 4 ? 'Likely scam. Buy blocked' : 'Bundled launch: scam risk',
    message: `${riskTxt}${r.estimate ? ' (early estimate)' : ''}. Insiders loaded up in the first second and need buyers to exit into.`,
    points: reasons.slice(0, 4).map(cap),
    link,
  };
  return hit;
};

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
