// Subscription plans and what each unlocks. Shared by the extension (to show/gate features) and
// the backend (to enforce limits). Prices live in Stripe; the numbers here are display + limits.
//
// Bring-your-own-key works on every plan and is never metered: the trader pays Anthropic directly.
// Limits below apply only to the hosted coach (our key).

export type PlanId = 'free' | 'pro' | 'ultra';
export type UsageKind = 'autoCheck' | 'chat' | 'deepReview';

export interface Plan {
  id: PlanId;
  name: string;
  priceUsd: number;
  tagline: string;
  features: string[];
  limits: {
    /** Hosted AI (no key needed). False = coach only with your own key. */
    hostedAI: boolean;
    autoChecksPerMonth: number;
    chatMessagesPerMonth: number;
    /** Opus-class deep reviews. */
    deepReviewsPerMonth: number;
    /** Chart screenshot attached to every auto-check, not just manual quick checks. */
    chartOnAutoCheck: boolean;
    telegram: boolean;
    sync: boolean;
    historyDays: number;
  };
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    tagline: 'Every guardrail, on your machine.',
    features: [
      'Order blocking: size, leverage, overtrading, revenge, chasing',
      'Memecoin entry gate + bundled-launch scam check',
      'Lockouts, commitment mode, mood check-ins, dashboard',
      'AI coach with your own Anthropic key',
    ],
    limits: { hostedAI: false, autoChecksPerMonth: 0, chatMessagesPerMonth: 0, deepReviewsPerMonth: 0, chartOnAutoCheck: false, telegram: false, sync: false, historyDays: 30 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceUsd: 19,
    tagline: 'The coach, hosted, everywhere you trade.',
    features: [
      'Everything in Free',
      'Hosted AI coach, no API key needed',
      '300 auto-checks + 200 coach messages / month',
      'Telegram bot: token checks, /lock, /checkin, alerts',
      'Sync: a lockout in Chrome locks Telegram too',
    ],
    limits: { hostedAI: true, autoChecksPerMonth: 300, chatMessagesPerMonth: 200, deepReviewsPerMonth: 0, chartOnAutoCheck: false, telegram: true, sync: true, historyDays: 180 },
  },
  ultra: {
    id: 'ultra',
    name: 'Ultra',
    priceUsd: 29,
    tagline: 'For traders who live in the terminal.',
    features: [
      'Everything in Pro',
      'Opus deep reviews: 40 / month',
      'Chart read on every auto-check',
      '1,000 auto-checks + 600 coach messages / month',
      'Weekly performance review delivered to Telegram',
      'Unlimited history',
    ],
    limits: { hostedAI: true, autoChecksPerMonth: 1000, chatMessagesPerMonth: 600, deepReviewsPerMonth: 40, chartOnAutoCheck: true, telegram: true, sync: true, historyDays: 36500 },
  },
};

export type Usage = Record<UsageKind, number>;

export type Allowance =
  | { ok: true; metered: boolean; remaining: number | null }
  | { ok: false; reason: string; upgradeTo: PlanId | null };

const LIMIT_KEY: Record<UsageKind, keyof Plan['limits']> = {
  autoCheck: 'autoChecksPerMonth',
  chat: 'chatMessagesPerMonth',
  deepReview: 'deepReviewsPerMonth',
};
const LABEL: Record<UsageKind, string> = { autoCheck: 'auto-checks', chat: 'coach messages', deepReview: 'deep reviews' };

/** The cheapest plan above `from` that allows more of `kind`. */
function upgradeFor(from: PlanId, kind: UsageKind): PlanId | null {
  const order: PlanId[] = ['free', 'pro', 'ultra'];
  const cur = PLANS[from].limits[LIMIT_KEY[kind]] as number;
  return order.slice(order.indexOf(from) + 1).find((p) => (PLANS[p].limits[LIMIT_KEY[kind]] as number) > cur) ?? null;
}

/** May this account use the coach for `kind` right now? BYOK is always allowed and never metered. */
export function allowance(planId: PlanId, usage: Usage, kind: UsageKind, byok: boolean): Allowance {
  if (byok) return { ok: true, metered: false, remaining: null };
  const plan = PLANS[planId];
  if (!plan.limits.hostedAI) {
    return { ok: false, reason: 'The hosted coach is part of Pro and Ultra. Add your own Anthropic key to use the coach on Free.', upgradeTo: 'pro' };
  }
  const limit = plan.limits[LIMIT_KEY[kind]] as number;
  const used = usage[kind] ?? 0;
  if (used >= limit) {
    const up = upgradeFor(planId, kind);
    return {
      ok: false,
      reason: limit === 0 ? `${cap(LABEL[kind])} are an ${up ? PLANS[up].name : 'upgrade'} feature.` : `You've used all ${limit} ${LABEL[kind]} this month. They reset on your billing date.`,
      upgradeTo: up,
    };
  }
  return { ok: true, metered: true, remaining: limit - used - 1 };
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
