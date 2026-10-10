// Local test harness:
//   /futures/BTCUSDT, /spot/BTCUSDT   mock CEX (generic adapter)
//   /axiom/meme/<mint>                mock Axiom token page (axiom adapter via the localhost path hook)
//   /api/v1/token/<mint>              mock Is It Bundled? API
//   /v1/messages                      mock Claude Messages API (SSE), scripted coach turn
//   /__last-request                   last /v1/messages request body, for assertions
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 5178);
const file = (p) => readFileSync(new URL(`../mock/${p}`, import.meta.url));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

const BUNDLE = {
  GoodLaunch1111111111111111111111111111pump: { status: 'no_bundle', risk: 'low', symbol: 'GOOD', bundledPct: 0.4, flaggedHoldPct: 1.2, devLaunches7d: 1, devBundled7d: 0, fundedTogether: 0, throwawayFunded: 0, madeWithProxima: false, madeWithSumo: false, estimate: false },
  RugBundLaunch11111111111111111111111pump: { status: 'bundled', risk: 'extreme', symbol: 'RUG', bundledPct: 46.8, creatorBundlePct: 31.2, firstSecondPct: 52, insidersHoldPct: 28, flaggedHoldPct: 39.5, bundleWallets: 23, devLaunches7d: 9, devBundled7d: 8, fundedTogether: 21, throwawayFunded: 14, madeWithProxima: true, madeWithSumo: false, estimate: false },
  GateFai1Token1111111111111111111111111pump: { status: 'no_bundle', risk: 'low', symbol: 'WHALE', bundledPct: 0, flaggedHoldPct: 3, devLaunches7d: 1, devBundled7d: 0, fundedTogether: 0, throwawayFunded: 0, madeWithProxima: false, madeWithSumo: false, estimate: false },
};

let lastRequest = null;
const streamRequests = [];
const autoRequests = [];

function sse(res, blocks, stopReason) {
  res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('message_start', { message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } });
    } else {
      send('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    send('content_block_stop', { index });
  });
  send('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
  send('message_stop', {});
  res.end();
}

/** Non-streaming JSON response (the on-page auto-check uses messages.create). */
function json(res, content, stopReason) {
  res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'mock', content, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } }));
}

const RUG_VERDICT = { verdict: 'avoid', headline: 'Bundled launch: insiders hold 40%', reasons: ['47% of supply bundled at launch', 'Dev bundled 8 of 9 launches this week', 'Made with Proxima'], next: 'Close this chart and move on' };
const CALM_VERDICT = { verdict: 'no_trade', headline: 'Passes gate, no entry trigger', reasons: ['1m trend down: lower highs', '5m flow flat', 'R:R under your 3:1'], watch: '$155K break with 3 green 1m candles', next: 'Set an alert at $157K' };

/** Scripted coach: read the page → show a verdict based on what it saw → one short line. */
function coach(body, res) {
  const allText = JSON.stringify(body.messages);
  if (!body.stream) {
    // Auto-check: one shot, verdict straight from the live_page block.
    return json(res, [{ type: 'tool_use', id: 'toolu_auto', name: 'show_verdict', input: allText.includes('\\"risk\\":\\"extreme\\"') ? RUG_VERDICT : CALM_VERDICT }], 'tool_use');
  }
  const first = body.messages.at(-1);
  if (typeof first.content !== 'string' && first.content.some((b) => b.type === 'text' && b.text.startsWith('<live_page>')) && !first.content.some((b) => b.type === 'tool_result')) {
    // Live context already attached: no need to call get_current_page.
    return sse(res, [{ type: 'tool_use', id: 'toolu_verdict', name: 'show_verdict', input: first.content.some((b) => b.type === 'text' && b.text.includes('"risk":"extreme"')) ? RUG_VERDICT : CALM_VERDICT }], 'tool_use');
  }
  const last = body.messages.at(-1);
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_result') : [];
  if (!results.length) return sse(res, [{ type: 'tool_use', id: 'toolu_page', name: 'get_current_page', input: {} }], 'tool_use');
  const r = results[0];
  if (r.tool_use_id === 'toolu_page') {
    const text = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
    const rigged = text.includes('"risk":"extreme"');
    return sse(res, [{ type: 'tool_use', id: 'toolu_verdict', name: 'show_verdict', input: rigged ? RUG_VERDICT : CALM_VERDICT }], 'tool_use');
  }
  return sse(res, [{ type: 'text', text: 'Card above. Patience is the edge here.' }], 'end_turn');
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();

  if (url.pathname === '/v1/messages' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      lastRequest = { body, headers: req.headers };
      (body.stream ? (streamRequests.push(body), 0) : autoRequests.push(body));
      if (req.headers['x-api-key'] !== 'test-key') {
        res.writeHead(401, { ...CORS, 'content-type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
      }
      coach(body, res);
    });
    return;
  }
  if (url.pathname === '/__last-request') {
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
    return res.end(JSON.stringify(lastRequest));
  }
  if (url.pathname === '/__requests') {
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ stream: streamRequests, auto: autoRequests }));
  }
  const tok = url.pathname.match(/^\/api\/v1\/token\/([^/]+)$/);
  if (tok) {
    const data = BUNDLE[tok[1]] ?? { status: 'unscanned', risk: null };
    res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ mint: tok[1], ...data, report: `http://localhost:${PORT}/report/${tok[1]}` }));
  }
  if (url.pathname === '/mock.js' || url.pathname === '/axiom.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(file(url.pathname.slice(1)));
  }
  if (url.pathname === '/') {
    res.writeHead(302, { location: '/futures/BTCUSDT' });
    return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(file(url.pathname.startsWith('/axiom') ? 'axiom.html' : 'exchange.html'));
}).listen(PORT, () => console.log(`Mock harness: http://localhost:${PORT}/futures/BTCUSDT  ·  /axiom/meme/RugBundLaunch11111111111111111111111pump`));
