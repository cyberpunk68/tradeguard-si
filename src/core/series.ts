// Turns the content script's raw price samples (every ~3s while the tab is open) into the
// structure a trader reads off a chart: % moves, session high/low, swing highs/lows, trend.
// "Price" is whatever the venue puts in the tab title, which on memecoin terminals is often market cap.

export interface Sample {
  ts: number;
  price: number;
}

export interface SeriesSummary {
  last: number;
  /** Minutes of history we actually have. */
  minutes: number;
  samples: number;
  moves: { m1: number | null; m5: number | null; m15: number | null; h1: number | null };
  high: number;
  low: number;
  /** % below the session high (negative). */
  fromHighPct: number;
  /** Recent swing pivots on 1-minute bars, oldest → newest (max 4 each). */
  swingHighs: number[];
  swingLows: number[];
  trend: 'up' | 'down' | 'range' | 'unknown';
}

const MIN = 60_000;
const pct = (from: number, to: number) => ((to - from) / from) * 100;

/** % change from `minAgo` minutes ago, or null if we don't have that much history. */
function moveSince(samples: Sample[], now: number, minAgo: number): number | null {
  const t = now - minAgo * MIN;
  if (samples[0].ts > t + 10_000) return null;
  let ref = samples[0];
  for (const s of samples) {
    if (s.ts > t) break;
    ref = s;
  }
  return ref.price > 0 ? pct(ref.price, samples[samples.length - 1].price) : null;
}

interface Bar {
  high: number;
  low: number;
}

function minuteBars(samples: Sample[]): Bar[] {
  const bars = new Map<number, Bar>();
  for (const s of samples) {
    const k = Math.floor(s.ts / MIN);
    const b = bars.get(k);
    if (!b) bars.set(k, { high: s.price, low: s.price });
    else {
      b.high = Math.max(b.high, s.price);
      b.low = Math.min(b.low, s.price);
    }
  }
  return [...bars.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
}

/** Pivot = bar whose high (low) beats `k` bars on each side. */
function pivots(bars: Bar[], key: 'high' | 'low', k = 2): number[] {
  const out: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    const v = bars[i][key];
    let ok = true;
    for (let j = i - k; j <= i + k && ok; j++) {
      if (j === i) continue;
      ok = key === 'high' ? v > bars[j].high : v < bars[j].low;
    }
    if (ok) out.push(v);
  }
  return out.slice(-4);
}

function trendOf(highs: number[], lows: number[]): SeriesSummary['trend'] {
  if (highs.length < 2 || lows.length < 2) return 'unknown';
  const h = highs.slice(-3);
  const l = lows.slice(-2);
  // Highs define the direction; a low within 10% of the previous one doesn't break it
  // (lower highs over a flat-ish floor is still a bleed).
  const down = h.every((v, i) => i === 0 || v < h[i - 1]) && l[1] <= l[0] * 1.1;
  const up = h.every((v, i) => i === 0 || v > h[i - 1]) && l[1] >= l[0] * 0.9;
  return down ? 'down' : up ? 'up' : 'range';
}

export function summarize(samples: Sample[], now: number): SeriesSummary | null {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1].price;
  const prices = samples.map((s) => s.price);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const bars = minuteBars(samples);
  const swingHighs = pivots(bars, 'high');
  const swingLows = pivots(bars, 'low');
  return {
    last,
    minutes: Math.round((samples[samples.length - 1].ts - samples[0].ts) / MIN),
    samples: samples.length,
    moves: { m1: moveSince(samples, now, 1), m5: moveSince(samples, now, 5), m15: moveSince(samples, now, 15), h1: moveSince(samples, now, 60) },
    high,
    low,
    fromHighPct: pct(high, last),
    swingHighs,
    swingLows,
    trend: trendOf(swingHighs, swingLows),
  };
}
