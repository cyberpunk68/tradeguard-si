// Shared domain types. Everything in src/core is DOM-free and unit-testable.

export type Side = 'buy' | 'sell';
export type Market = 'spot' | 'perp';
export type Unit = 'USD' | 'SOL';

/** What the trader is about to do, as best the site adapter could read it. */
export interface OrderIntent {
  site: string;
  symbol: string | null;
  side: Side | null;
  market: Market;
  unit: Unit;
  /** Order value in `unit` (margin × leverage for perps when only margin is visible). */
  notional: number | null;
  leverage: number | null;
  /** Account balance/portfolio value in `unit`, if visible on the page. */
  balance: number | null;
  /** Recent % price change for the asset, if known (positive = pump). */
  priceChangePct: number | null;
  priceWindowMin: number | null;
  /** Token safety stats read off the trading page (Axiom-style token info panel). */
  token?: TokenStats | null;
  /** Launch/bundle analysis from Is It Bundled? (null = not available). */
  scam?: ScamReport | null;
  /** Token mint/pool address (memecoin terminals). */
  tokenAddress?: string | null;
  /** FOMO phrases found in callouts/chat on the page. */
  fomoHits?: string[];
  /** Public market data for the token (DexScreener): % change windows and pair age. */
  marketData?: { h1: number | null; h6: number | null; h24: number | null; ageMin: number | null } | null;
  /** Price (or market cap, same scale as TradeRecord.entryPrice) at the moment of the click. */
  price?: number | null;
  /** Share of the position a sell is for, 0–100, when the page shows it ("Sell 50%", a % chip or input). */
  sellPct?: number | null;
}

/** Read from the page. Every field is null when the page doesn't show it. */
export interface TokenStats {
  address: string | null;
  lpBurnedPct: number | null;
  devHoldPct: number | null;
  top10Pct: number | null;
  snipersPct: number | null;
  bundlersPct: number | null;
  insidersPct: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  /** SOL/USD, used to compare SOL order size against USD liquidity. */
  solUsd: number | null;
}

/** Recent order flow as shown on memecoin terminals ("5m Vol", "Buys 108 / $5.84K", "Net Vol. +$626"). */
export interface FlowStats {
  volUsd: number | null;
  buys: number | null;
  buysUsd: number | null;
  sells: number | null;
  sellsUsd: number | null;
  netUsd: number | null;
}

export type ScamRisk = 'low' | 'medium' | 'high' | 'extreme';

/** Subset of the Is It Bundled? token response we act on. */
export interface ScamReport {
  address: string;
  status: string; // proxima | sumo | proxima_after_launch | bundled | no_bundle | unscanned
  risk: ScamRisk | null;
  symbol: string | null;
  bundledPct: number | null;
  firstSecondPct: number | null;
  devBoughtPct: number | null;
  insidersHoldPct: number | null;
  flaggedHoldPct: number | null;
  bundleWallets: number | null;
  devLaunches7d: number | null;
  devBundled7d: number | null;
  fundedTogether: number | null;
  throwawayFunded: number | null;
  wokenWallets: number | null;
  madeWithProxima: boolean;
  madeWithSumo: boolean;
  estimate: boolean;
  report: string;
  fetchedAt: number;
}

export type Outcome = 'win' | 'loss' | 'breakeven';
export type ExitReason = 'stop' | 'target' | 'trailing' | 'devSell' | 'time' | 'manual' | 'thesisBreak' | 'liquidity';

