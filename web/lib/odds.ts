/**
 * TxODDS consensus odds layer.
 *
 * The TxLINE feed streams de-margined consensus betting odds per fixture
 * (`/api/odds/snapshot/{fixtureId}`, with `?asOf=` for history). Each line carries
 * decimal `Prices` (×1000) and `Pct` (implied probability %, summing to 100 within a
 * market). We parse those and map them onto our on-chain markets so every market can
 * show the *market consensus* probability next to our *pool* probability — and chart
 * how the consensus has shifted over time. This is the real-time data the track rewards.
 */
import { OnsideMarket } from "@/lib/markets";

export type OddsType = "1x2" | "ou" | "ah";
export type Period = "match" | "h1";

export type OddsLine = {
  type: OddsType;
  period: Period;
  line: number | null; // goal line for ou/ah
  names: string[]; // PriceNames, e.g. ["over","under"] or ["part1","draw","part2"]
  decimal: number[]; // Prices / 1000
  pct: (number | null)[]; // implied probability %, "NA" → null
  inRunning: boolean;
  ts: number;
};

function parseType(s: string): OddsType | null {
  if (!s) return null;
  if (s.startsWith("1X2")) return "1x2";
  if (s.startsWith("OVERUNDER")) return "ou";
  if (s.startsWith("ASIANHANDICAP")) return "ah";
  return null;
}
function parseLine(mp: string | null): number | null {
  if (!mp) return null;
  const m = /line=(-?\d+(?:\.\d+)?)/.exec(mp);
  return m ? parseFloat(m[1]) : null;
}
function parsePeriod(mp: string | null): Period {
  return mp && mp.includes("half=1") ? "h1" : "match";
}

export function parseOdds(raw: any): OddsLine[] {
  if (!Array.isArray(raw)) return [];
  const out: OddsLine[] = [];
  for (const o of raw) {
    const type = parseType(o?.SuperOddsType);
    if (!type) continue;
    out.push({
      type,
      period: parsePeriod(o.MarketPeriod),
      line: parseLine(o.MarketParameters),
      names: Array.isArray(o.PriceNames) ? o.PriceNames : [],
      decimal: Array.isArray(o.Prices) ? o.Prices.map((p: number) => p / 1000) : [],
      pct: Array.isArray(o.Pct) ? o.Pct.map((p: string) => (p == null || p === "NA" ? null : parseFloat(p))) : [],
      inRunning: !!o.InRunning,
      ts: Number(o.Ts) || 0,
    });
  }
  return out;
}

export async function fetchOdds(fixtureId: number, asOf?: number): Promise<OddsLine[]> {
  const q = asOf ? `?asOf=${asOf}` : "";
  try {
    const res = await fetch(`/api/txodds/odds/snapshot/${fixtureId}${q}`);
    if (!res.ok) return [];
    return parseOdds(await res.json());
  } catch {
    return [];
  }
}

export function find1x2(lines: OddsLine[], period: Period = "match"): OddsLine | undefined {
  return lines.find((l) => l.type === "1x2" && l.period === period);
}
export function findOU(lines: OddsLine[], line: number, period: Period = "match"): OddsLine | undefined {
  return lines.find((l) => l.type === "ou" && l.period === period && l.line === line);
}

export type FixtureOdds = { p1: number | null; draw: number | null; p2: number | null; inRunning: boolean };

/** Full-match 1X2 win/draw/win probabilities for the lobby. */
export function fixtureOdds(lines: OddsLine[]): FixtureOdds | null {
  const x = find1x2(lines);
  if (!x) return null;
  const at = (n: string) => {
    const i = x.names.indexOf(n);
    return i >= 0 ? x.pct[i] ?? null : null;
  };
  return { p1: at("part1"), draw: at("draw"), p2: at("part2"), inRunning: x.inRunning };
}

export type Consensus = { pct: number; decimal: number | null };

/** Consensus implied probability of a market's YES outcome, or null if the feed
 *  doesn't price it. `p1` is the fixture's Participant1 name (to resolve "to win"). */
export function consensusForMarket(m: OnsideMarket, lines: OddsLine[], p1?: string): Consensus | null {
  const d = m.description || "";

  const ou = /Over\s+(\d+(?:\.\d+)?)\s+goals/i.exec(d);
  if (ou) {
    const l = findOU(lines, parseFloat(ou[1]));
    if (!l) return null;
    const i = l.names.indexOf("over");
    const pct = i >= 0 ? l.pct[i] : null;
    if (pct == null) return null;
    return { pct, decimal: i >= 0 ? l.decimal[i] ?? null : null };
  }

  if (/to win/i.test(d)) {
    const x = find1x2(lines);
    if (!x) return null;
    const isP1 = !!p1 && d.toLowerCase().startsWith(p1.toLowerCase());
    const i = x.names.indexOf(isP1 ? "part1" : "part2");
    const pct = i >= 0 ? x.pct[i] : null;
    if (pct == null) return null;
    return { pct, decimal: i >= 0 ? x.decimal[i] ?? null : null };
  }

  // "<Team> to score" and similar have no direct consensus line in the feed.
  return null;
}

export type SnapAt = { t: number; lines: OddsLine[] };

/** Backfill a real history curve by querying `asOf` at several past offsets (minutes). */
export async function fetchOddsHistory(fixtureId: number, mins: number[], now: number): Promise<SnapAt[]> {
  const snaps = await Promise.all(
    mins.map(async (mm) => ({ t: now - mm * 60000, lines: await fetchOdds(fixtureId, now - mm * 60000) }))
  );
  return snaps.filter((s) => s.lines.length).sort((a, b) => a.t - b.t);
}

/** Extract one market's consensus-probability time series from history snapshots. */
export function seriesForMarket(snaps: SnapAt[], m: OnsideMarket, p1?: string): { t: number; pct: number }[] {
  const pts: { t: number; pct: number }[] = [];
  for (const s of snaps) {
    const c = consensusForMarket(m, s.lines, p1);
    if (c) pts.push({ t: s.t, pct: c.pct });
  }
  return pts;
}

export const DECIMAL = (d: number | null) => (d == null ? "—" : d.toFixed(2));
