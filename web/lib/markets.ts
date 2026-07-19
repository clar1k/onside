export type OnsideMarket = {
  publicKey: string;
  fixtureId: number;
  description: string;
  statAKey: number;
  statBKey: number;
  op: number;
  period: number;
  yesThreshold: number;
  yesComparison: "GreaterThan" | "LessThan" | "EqualTo";
  closeTs: number; // unix seconds
  settleAfterTs: number; // oracle ms
  totalYes: number; // lamports
  totalNo: number; // lamports
  outcome: "unresolved" | "yes" | "no" | "void";
  status: "open" | "resolved" | "void";
  feeBps: number;
  createdAt: number;
};

export type Position = {
  market: string;
  yesAmount: number; // lamports
  noAmount: number; // lamports
};

export const LAMPORTS = 1_000_000_000;

export function decodeMarket(pubkey: string, acc: any): OnsideMarket {
  const c = acc.yesPredicate.comparison;
  const yesComparison = c.greaterThan ? "GreaterThan" : c.lessThan ? "LessThan" : "EqualTo";
  const outcome = acc.outcome.yes
    ? "yes"
    : acc.outcome.no
    ? "no"
    : acc.outcome.void
    ? "void"
    : "unresolved";
  const status = acc.status.open ? "open" : acc.status.resolved ? "resolved" : "void";
  return {
    publicKey: pubkey,
    fixtureId: Number(acc.fixtureId),
    description: acc.description,
    statAKey: acc.statAKey,
    statBKey: acc.statBKey,
    op: acc.op,
    period: acc.period,
    yesThreshold: acc.yesPredicate.threshold,
    yesComparison,
    closeTs: Number(acc.closeTs),
    settleAfterTs: Number(acc.settleAfterTs),
    totalYes: Number(acc.totalYes),
    totalNo: Number(acc.totalNo),
    outcome,
    status,
    feeBps: acc.feeBps,
    createdAt: Number(acc.createdAt),
  };
}

/** Parimutuel implied probability of YES, from where the money sits. */
export function impliedYesPct(m: { totalYes: number; totalNo: number }): number {
  const t = m.totalYes + m.totalNo;
  if (t === 0) return 50;
  return Math.round((100 * m.totalYes) / t);
}

export type MarketPhase = "open" | "settling" | "resolved" | "void";

/** Single source of truth for a market's lifecycle state. */
export function marketPhase(m: OnsideMarket, nowMs = Date.now()): MarketPhase {
  if (m.status === "resolved") return "resolved";
  if (m.status === "void") return "void";
  return nowMs / 1000 >= m.closeTs ? "settling" : "open";
}

/** Probability (0-100) as a Polymarket-style cents price, e.g. 62 → "62¢". */
export function cents(pct: number): string {
  return `${Math.round(Math.max(0, Math.min(100, pct)))}¢`;
}

/** Virtual-liquidity anchor (lamports). The market price starts at the fair estimate
 *  and each bet pulls it toward the pool — bigger bets move it more. */
const PRICE_ANCHOR = 0.05 * LAMPORTS;

/** The live market price (YES probability, 0-100). It blends the fair estimate
 *  (TxODDS consensus / last charted odds, anchored by PRICE_ANCHOR) with the real
 *  pool — so placing a bet ACTUALLY MOVES the price, like a real prediction market.
 *  Returns null only when there's neither odds nor any money in the pool. */
export function marketChance(m: OnsideMarket, consPct: number | null, seriesLast: number | null): number | null {
  const anchor = consPct ?? seriesLast;
  const pool = m.totalYes + m.totalNo;
  if (anchor == null && pool === 0) return null;
  const fair = anchor ?? 50; // no odds → start even, let the crowd set it
  const yes = (m.totalYes + (fair / 100) * PRICE_ANCHOR) / (pool + PRICE_ANCHOR);
  return Math.round(Math.max(1, Math.min(99, yes * 100)));
}

export function fmtCountdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** What an already-placed `stake` (lamports) on `side` pays out if that side wins, at the
 *  current pool — for showing a live "to win" on the user's existing position. Mirrors the
 *  on-chain fee-on-profit. */
export function positionValue(
  m: { totalYes: number; totalNo: number; feeBps: number },
  side: "yes" | "no",
  stake: number
): number {
  if (stake <= 0) return 0;
  const winPool = side === "yes" ? m.totalYes : m.totalNo;
  const pool = m.totalYes + m.totalNo;
  if (winPool <= 0) return stake;
  const gross = Math.floor((stake * pool) / winPool);
  const profit = Math.max(0, gross - stake);
  const fee = Math.floor((profit * m.feeBps) / 10000);
  return gross - fee;
}

/** Projected payout (lamports) if you stake `amount` on `side` and that side wins.
 *  Mirrors the on-chain fee-on-profit so the preview never over-promises. */
export function projectedPayout(
  totalYes: number,
  totalNo: number,
  side: "yes" | "no",
  amount: number,
  feeBps = 0
): number {
  if (amount <= 0) return 0;
  const winPool = (side === "yes" ? totalYes : totalNo) + amount;
  const pool = totalYes + totalNo + amount;
  const gross = Math.floor((amount * pool) / winPool);
  const profit = Math.max(0, gross - amount);
  const fee = Math.floor((profit * feeBps) / 10000);
  return gross - fee;
}