export interface TradeRecord {
  id: string;
  ts: number;
  site: string;
  symbol: string | null;
  /** Token address, when the venue has one (for same-token rules). */
  token?: string | null;
  side: Side | null;
  unit: Unit;
  notional: number | null;
  leverage: number | null;
  /** Friction level shown before the trader proceeded (0 = none). */
  friction: FrictionLevel;
  /** Rule ids that fired. */
  hits: RuleId[];
  /** True if a warning was shown and the trader went through anyway. */
  overrode: boolean;
  moodScore: number | null;
  moodTags: MoodTag[];
  outcome?: Outcome;
  /** When the outcome was logged (≈ when the position closed). */
  outcomeTs?: number;
  pnl?: number; // in pnlUnit (USD when absent)
  pnlUnit?: Unit;
  /** Price or market cap at entry, as shown on the page. */
  entryPrice?: number | null;
  exitReason?: ExitReason;
  /** click = recorded when the order was placed; chain = reconstructed from the wallet's on-chain swaps. */
  source?: 'click' | 'chain';
  /** Extra buys folded into another record's closed position (no separate outcome). */
  partOf?: string;
  /** First swap signature of the closed position (dedupe for on-chain logging). */
  chainId?: string;
  /** Price/market cap at exit, and the high/low in the 10 minutes after (to test stop width with data). */
  exitPrice?: number | null;
  postExitHigh?: number | null;
  postExitLow?: number | null;
  note?: string;
}

export const MOOD_TAGS = ['calm', 'focused', 'confident', 'anxious', 'fomo', 'angry', 'tired', 'bored', 'euphoric'] as const;
export type MoodTag = (typeof MOOD_TAGS)[number];

export interface MoodEntry {
  ts: number;
  score: number; // 1 (awful) … 5 (great)
  tags: MoodTag[];
  note?: string;
}

/**
 * 0 = allow silently
 * 1 = banner (allow, but tell them)
 * 2 = modal with forced countdown
 * 3 = countdown + typed confirmation phrase
 * 4 = hard lockout (no override)
 */
export type FrictionLevel = 0 | 1 | 2 | 3 | 4;

export type RuleId =
  | 'lockout'
  | 'oversize'
  | 'leverage'
  | 'overtrading'
  | 'revenge'
  | 'chasing'
  | 'dailyLoss'
  | 'tilt'
  | 'mood'
  | 'gate'
  | 'scam'
  | 'stopWin'
  | 'weeklyLoss'
  | 'monthlyLoss'
  | 'stopOuts'
  | 'quietHours'
  | 'screenTime'
  | 'sessionBreak'
  | 'realityCheck'
  | 'rapidFire'
  | 'escalation'
  | 'heater'
  | 'afterWin'
  | 'bankroll'
  | 'bigSize'
  | 'sameTokenRebuy'
  | 'fomoCopy'
  | 'checklist'
  | 'manualSell'
  | 'dailyLossSol'
  | 'maxBuys'
  | 'openPositions'
  | 'aSetupLimit'
  | 'reentry'
  | 'tokenEntries'
  | 'riskBudget'
  | 'lateEntry';

export interface RuleHit {
  rule: RuleId;
  severity: FrictionLevel;
  title: string;
  /** Mentor-style message with the specific numbers. */
  message: string;
  /** Optional scannable bullets shown under the message. */
  points?: string[];
  link?: { href: string; label: string };
  /** Hitting this rule starts a lockout. */
  lockout?: { minutes: number; kind: LockoutKind };
}

export type LockoutKind = 'loss' | 'win' | 'break' | 'self' | 'time';

export interface Settings {
  enabled: boolean;
  /** Max single order as % of balance. */
  maxPositionPct: number;
  maxLeverage: number;
  maxTradesPerHour: number;
  maxTradesPerDay: number;
  /** A trade within this many minutes of a logged loss counts as possible revenge. */
  revengeWindowMin: number;
  /** Size multiple vs the losing trade that escalates revenge to "serious". */
  revengeSizeMultiple: number;
  /** % move within chaseWindowMin that counts as chasing. */
  chaseThresholdPct: number;
  chaseWindowMin: number;
  /** Daily realized loss (USD) that triggers a lockout. 0 = off. */
  dailyLossLimitUsd: number;
  /** N consecutive logged losses → lockout. 0 = off. */
  tiltStreak: number;
  lockoutMinutes: number;
  countdownSeconds: number;
  confirmPhrase: string;
  /** Fallback account size when the page doesn't show a balance. */
  accountSizeUsd: number;
  accountSizeSol: number;
  /** Ask for a mood check-in before the first order of a session. */
  requireMoodCheckIn: boolean;
  /** Ask how the previous trade went before allowing the next one. */
  askLastOutcome: boolean;
  /** Commitment mode: while locked out, settings are read-only and the lockout can't be ended early. */
  commitmentMode: boolean;
  /** Hosts the trader has added beyond the built-in list. */
  customSites: string[];
  disabledAdapters: string[];

