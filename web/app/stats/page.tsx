"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/Header";
import { fetchAllMarkets } from "@/lib/onside";
import { OnsideMarket, impliedYesPct, marketPhase } from "@/lib/markets";
import { getCachedFixtureName } from "@/lib/fixtureNames";
import { SolIcon } from "@/components/icons";
import { cn, fmtSol } from "@/lib/utils";

export default function Stats() {
  const [markets, setMarkets] = useState<OnsideMarket[] | null>(null);
  const [fixtures, setFixtures] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchAllMarkets()
      .then(setMarkets)
      .catch(() => setMarkets([]));
    fetch("/api/txodds/fixtures/snapshot")
      .then((r) => r.json())
      .then((d: any) => {
        const map: Record<number, string> = {};
        (Array.isArray(d) ? d : []).forEach((f: any) => (map[f.FixtureId] = `${f.Participant1} v ${f.Participant2}`));
        setFixtures(map);
      })
      .catch(() => {});
  }, []);

  // Match name: current snapshot → cached (seen earlier) → derived from a "<Team> to win"
  // market. Never show a raw fixture id.
  const nameMap = useMemo(() => {
    const map: Record<number, string> = { ...fixtures };
    for (const m of markets || []) {
      if (map[m.fixtureId]) continue;
      const cached = getCachedFixtureName(m.fixtureId);
      if (cached) {
        map[m.fixtureId] = `${cached.p1} v ${cached.p2}`;
        continue;
      }
      const mt = /(.+?)\s+to\s+win/i.exec(m.description);
      if (mt) map[m.fixtureId] = mt[1].trim();
    }
    return map;
  }, [markets, fixtures]);

  const agg = useMemo(() => {
    const ms = markets || [];
    return {
      count: ms.length,
      liquidity: ms.reduce((a, m) => a + m.totalYes + m.totalNo, 0),
      open: ms.filter((m) => marketPhase(m) === "open").length,
      resolved: ms.filter((m) => marketPhase(m) === "resolved").length,
      matches: new Set(ms.map((m) => m.fixtureId)).size,
    };
  }, [markets]);

  // Most active first: bettable markets, then by liquidity.
  const rows = useMemo(() => {
    const rank = (m: OnsideMarket) => ({ open: 0, settling: 1, resolved: 2, void: 3 }[marketPhase(m)]);
    return [...(markets || [])].sort((a, b) => rank(a) - rank(b) || b.totalYes + b.totalNo - (a.totalYes + a.totalNo)).slice(0, 20);
  }, [markets]);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
        <h1 className="mt-6 text-2xl font-bold">Market analytics</h1>
        <p className="mt-1 text-sm text-muted">Volume, liquidity and live odds across every World Cup market on Onside.</p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Markets" value={agg.count} />
          <Stat label="Matches" value={agg.matches} />
          <Stat label="Liquidity" value={<><SolIcon className="h-3.5 w-3.5" /> {fmtSol(agg.liquidity)}</>} />
          <Stat label="Open" value={agg.open} accent="yes" />
          <Stat label="Resolved" value={agg.resolved} />
        </div>

        <h2 className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wider text-muted">Markets</h2>
        {markets === null && <div className="h-64 animate-pulse rounded-xl border border-edge bg-surface" />}
        {markets && (
          <div className="overflow-hidden rounded-xl border border-edge bg-surface">
            <div className="grid grid-cols-[1fr_5rem_6rem] items-center gap-3 border-b border-edge px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <span>Market</span>
              <span className="text-right">Status</span>
              <span className="text-right">Pool</span>
            </div>
            {rows.map((m) => {
              const phase = marketPhase(m);
              return (
                <Link
                  key={m.publicKey}
                  href={`/fixture/${m.fixtureId}`}
                  className="grid grid-cols-[1fr_5rem_6rem] items-center gap-3 border-b border-edge/60 px-4 py-3 transition last:border-0 hover:bg-raised"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{m.description}</div>
                    {nameMap[m.fixtureId] && <div className="truncate text-xs text-muted">{nameMap[m.fixtureId]}</div>}
                  </div>

                  <div className="text-right">
                    {phase === "resolved" ? (
                      <span className={cn("text-sm font-bold", m.outcome === "yes" ? "text-yes" : "text-no")}>{m.outcome === "yes" ? "Yes won" : "No won"}</span>
                    ) : phase === "settling" ? (
                      <span className="text-xs font-medium text-amber-400">Resolving</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-yes">
                        {impliedYesPct(m)}%
                        <span className="text-[10px] font-normal uppercase text-faint">yes</span>
                      </span>
                    )}
                  </div>

                  <span className="inline-flex items-center justify-end gap-1 text-right text-sm tabular-nums text-muted">
                    <SolIcon className="h-3 w-3" />
                    {fmtSol(m.totalYes + m.totalNo)}
                  </span>
                </Link>
              );
            })}
            {rows.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">No markets yet.</div>}
          </div>
        )}
      </main>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: "yes" }) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={cn("mt-1 inline-flex items-center gap-1 text-xl font-bold tabular-nums", accent === "yes" && "text-yes")}>{value}</div>
    </div>
  );
}
