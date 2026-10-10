// Reads the trading wallet's recent swaps over Solana JSON-RPC (public data; no keys, nothing signed),
// then logs closed positions into the journal so loss caps fire without manual logging.
import { loadState } from '../storage';
import { mergeClosed } from './merge';
import { closedPositions, parseTransaction, type ChainTx } from './solana-pnl';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const WINDOW_MS = 36 * 3600_000;
const MAX_NEW_PER_RUN = 40;

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result as T;
}

export interface ChainSyncResult {
  ok: boolean;
  closed: { mint: string; pnlSol: number; chainId: string; closedAt: number }[];
  error?: string;
}

export async function syncWalletPnl(): Promise<ChainSyncResult> {
  const { settings, trades } = await loadState();
  const wallet = settings.tradingWallet.trim();
  if (!settings.enabled || !ADDRESS.test(wallet)) return { ok: false, closed: [], error: 'no wallet' };
  const url = settings.solanaRpcUrl || 'https://api.mainnet-beta.solana.com';
  try {
    const sigs = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>(url, 'getSignaturesForAddress', [wallet, { limit: 100 }]);
    const since = Date.now() - WINDOW_MS;
    const recent = sigs.filter((s) => (s.blockTime ?? 0) * 1000 >= since);
    const { chainTx = {} } = (await chrome.storage.local.get('chainTx')) as { chainTx?: Record<string, ChainTx | null> };
    let fetched = 0;
    for (const s of recent) {
      if (s.signature in chainTx) continue;
      if (fetched++ >= MAX_NEW_PER_RUN) break; // public RPCs rate-limit; the rest come next minute
      const raw = await rpc<unknown>(url, 'getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      chainTx[s.signature] = raw ? parseTransaction(raw, wallet) : null;
    }
    // Keep only the window in storage.
    const keep = new Set(recent.map((s) => s.signature));
    for (const k of Object.keys(chainTx)) if (!keep.has(k)) delete chainTx[k];
    const txs = Object.values(chainTx).filter((t): t is ChainTx => !!t);
    const merged = mergeClosed(trades, closedPositions(txs));
    await chrome.storage.local.set({ chainTx, ...(merged.added.length ? { trades: merged.trades } : {}), chainSyncAt: Date.now(), chainSyncError: null });
    return { ok: true, closed: merged.added.map((p) => ({ mint: p.mint, pnlSol: p.pnlSol, chainId: p.signatures[0], closedAt: p.closedAt })) };
  } catch (e) {
    await chrome.storage.local.set({ chainSyncError: (e as Error).message });
    return { ok: false, closed: [], error: (e as Error).message };
  }
}
