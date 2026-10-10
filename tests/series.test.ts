import { describe, expect, it } from 'vitest';
import { summarize, type Sample } from '../src/core/series';

const MIN = 60_000;
const T0 = new Date('2026-10-10T16:00:00').getTime();

/** One sample per 20s, linearly interpolated between (minute, price) waypoints. */
function path(points: [number, number][]): Sample[] {
  const out: Sample[] = [];
  for (let i = 1; i < points.length; i++) {
    const [m0, p0] = points[i - 1];
    const [m1, p1] = points[i];
    for (let t = m0 * MIN; t < m1 * MIN; t += 20_000) out.push({ ts: T0 + t, price: p0 + ((p1 - p0) * (t - m0 * MIN)) / ((m1 - m0) * MIN) });
  }
  const [mL, pL] = points[points.length - 1];
  out.push({ ts: T0 + mL * MIN, price: pL });
  return out;
}

describe('summarize', () => {
  it('reads lower highs and lower lows as a downtrend (the post-ATH bleed)', () => {
    // 393K top → 95K → 280K → 75K → 215K → 80K → 155K → 113K
    const s = path([[0, 200], [5, 393], [12, 95], [17, 280], [22, 75], [27, 215], [32, 80], [37, 155], [42, 113]]);
    const sum = summarize(s, T0 + 42 * MIN)!;
    expect(sum.trend).toBe('down');
    expect(sum.swingHighs.map(Math.round)).toEqual([393, 280, 215, 155]);
    expect(Math.round(sum.high)).toBe(393);
    expect(Math.round(sum.fromHighPct)).toBe(-71);
  });

  it('reads higher highs and higher lows as an uptrend', () => {
    const s = path([[0, 10], [4, 20], [8, 14], [12, 30], [16, 22], [20, 45], [24, 35], [26, 40]]);
    expect(summarize(s, T0 + 26 * MIN)!.trend).toBe('up');
  });

  it('computes moves only when there is enough history', () => {
    const s = path([[0, 100], [3, 150]]);
    const sum = summarize(s, T0 + 3 * MIN)!;
    expect(sum.moves.m1!).toBeCloseTo(12.5, 0);
    expect(sum.moves.m5).toBeNull();
    expect(sum.trend).toBe('unknown');
  });

  it('needs at least two samples', () => {
    expect(summarize([{ ts: T0, price: 1 }], T0)).toBeNull();
  });
});
