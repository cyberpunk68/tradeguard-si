// Is It Bundled? client (https://isitbundled.com/api). Free, no key, open CORS, 240 req/min/IP.
// Only the token's public mint/pool address is sent. Called from the service worker.
// Results are credited and linked to the source report wherever they're shown, per the API's terms.
import type { ScamReport } from '../core/types';
import { normalizeReport } from './normalize';

export { normalizeReport };

const TTL_MS = 5 * 60_000;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TIMEOUT_MS = 4000;
export async function fetchScamReport(address: string, base: string): Promise<ScamReport> {
  if (!ADDRESS.test(address)) throw new Error('Not a Solana token address');
  const key = `scan:${address}`;
  const cached = (await chrome.storage.session.get(key))[key] as ScamReport | undefined;
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const root = base.replace(/\/+$/, '');
    const res = await fetch(`${root}/api/v1/token/${address}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (res.status === 429) throw new Error('Is It Bundled? rate limit hit. Try again in a minute.');
    if (!res.ok) throw new Error(`Is It Bundled? returned HTTP ${res.status}`);
    const report = normalizeReport((await res.json()) as Record<string, unknown>, address, `${root}/`);
    await chrome.storage.session.set({ [key]: report });
    return report;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('Is It Bundled? took too long to answer');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
