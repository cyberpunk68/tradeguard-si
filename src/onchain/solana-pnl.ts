// Realized P&L from the trader's own Solana wallet, read from public on-chain data, so loss caps
// work without anyone having to log a trade mid-tilt. Only a PUBLIC address is used; nothing is signed.
//
// Model: for each swap transaction we take the wallet's native SOL change (which already includes
// network fees, priority fees and tips, so it's the true cost) and its token balance changes.
// A position "closes" when the wallet's balance of that token returns to ~0; its realized P&L is the
// sum of SOL changes across every transaction that touched that token since it was opened.

export interface ChainTx {
  signature: string;
  blockTime: number; // seconds
  /** Native SOL change for the wallet in this transaction (lamports → SOL), fees included. */
  solDelta: number;
  /** Token balance changes for the wallet (by mint), in UI units. */
  tokenDeltas: Record<string, number>;
  /** Wallet's post-transaction balance per mint (UI units). */
  tokenPost: Record<string, number>;
  failed: boolean;
}

export interface ClosedPosition {
  mint: string;
  openedAt: number; // ms
  closedAt: number; // ms
  solIn: number; // SOL spent (positive)
  solOut: number; // SOL received (positive)
  pnlSol: number;
  buys: number;
  sells: number;
  signatures: string[];
}

const WSOL = 'So11111111111111111111111111111111111111112';
const DUST = 1e-6;

/** Turn a raw `getTransaction` result into the wallet's view of it. Returns null if the wallet isn't involved. */
export function parseTransaction(raw: any, wallet: string): ChainTx | null {
  if (!raw?.meta || !raw?.transaction?.message) return null;
  const keys: string[] = (raw.transaction.message.accountKeys ?? []).map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  // v0 transactions append loaded addresses after static keys.
  const loaded = raw.meta.loadedAddresses ? [...(raw.meta.loadedAddresses.writable ?? []), ...(raw.meta.loadedAddresses.readonly ?? [])] : [];
  const all = [...keys, ...loaded];
  const i = all.indexOf(wallet);
  if (i < 0) return null;
  const solDelta = ((raw.meta.postBalances?.[i] ?? 0) - (raw.meta.preBalances?.[i] ?? 0)) / 1e9;

  const pre = new Map<string, number>();
  const post = new Map<string, number>();
  for (const b of raw.meta.preTokenBalances ?? []) if (b.owner === wallet && b.mint !== WSOL) pre.set(b.mint, (pre.get(b.mint) ?? 0) + Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0));
  for (const b of raw.meta.postTokenBalances ?? []) if (b.owner === wallet && b.mint !== WSOL) post.set(b.mint, (post.get(b.mint) ?? 0) + Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0));
  // Wrapped SOL moving through the wallet's own token account is SOL, not a position.
  const wsolDelta = sumWsol(raw.meta.postTokenBalances, wallet) - sumWsol(raw.meta.preTokenBalances, wallet);

  const tokenDeltas: Record<string, number> = {};
  const tokenPost: Record<string, number> = {};
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    const d = (post.get(mint) ?? 0) - (pre.get(mint) ?? 0);
    if (Math.abs(d) > DUST) tokenDeltas[mint] = d;
    tokenPost[mint] = post.get(mint) ?? 0;
  }
  return {
    signature: raw.transaction.signatures?.[0] ?? '',
    blockTime: raw.blockTime ?? 0,
    solDelta: solDelta + wsolDelta,
    tokenDeltas,
    tokenPost,
    failed: !!raw.meta.err,
  };
}

function sumWsol(balances: any[] | undefined, wallet: string): number {
  return (balances ?? []).filter((b) => b.owner === wallet && b.mint === WSOL).reduce((s, b) => s + Number(b.uiTokenAmount?.uiAmountString ?? 0), 0);
}

/**
 * Walk transactions oldest → newest and emit each position that went from 0 → held → ~0.
 * Swaps that touch exactly one token are attributed fully to it; multi-token transactions are ignored
 * (routers rarely do this for a single trader, and guessing would be worse than skipping).
 */
export function closedPositions(txs: ChainTx[]): ClosedPosition[] {
  const open = new Map<string, ClosedPosition & { held: number }>();
  const out: ClosedPosition[] = [];
  for (const tx of [...txs].sort((a, b) => a.blockTime - b.blockTime)) {
    if (tx.failed) continue;
    const mints = Object.keys(tx.tokenDeltas);
    if (mints.length !== 1) continue;
    const mint = mints[0];
    const d = tx.tokenDeltas[mint];
    let p = open.get(mint);
    if (!p) {
      if (d <= 0) continue; // selling something we never saw bought (before the window): skip
      p = { mint, openedAt: tx.blockTime * 1000, closedAt: 0, solIn: 0, solOut: 0, pnlSol: 0, buys: 0, sells: 0, signatures: [], held: 0 };
      open.set(mint, p);
    }
    if (d > 0) p.buys++;
    else p.sells++;
    if (tx.solDelta < 0) p.solIn += -tx.solDelta;
    else p.solOut += tx.solDelta;
    p.signatures.push(tx.signature);
    p.held = tx.tokenPost[mint] ?? p.held + d;
    if (p.held <= DUST * 10 && p.sells > 0) {
      const { held, ...closed } = p;
      void held;
      out.push({ ...closed, closedAt: tx.blockTime * 1000, pnlSol: round(closed.solOut - closed.solIn) });
      open.delete(mint);
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
