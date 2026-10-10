import { describe, expect, it } from 'vitest';
import { closedPositions, parseTransaction, type ChainTx } from '../src/onchain/solana-pnl';

const W = 'Wa11et1111111111111111111111111111111111111';
const ARENA = 'ARENAmint111111111111111111111111111111pump';
const SPACE = 'SPACEXSImint1111111111111111111111111111pump';

/** Minimal getTransaction-shaped fixture. */
function raw(sig: string, t: number, solBefore: number, solAfter: number, mint: string | null, tokBefore: number, tokAfter: number, extraKeys: string[] = []) {
  const bal = (amt: number) => (mint ? [{ owner: W, mint, uiTokenAmount: { uiAmountString: String(amt) } }] : []);
  return {
    blockTime: t,
    transaction: { signatures: [sig], message: { accountKeys: [...extraKeys, W, 'Router1111111111111111111111111111111111111'] } },
    meta: {
      err: null,
      preBalances: [...extraKeys.map(() => 0), Math.round(solBefore * 1e9), 0],
      postBalances: [...extraKeys.map(() => 0), Math.round(solAfter * 1e9), 0],
      preTokenBalances: bal(tokBefore),
      postTokenBalances: bal(tokAfter),
    },
  };
}

describe('parseTransaction', () => {
  it('reads the wallet SOL change (fees included) and its token change', () => {
    const tx = parseTransaction(raw('s1', 100, 2.057, 1.0566, ARENA, 0, 5_000_000), W)!;
    expect(tx.solDelta).toBeCloseTo(-1.0004, 6);
    expect(tx.tokenDeltas[ARENA]).toBe(5_000_000);
  });
  it('finds the wallet among static keys even when not first', () => {
    expect(parseTransaction(raw('s2', 100, 1, 0.9, ARENA, 0, 10, ['Payer11111111111111111111111111111111111111']), W)?.solDelta).toBeCloseTo(-0.1, 6);
  });
  it('ignores transactions that do not involve the wallet', () => {
    expect(parseTransaction(raw('s3', 100, 1, 0.9, ARENA, 0, 10), 'Someone1111111111111111111111111111111111111')).toBeNull();
  });
});

describe('closedPositions — the 14-minute session', () => {
  // ARENA: three round trips (loss, win, loss); SPACEXSI: one loss. Mirrors the real session shape.
  const txs: ChainTx[] = [
    { t: 1, sol: -1.0, mint: ARENA, d: 1000, post: 1000 },
    { t: 2, sol: +0.75, mint: ARENA, d: -1000, post: 0 },
    { t: 3, sol: -1.0, mint: ARENA, d: 900, post: 900 },
    { t: 4, sol: +1.12, mint: ARENA, d: -900, post: 0 },
    { t: 5, sol: -1.0, mint: ARENA, d: 1100, post: 1100 },
    { t: 6, sol: +0.82, mint: ARENA, d: -1100, post: 0 },
    { t: 7, sol: -0.75, mint: SPACE, d: 500, post: 500 },
    { t: 8, sol: +0.5625, mint: SPACE, d: -500, post: 0 },
  ].map((x, i) => ({ signature: `sig${i}`, blockTime: x.t * 60, solDelta: x.sol, tokenDeltas: { [x.mint]: x.d }, tokenPost: { [x.mint]: x.post }, failed: false }));

  it('splits repeat entries on the same token into separate closed positions', () => {
    const c = closedPositions(txs);
    expect(c.map((p) => [p.mint === ARENA ? 'ARENA' : 'SPACE', p.pnlSol])).toEqual([
      ['ARENA', -0.25], ['ARENA', 0.12], ['ARENA', -0.18], ['SPACE', -0.1875],
    ]);
    expect(c.reduce((s, p) => s + p.pnlSol, 0)).toBeCloseTo(-0.4975, 6);
  });

  it('partial sells keep the position open until the balance is ~0', () => {
    const partial: ChainTx[] = [
      { signature: 'a', blockTime: 1, solDelta: -1, tokenDeltas: { [ARENA]: 100 }, tokenPost: { [ARENA]: 100 }, failed: false },
      { signature: 'b', blockTime: 2, solDelta: 0.6, tokenDeltas: { [ARENA]: -40 }, tokenPost: { [ARENA]: 60 }, failed: false },
    ];
    expect(closedPositions(partial)).toEqual([]);
    partial.push({ signature: 'c', blockTime: 3, solDelta: 0.7, tokenDeltas: { [ARENA]: -60 }, tokenPost: { [ARENA]: 0 }, failed: false });
    expect(closedPositions(partial)[0].pnlSol).toBeCloseTo(0.3, 6);
  });

  it('skips failed and multi-token transactions, and sells of tokens bought before the window', () => {
    expect(closedPositions([
      { signature: 'x', blockTime: 1, solDelta: 0.5, tokenDeltas: { [ARENA]: -10 }, tokenPost: { [ARENA]: 0 }, failed: false },
      { signature: 'y', blockTime: 2, solDelta: -1, tokenDeltas: { [ARENA]: 10, [SPACE]: 5 }, tokenPost: { [ARENA]: 10, [SPACE]: 5 }, failed: false },
      { signature: 'z', blockTime: 3, solDelta: -1, tokenDeltas: { [SPACE]: 5 }, tokenPost: { [SPACE]: 5 }, failed: true },
    ])).toEqual([]);
  });
});

import { mergeClosed } from '../src/onchain/merge';
import type { TradeRecord } from '../src/core/types';

describe('mergeClosed', () => {
  const pos = (sig: string, mint: string, open: number, close: number, pnl: number) => ({ mint, openedAt: open, closedAt: close, solIn: 1, solOut: 1 + pnl, pnlSol: pnl, buys: 1, sells: 1, signatures: [sig] });
  const click = (id: string, token: string, ts: number): TradeRecord => ({ id, ts, site: 'axiom', symbol: 'X', token, side: 'buy', unit: 'SOL', notional: 1, leverage: null, friction: 0, hits: [], overrode: false, moodScore: null, moodTags: [] });

  it('logs the result on the matching click and folds extra buys into it', () => {
    const r = mergeClosed([click('a', 'M1', 1000), click('b', 'M1', 2000)], [pos('S1', 'M1', 900, 5000, -0.25)]);
    const a = r.trades.find((t) => t.id === 'a')!;
    const b = r.trades.find((t) => t.id === 'b')!;
    expect(b).toMatchObject({ outcome: 'loss', pnl: -0.25, pnlUnit: 'SOL', chainId: 'S1' });
    expect(a.partOf).toBe('b');
    expect(a.outcome).toBeUndefined();
  });
  it('creates a record for trades made with the extension off, so caps still count them', () => {
    const r = mergeClosed([], [pos('S2', 'M2', 1000, 2000, -0.19)]);
    expect(r.trades[0]).toMatchObject({ source: 'chain', token: 'M2', outcome: 'loss', pnl: -0.19 });
  });
  it('never logs the same position twice', () => {
    const once = mergeClosed([], [pos('S3', 'M3', 1, 2, 0.1)]);
    expect(mergeClosed(once.trades, [pos('S3', 'M3', 1, 2, 0.1)]).added).toHaveLength(0);
  });
});
