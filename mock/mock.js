// Mock exchange behaviour. Orders are only "placed" if the click reaches this handler,
// which is exactly what TradeGuard SI is supposed to control.
const futures = location.pathname.startsWith('/futures');
const $ = (id) => document.getElementById(id);
let price = 67000;
const base = 67000;
let ramp = null;

if (futures) {
  $('navFut').classList.add('on');
  $('buyBtn').textContent = 'Buy / Long';
  $('sellBtn').textContent = 'Sell / Short';
  $('amountLabel').textContent = 'Size (USDT)';
} else {
  $('navSpot').classList.add('on');
  $('levRow').classList.add('hidden');
}

const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function paint() {
  $('price').textContent = fmt(price);
  const c = ((price - base) / base) * 100;
  $('chg').textContent = `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`;
  $('chg').style.color = c >= 0 ? '#0ecb81' : '#f6465d';
  document.title = `${fmt(price)} | BTCUSDT | MockEx`;
}
setInterval(() => {
  if (ramp) {
    const t = Math.min(1, (Date.now() - ramp.start) / ramp.ms);
    price = ramp.from + (ramp.to - ramp.from) * t;
    if (t >= 1) ramp = null;
  } else {
    price *= 1 + (Math.random() - 0.5) * 0.0008;
  }
  paint();
}, 1000);
paint();

const startRamp = (mult) => (ramp = { start: Date.now(), ms: 70000, from: price, to: price * mult });
$('pump').onclick = () => startRamp(1.45);
$('dump').onclick = () => startRamp(0.55);
$('reset').onclick = () => { ramp = null; price = base; paint(); };

const levels = [1, 3, 5, 10, 20, 50];
$('lev').onclick = () => {
  const cur = parseInt($('lev').textContent, 10);
  $('lev').textContent = `${levels[(levels.indexOf(cur) + 1) % levels.length]}x`;
};

window.__mockOrders = [];
function place(side) {
  const o = { side, amount: Number($('amount').value), lev: futures ? $('lev').textContent : '1x', price: fmt(price), at: new Date().toLocaleTimeString() };
  window.__mockOrders.push(o);
  const line = document.createElement('div');
  line.textContent = `✔ ${o.at}  ${side.toUpperCase()} ${o.amount} USDT @ ${o.price}  ${o.lev}`;
  $('log').prepend(line);
}
$('buyBtn').addEventListener('click', () => place('buy'));
$('sellBtn').addEventListener('click', () => place('sell'));
