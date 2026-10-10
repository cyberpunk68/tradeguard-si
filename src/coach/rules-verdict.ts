// Rules-first verdict: when TradeGuard SI's own rules already decide the answer, show the card
// instantly and skip the AI call entirely. Pure (no chrome.* APIs), shared with the server.
import { scamFindings } from '../core/token-rules';
import type { Lockout, ScamReport, Settings } from '../core/types';
import type { VerdictCard } from './verdict';

export interface RulesInput {
  settings: Settings;
  lockout: Lockout | null;
  scam: ScamReport | null;
  /** Local preview of a buy at the current size (extension only). */
  preview?: { level: number; hits: { rule: string; title: string; points?: string[] }[] } | null;
  now?: number;
}

const clip = (s: string) => (s.length > 120 ? s.slice(0, 117) + '…' : s);

export function rulesVerdict(i: RulesInput): VerdictCard | null {
  const now = i.now ?? Date.now();

  if (i.lockout && i.lockout.until > now) {
    const mins = Math.ceil((i.lockout.until - now) / 60_000);
    return { verdict: 'no_trade', headline: `Locked out: ${mins} min left`, reasons: [clip(i.lockout.reason)], next: 'Close the chart and step away until the timer ends' };
  }

  if (i.scam && i.settings.scamCheckEnabled) {
    const { severity, reasons } = scamFindings(i.scam, i.settings);
    if (i.scam.risk === 'extreme' || severity >= 3) {
      return {
        verdict: 'avoid',
        headline: i.scam.risk === 'extreme' ? 'Likely scam: bundled launch' : 'Bundled launch: high risk',
        reasons: reasons.slice(0, 3).map(clip),
        next: 'Skip it. There are better launches today',
      };
    }
  }

  const gate = i.preview?.hits.find((h) => h.rule === 'gate' && (h.points?.length ?? 0) > 0);
  if (gate && i.settings.gateEnabled) {
    return { verdict: 'avoid', headline: 'Fails your entry gate', reasons: (gate.points ?? []).slice(0, 3).map(clip), next: 'Skip it. Your gate exists for exactly this' };
  }

  if (i.preview && i.preview.level >= 4) {
    const h = i.preview.hits[0];
    return { verdict: 'no_trade', headline: h ? clip(h.title) : 'Blocked by your rules', reasons: (h?.points ?? []).slice(0, 3).map(clip), next: 'Respect the block. Review what triggered it' };
  }

  return null; // the rules don't settle it: ask the coach
}
