// Three token profiles keyed by mint. Tiles are what the page shows; the bundle verdict comes
// from the mock Is It Bundled? API in mock-server.mjs.
const TOKENS = {
  // Clean launch, passes the gate.
  GoodLaunch1111111111111111111111111111pump: { sym: 'GOOD', tiles: { 'Top 10 H.': '14.2%', 'Dev H.': '0%', 'Snipers H.': '1.1%', Insiders: '0.8%', Bundlers: '1.2%', 'LP Burned': '100%' } },
  // Tiles look fine, but the launch was bundled: only the scam check catches it.
  RugBundLaunch11111111111111111111111pump: { sym: 'RUG', tiles: { 'Top 10 H.': '17.4%', 'Dev H.': '0%', 'Snipers H.': '0%', Insiders: '2.0%', Bundlers: '3.2%', 'LP Burned': '100%' } },
  // Fails the gate on concentration and LP.
  GateFai1Token1111111111111111111111111pump: { sym: 'WHALE', feed: ["it'll be too late later", 'this one sends, dont sleep', 'last chance before it moons'], tiles: { 'Top 10 H.': '38.5%', 'Dev H.': '4.1%', 'Snipers H.': '6%', Insiders: '3%', Bundlers: '2%', 'LP Burned': '0%' } },
};

if (typeof document !== 'undefined') {
  const mint = location.pathname.split('/').pop();
  const t = TOKENS[mint] ?? TOKENS.GoodLaunch1111111111111111111111111111pump;
  // Market cap drifts so the extension's price sampler has something to read.
  let mc = 2.1;
  const paint = () => {
    document.title = `$${t.sym} ${mc.toFixed(3)}M | Axiom`;
    document.getElementById('mc').textContent = `$${mc.toFixed(2)}M`;
  };
  paint();
  setInterval(() => {
    mc = Math.max(0.05, mc * (1 + (Math.random() - 0.52) * 0.01));
    paint();
  }, 1000);
  document.getElementById('sym').textContent = `$${t.sym}`;
  const tiles = document.getElementById('tiles');
  for (const [label, value] of Object.entries(t.tiles)) {
    const d = document.createElement('div');
    d.className = 'tile';
    const v = document.createElement('span');
    v.textContent = value;
    const l = document.createElement('span');
    l.textContent = label;
    d.append(v, l);
    tiles.append(d);
  }
  if (t.feed) {
    const feed = document.createElement('section');
    feed.className = 'panel';
    feed.innerHTML = '<h3>Callouts</h3>';
    for (const line of t.feed) {
      const p = document.createElement('p');
      p.textContent = `@caller: ${line}`;
      feed.append(p);
    }
    document.querySelector('main').append(feed);
  }
  const nav = document.getElementById('nav');
  for (const [m, x] of Object.entries(TOKENS)) {
    const a = document.createElement('a');
    a.href = `/axiom/meme/${m}`;
    a.textContent = x.sym;
    nav.append(a);
  }
  window.__mockOrders = [];
  const place = (side) => {
    window.__mockOrders.push({ side, amount: document.getElementById('amt').value });
    const line = document.createElement('div');
    line.textContent = `✔ ${side.toUpperCase()} ${document.getElementById('amt').value} SOL of $${t.sym}`;
    document.getElementById('log').prepend(line);
  };
  document.getElementById('buyBtn').addEventListener('click', () => place('buy'));
  document.getElementById('sellBtn').addEventListener('click', () => place('sell'));
  document.getElementById('sell25').addEventListener('click', () => place('sell'));
  document.getElementById('sell100').addEventListener('click', () => place('sell'));
}
