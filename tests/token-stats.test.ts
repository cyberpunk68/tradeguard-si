// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFlowStats, readTokenStats, tokenAddressFromUrl } from '../src/adapters/heuristics';

describe('tokenAddressFromUrl', () => {
  it('finds addresses in Axiom, GMGN and BullX style URLs', () => {
    const mint = 'ESzZ5k3GDeeFJZxdsaqHUn9MKD6uMG1HYbBHHhv5pump';
    expect(tokenAddressFromUrl({ pathname: `/meme/${mint}`, search: '' })).toBe(mint);
    expect(tokenAddressFromUrl({ pathname: `/sol/token/${mint}`, search: '' })).toBe(mint);
    expect(tokenAddressFromUrl({ pathname: '/terminal', search: `?chainId=1399811149&address=${mint}` })).toBe(mint);
    expect(tokenAddressFromUrl({ pathname: '/discover', search: '' })).toBeNull();
  });
});

describe('readTokenStats', () => {
  it('reads Axiom-style token info tiles (value above label)', () => {
    document.body.innerHTML = `
      <header><span>Liquidity</span><span>$412.5K</span><span>MC</span><span>$2.1M</span></header>
      <section class="token-info">
        <div class="tile"><span>18.24%</span><span>Top 10 H.</span></div>
        <div class="tile"><span>0%</span><span>Dev H.</span></div>
        <div class="tile"><span>2.1%</span><span>Snipers H.</span></div>
        <div class="tile"><span>1.3%</span><span>Insiders</span></div>
        <div class="tile"><span>4%</span><span>Bundlers</span></div>
        <div class="tile"><span>100%</span><span>LP Burned</span></div>
        <div class="tile"><span>1,204</span><span>Holders</span></div>
      </section>
      <footer>SOL $152.40</footer>`;
    const t = readTokenStats();
    expect(t).toMatchObject({ top10Pct: 18.24, devHoldPct: 0, snipersPct: 2.1, insidersPct: 1.3, bundlersPct: 4, lpBurnedPct: 100, liquidityUsd: 412_500, marketCapUsd: 2_100_000, solUsd: 152.4 });
  });

  it('handles label-then-value rows and leaves missing stats null', () => {
    document.body.innerHTML = `<ul><li><b>Top 10 Holders</b> <i>31%</i></li><li><b>LP Burnt</b> <i>0%</i></li></ul>`;
    const t = readTokenStats();
    expect(t.top10Pct).toBe(31);
    expect(t.lpBurnedPct).toBe(0);
    expect(t.devHoldPct).toBeNull();
    expect(t.liquidityUsd).toBeNull();
  });
});

describe('readFlowStats', () => {
  it('reads 5m volume, buys/sells and net flow', () => {
    document.body.innerHTML = `
      <div class="flow">
        <div><span>5m Vol</span><span>$11.1K</span></div>
        <div><span>Buys</span><span>108 / $5.84K</span></div>
        <div><span>Sells</span><span>103 / $5.21K</span></div>
        <div><span>Net Vol.</span><span>+$626</span></div>
      </div>`;
    expect(readFlowStats()).toEqual({ volUsd: 11_100, buys: 108, buysUsd: 5_840, sells: 103, sellsUsd: 5_210, netUsd: 626 });
  });

  it('derives net from buys and sells when the page has no net figure, and handles negative flow', () => {
    document.body.innerHTML = `<p><b>Buys</b> 40 / $2K</p><p><b>Sells</b> 90 / $6.5K</p>`;
    expect(readFlowStats()?.netUsd).toBe(-4_500);
  });

  it('returns null when the page shows no flow', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    expect(readFlowStats()).toBeNull();
  });
});

describe('prediction-market order buttons', () => {
  it('recognizes Buy Yes / Buy No and ignores navigation', async () => {
    const { ADAPTERS } = await import('../src/adapters');
    const poly = ADAPTERS.find((a) => a.id === 'polymarket')!;
    document.body.innerHTML = `<button id="y">Buy Yes 62¢</button><button id="n">Buy No</button><a href="/markets" id="nav">Markets</a>`;
    expect(poly.findOrderControl(document.getElementById('y'))).not.toBeNull();
    expect(poly.findOrderControl(document.getElementById('n'))).not.toBeNull();
    expect(poly.findOrderControl(document.getElementById('nav'))).toBeNull();
  });
});