  // Entry gate (memecoin terminals): pass/fail checks read off the token page, buys only.
  gateEnabled: boolean;
  gateLpBurnedMinPct: number;
  gateDevMaxPct: number;
  gateTop10MaxPct: number;
  /** Snipers + bundlers + insiders combined. */
  gateInsidersMaxPct: number;
  /** Liquidity must be at least this many × your order size. */
  gateMinLiquidityX: number;
  gateSeverity: 2 | 3 | 4;
  /** Warn (level 2) instead of a banner when some gate stats can't be read. */
  gateBlockUnverified: boolean;

  // Scam / bundle check via Is It Bundled? (sends only the token address).
  scamCheckEnabled: boolean;
  scamApiBase: string;
  scamMaxBundledPct: number;
  scamMaxFlaggedHoldPct: number;
  /** "extreme" risk = blocked with no override. */
  scamBlockExtreme: boolean;

  // AI coach (side panel). The API key is stored separately, never in settings/export.
  coachModel: string;
  /** Run a quick AI verdict automatically when a new token page opens (max once per token per 10 min). */
  coachAutoCheck: boolean;
  /** Attach a screenshot of the chart to quick checks when Chrome allows it. */
  coachChartCapture: boolean;
  /** Blank = the provider's own URL. Advanced override (e.g. a local test server). */
  coachBaseUrl: string;
  /** Whose API your own key is for: 'anthropic' | 'openrouter' | 'opencode'. Local to this browser. */
  coachProvider: string;
  /** Chosen models for non-Anthropic providers (Anthropic uses coachModel). Local to this browser. */
  coachProviderModels: Record<string, { chat?: string; auto?: string }>;

