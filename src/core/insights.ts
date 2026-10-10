import type { MoodTag, RuleId, TradeRecord } from './types';

export interface Insight {
  tone: 'warn' | 'good' | 'info';
  text: string;
}

export interface Stats {
  total: number;
  graded: number;
  winRate: number | null;
  pnl: number;
  overrides: number;
  overrideWinRate: number | null;
  cleanWinRate: number | null;
  byMood: { label: string; n: number; winRate: number | null; pnl: number }[];
  byTag: { tag: MoodTag; n: number; lossRate: number }[];
  ruleCounts: Partial<Record<RuleId, number>>;
}

const winRate = (ts: TradeRecord[]) => {
  const g = ts.filter((t) => t.outcome);
  return g.length ? g.filter((t) => t.outcome === 'win').length / g.length : null;
};
const sumPnl = (ts: TradeRecord[]) => ts.reduce((s, t) => s + (t.pnl ?? 0), 0);
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function computeStats(trades: TradeRecord[]): Stats {
  const graded = trades.filter((t) => t.outcome);
  const buckets: [string, (t: TradeRecord) => boolean][] = [
    ['Low (1–2)', (t) => t.moodScore != null && t.moodScore <= 2],
    ['Neutral (3)', (t) => t.moodScore === 3],
    ['Good (4–5)', (t) => t.moodScore != null && t.moodScore >= 4],
    ['No check-in', (t) => t.moodScore == null],
  ];
  const tagMap = new Map<MoodTag, TradeRecord[]>();
  for (const t of graded) for (const tag of t.moodTags) tagMap.set(tag, [...(tagMap.get(tag) ?? []), t]);

  const ruleCounts: Partial<Record<RuleId, number>> = {};
  for (const t of trades) for (const r of t.hits) ruleCounts[r] = (ruleCounts[r] ?? 0) + 1;

  const overrode = trades.filter((t) => t.overrode);
  const clean = trades.filter((t) => !t.overrode && t.hits.length === 0);

  return {
    total: trades.length,
    graded: graded.length,
    winRate: winRate(trades),
    pnl: sumPnl(trades),
    overrides: overrode.length,
    overrideWinRate: winRate(overrode),
    cleanWinRate: winRate(clean),
    byMood: buckets.map(([label, f]) => {
      const ts = trades.filter(f);
      return { label, n: ts.filter((t) => t.outcome).length, winRate: winRate(ts), pnl: sumPnl(ts) };
    }),
    byTag: [...tagMap.entries()]
      .map(([tag, ts]) => ({ tag, n: ts.length, lossRate: ts.filter((t) => t.outcome === 'loss').length / ts.length }))
      .sort((a, b) => b.lossRate - a.lossRate),
    ruleCounts,
  };
}

/** Turn stats into a few plain-language observations. Needs a minimum sample to say anything. */
export function insights(trades: TradeRecord[], minSample = 3): Insight[] {
  const s = computeStats(trades);
  const out: Insight[] = [];
  if (s.graded < minSample) {
    out.push({ tone: 'info', text: `Log the outcome of ${minSample - s.graded} more trade(s) and patterns will start showing up here.` });
    return out;
  }
  const baseLoss = 1 - (s.winRate ?? 0);

  for (const t of s.byTag) {
    if (t.n >= minSample && t.lossRate >= baseLoss + 0.15) {
      out.push({ tone: 'warn', text: `When you check in as “${t.tag}”, you lose ${pct(t.lossRate)} of trades, against ${pct(baseLoss)} overall. That's a signal to sit out.` });
    }
  }

  const ov = trades.filter((t) => t.overrode && t.outcome);
  if (ov.length >= minSample && s.overrideWinRate != null) {
    const cmp = s.cleanWinRate != null ? ` vs ${pct(s.cleanWinRate)} on trades that broke no rules` : '';
    out.push({
      tone: s.cleanWinRate != null && s.overrideWinRate < s.cleanWinRate ? 'warn' : 'info',
      text: `Trades where you overrode a warning win ${pct(s.overrideWinRate)} of the time${cmp}.`,
    });
  }

  const low = s.byMood[0];
  const good = s.byMood[2];
  if (low.n >= minSample && good.n >= minSample && low.winRate != null && good.winRate != null && good.winRate - low.winRate >= 0.1) {
    out.push({ tone: 'warn', text: `Your win rate is ${pct(good.winRate)} when you feel good and ${pct(low.winRate)} when you feel low. Your mood is part of your edge.` });
  }

  const top = Object.entries(s.ruleCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  if (top && (top[1] ?? 0) >= minSample) {
    out.push({ tone: 'info', text: `Your most-triggered rule is “${top[0]}” (${top[1]} times). That's the habit to work on this week.` });
  }

  if (!out.length) out.push({ tone: 'good', text: 'No strong negative patterns yet. Keep logging check-ins and outcomes.' });
  return out;
}
