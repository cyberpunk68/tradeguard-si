// The fast decision card, shared by the extension coach, the on-page auto-check and the Telegram bot.
// Pure module (no chrome.* APIs, no SDK imports) so the server can import it too.

/** Structural match for the Messages API custom-tool shape (kept local so this file has no dependencies). */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

export const VERDICTS = ['avoid', 'no_trade', 'wait', 'fits_rules'] as const;
export type VerdictKind = (typeof VERDICTS)[number];
export interface VerdictCard {
  verdict: VerdictKind;
  headline: string;
  reasons: string[];
  watch?: string;
  next: string;
}

export const SHOW_VERDICT_TOOL: ToolDefinition = {
  name: 'show_verdict',
  description:
    'Show the trader a fast decision card. Use this FIRST whenever they ask about a token, chart, entry or trade they are considering. avoid = rigged/scam launch or fails safety; no_trade = safe enough but no setup under their rules; wait = setup could form, name the trigger; fits_rules = meets their gate, trigger and risk rules (not a recommendation to buy). Keep it scannable in 3 seconds.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: [...VERDICTS] },
      headline: { type: 'string', description: 'Max ~8 words, e.g. "Passes gate, fails entry trigger".' },
      reasons: { type: 'array', items: { type: 'string' }, maxItems: 3, description: 'Up to 3 reasons, each under 12 words, with the key number.' },
      watch: { type: 'string', description: 'The one level or trigger that would change the verdict, e.g. "$155K break with 3 green 1m candles".' },
      next: { type: 'string', description: 'One concrete action doable in under a minute.' },
    },
    required: ['verdict', 'headline', 'reasons', 'next'],
    additionalProperties: false,
  },
};

/** Validate and clamp model-produced card fields (never trust lengths or enum values). */
export function normalizeVerdict(input: Record<string, unknown>): VerdictCard | null {
  const v = input as unknown as VerdictCard;
  if (!VERDICTS.includes(v.verdict)) return null;
  return {
    verdict: v.verdict,
    headline: String(v.headline ?? '').slice(0, 90),
    reasons: (Array.isArray(v.reasons) ? v.reasons : []).slice(0, 3).map((r) => String(r).slice(0, 140)),
    watch: v.watch ? String(v.watch).slice(0, 140) : undefined,
    next: String(v.next ?? '').slice(0, 140),
  };
}