  // Gambling-harm protections.
  /** Stop-win: logged profit for the day that ends trading until midnight. 0 = off. */
  dailyProfitTargetUsd: number;
  weeklyLossLimitUsd: number;
  monthlyLossLimitUsd: number;
  /** Losing trades per day before a lockout until midnight. 0 = off. */
  maxLossesPerDay: number;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  /** Total minutes on trading pages per day. 0 = off. */
  dailyScreenLimitMinutes: number;
  /** Continuous session length before a forced break. 0 = off. */
  sessionMaxMinutes: number;
  breakMinutes: number;
  /** Reality-check reminder interval. 0 = off. */
  realityCheckMinutes: number;
  rapidFireSeconds: number;
  /** Each trade at least this × the previous one = doubling up. 0 = off. */
  escalationMultiple: number;
  /** Wins in a row that, combined with sizing up or speeding up, count as a heater. 0 = off. */
  heaterWinStreak: number;
  /** A logged win at least this big triggers a cool-down. 0 = off. */
  bigWinUsd: number;
  cooldownAfterWinMin: number;
  /** Loosening a limit takes effect after this many hours (tightening is instant). */
  limitChangeDelayHours: number;
  /** Public Solana address to send booked profits to (never a private key). */
  vaultAddress: string;
  vaultPct: number;
  /** Loss lockouts (daily loss, losses/day) last this many hours; 0 = until midnight. */
  lossLockoutHours: number;
  /** "Profit leaves the wallet": block buys while the balance is above this (SOL). 0 = off. */
  bankrollMaxSol: number;
  /** Sweep the balance back down to this (SOL). */
  bankrollTargetSol: number;
  /** Buys above this size need the typed phrase (A-setups only). 0 = off. */
  typedConfirmAboveSol: number;
  typedConfirmAboveUsd: number;
  /** No rebuying a token you just took a loss on (today). */
  sameTokenRebuyBlock: boolean;
  /** Three-question check before every memecoin buy. */
  preBuyChecklist: boolean;
  /** Flag pages whose callouts/chat push FOMO copy. */
  fomoCopyWarning: boolean;
  /** none = lockouts are absolute; typed = one trade at a time after a 60s wait, a written reason and a long phrase. */
  lockoutOverride: 'none' | 'typed';
  /** Realized daily loss in SOL that locks you out. 0 = off. */
  dailyLossLimitSol: number;
  /** Buy orders per day (sells don't count). 0 = off. */
  maxBuysPerDay: number;
  /** Buys still waiting for an outcome. 0 = off. */
  maxOpenPositions: number;
  /** Orders at or above this size (SOL) are A-setups. */
  aSetupSizeSol: number;
  maxASetupsPerDay: number;
  /** PUBLIC Solana address of the trading wallet: realized P&L is read from the chain. Never a private key. */
  tradingWallet: string;
  solanaRpcUrl: string;
  /** Minutes after exiting a token before you may buy it again. 0 = off. */
  tokenReentryCooldownMin: number;
  /** Buys of the same token per day. 0 = off. */
  maxEntriesPerTokenPerDay: number;
  /** Your stop-loss distance (%). A buy is blocked if a stop-out would exceed what's left of the daily SOL cap. */
  stopLossPct: number;
  /** Selling more than this % of a winning position by hand needs a thesis-break reason. 0 = off. */
  manualSellMaxPct: number;
  /** Block buys after the token already ran this much (% over 1h/6h/24h, or since launch). 0 = off. */
  lateEntryPct: number;
  /** During significant lockouts, trading sites don't load at all (redirected to a "closed" page). */
  siteBlockOnLockout: boolean;
  /** Locked rules: loosening needs a reason, a typed phrase, a second confirmation and 72h; never on a red day. */
  rulesLocked: boolean;
  /** When the pattern looks like gambling harm, send blocked pages to help resources. */
  helpRedirect: boolean;
  /** Written by calm you, shown to tilted you on every lockout. Stays on this device. */
  noteToSelf: string;
  /** Someone you'll call instead of trading (name / number). Stays on this device. */
  supportContact: string;
  helpRegion: 'auto' | 'US' | 'CA' | 'UK' | 'IE' | 'AU' | 'OTHER';
}

export interface Lockout {
  until: number;
  reason: string;
  startedAt: number;
  /** win = stop-win goal hit; self = self-exclusion (can't be ended early); break = forced break. */
  kind?: LockoutKind;
  /** Last local edit (for sync merging). */
  updatedMs?: number;
}

/** Time spent on trading pages (tracked by the extension). */
export interface Activity {
  date: string; // YYYY-MM-DD local
  minutesToday: number;
  /** Continuous active minutes (resets after 10 idle minutes). */
  sessionMinutes: number;
  lastActiveTs: number;
  /** minutesToday at the last reality check shown. */
  realityCheckedAt: number;
}

/** Everything the engine needs to judge one order. */
export interface EvalContext {
  activity?: Activity | null;
  now: number;
  intent: OrderIntent;
  settings: Settings;
  trades: TradeRecord[];
  mood: MoodEntry | null;
  lockout: Lockout | null;
}

export interface Verdict {
  level: FrictionLevel;
  hits: RuleHit[];
  /** Set when this verdict should start a new lockout. */
  startLockout: { minutes: number; reason: string; kind: LockoutKind } | null;
  /** Limits after mood adjustment — shown to the trader so the tightening is transparent. */
  effective: Settings;
  moodNote: string | null;
}
