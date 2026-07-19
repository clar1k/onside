"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Radio, Clock } from "lucide-react";
import { Header } from "@/components/Header";
import { fetchTradableFixtures } from "@/lib/onside";
import { fetchOdds, fixtureOdds, FixtureOdds } from "@/lib/odds";
import { buildMatchState, MatchState } from "@/lib/broadcast";
import { cacheFixtureName, getKnownFixtureName } from "@/lib/fixtureNames";
import { flag } from "@/lib/flags";
import { WC_COMPETITION_ID, ONSIDE_PROGRAM_ID } from "@/lib/config";

// Cache the last-known market counts so a throttled RPC never flashes a wrong "no markets"
// on a match that has them.
const COUNTS_KEY = "onside_market_counts_v1";

type Fixture = {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
  StartTime: number;
  CompetitionId: number;
};

export default function Home() {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [odds, setOdds] = useState<Record<number, FixtureOdds | null>>({});
  const [scores, setScores] = useState<Record<number, MatchState>>({});

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(COUNTS_KEY) || "{}");
      if (cached && typeof cached === "object") setCounts(cached);
    } catch {}
    fetch("/api/txodds/fixtures/snapshot")
      .then((r) => r.json())
      .then(async (d: any) => {
        const snapshot: Fixture[] = (Array.isArray(d) ? d : []).filter((f: any) => f.CompetitionId === WC_COMPETITION_ID);
        const tradable = await fetchTradableFixtures();
        const present = new Set(snapshot.map((fixture) => fixture.FixtureId));
        const rotated: Fixture[] = Object.entries(tradable).flatMap(([id, info]) => {
          const fixtureId = Number(id);
          const name = getKnownFixtureName(fixtureId);
          if (!name || present.has(fixtureId)) return [];
          return [{ FixtureId: fixtureId, Participant1: name.p1, Participant2: name.p2, StartTime: info.closeTs * 1000, CompetitionId: WC_COMPETITION_ID }];
        });
        const a = [...snapshot, ...rotated];
        a.forEach((f) => cacheFixtureName(f.FixtureId, f.Participant1, f.Participant2));
        setFixtures(a);
        const c = Object.fromEntries(Object.entries(tradable).map(([id, info]) => [id, info.count]));
        setCounts((prev) => ({ ...prev, ...c }));
        try { localStorage.setItem(COUNTS_KEY, JSON.stringify(c)); } catch {}
      })
      .catch(() => setFixtures([]));
  }, []);

  useEffect(() => {
    if (!fixtures || !fixtures.length) return;
    let alive = true;
    (async () => {
      const out: Record<number, FixtureOdds | null> = {};
      const sc: Record<number, MatchState> = {};
      const chunk = 6;
      for (let i = 0; i < fixtures.length; i += chunk) {
        await Promise.all(
          fixtures.slice(i, i + chunk).map(async (f) => {
            out[f.FixtureId] = fixtureOdds(await fetchOdds(f.FixtureId, Date.now()));
            try {
              const ev = await fetch(`/api/txodds/scores/snapshot/${f.FixtureId}?asOf=${Date.now()}`).then((r) => r.json());
              sc[f.FixtureId] = buildMatchState(ev, f.StartTime);
            } catch {}
          })
        );
        if (!alive) return;
        setOdds({ ...out });
        setScores({ ...sc });
      }
    })();
    return () => {
      alive = false;
    };
  }, [fixtures]);

  const sorted = useMemo(() => {
    if (!fixtures) return null;
    // Live matches first, finished (full-time) last, upcoming in the middle by kickoff.
    const rank = (f: Fixture) => {
      const ph = scores[f.FixtureId]?.phase;
      if (ph === "live" || odds[f.FixtureId]?.inRunning) return 0;
      if (ph === "ended") return 2;
      return 1;
    };
    return [...fixtures].sort(
      (x, y) => rank(x) - rank(y) || (counts[y.FixtureId] ? 1 : 0) - (counts[x.FixtureId] ? 1 : 0) || x.StartTime - y.StartTime
    );
  }, [fixtures, counts, odds, scores]);

  const liveCount = useMemo(
    () => (fixtures || []).filter((f) => scores[f.FixtureId]?.phase === "live" || odds[f.FixtureId]?.inRunning).length,
    [fixtures, odds, scores]
  );
  const totalMarkets = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 sm:px-6">
        <section className="flex flex-wrap items-end justify-between gap-4 py-7 sm:py-9">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">World Cup 2026</h1>
            <p className="mt-1 max-w-lg text-sm text-muted">
              Back yes or no on match outcomes — winners are paid automatically the second the result is in.
            </p>
          </div>
          <div className="flex items-center gap-5 text-sm">
            {liveCount > 0 && (
              <span className="inline-flex items-center gap-1.5 font-medium text-no">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-no opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-no" />
                </span>
                {liveCount} live
              </span>
            )}
            <span className="text-muted">
              <span className="font-semibold text-ink">{totalMarkets}</span> markets
            </span>
            <span className="text-muted">
              <span className="font-semibold text-ink">{sorted?.length ?? 0}</span> matches
            </span>
          </div>
        </section>

        {!sorted && <Skeletons />}
        {sorted && sorted.length === 0 && (
          <p className="rounded-xl border border-edge bg-surface p-6 text-center text-sm text-muted">No matches available right now.</p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted?.map((f) => (
            <FixtureCard key={f.FixtureId} f={f} markets={counts[f.FixtureId] || 0} odds={odds[f.FixtureId]} score={scores[f.FixtureId]} />
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}

function FixtureCard({ f, markets, odds, score }: { f: Fixture; markets: number; odds?: FixtureOdds | null; score?: MatchState }) {
  const live = score?.phase === "live" || !!odds?.inRunning;
  const ended = score?.phase === "ended";
  const showScore = (live || ended) && !!score;
  const hasOdds = odds && (odds.p1 != null || odds.p2 != null);
  return (
    <Link
      href={`/fixture/${f.FixtureId}`}
      className="group flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4 transition hover:-translate-y-0.5 hover:border-faint"
    >
      <div className="flex items-center justify-between text-xs">
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-no/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-no">
            <Radio className="h-3 w-3 animate-pulse" /> Live{score && score.minute > 0 ? ` ${score.minute}'` : ""}
          </span>
        ) : ended ? (
          <span className="rounded-full bg-raised px-2 py-0.5 font-semibold uppercase tracking-wide text-muted">Full time</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted">
            <Clock className="h-3 w-3" />
            {new Date(f.StartTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {markets > 0 && (
          <span className="rounded-full bg-brand/15 px-2 py-0.5 font-medium text-brand">
            {markets} {markets === 1 ? "market" : "markets"}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {flag(f.Participant1) && <span className="shrink-0 text-lg leading-none">{flag(f.Participant1)}</span>}
          <span className="truncate text-[15px] font-bold">{f.Participant1}</span>
        </span>
        {showScore ? (
          <span className="shrink-0 rounded-md bg-canvas px-2 py-0.5 text-[15px] font-bold tabular-nums">
            {score!.g1} <span className="text-faint">–</span> {score!.g2}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-faint">vs</span>
        )}
        <span className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2">
          {flag(f.Participant2) && <span className="shrink-0 text-lg leading-none">{flag(f.Participant2)}</span>}
          <span className="truncate text-[15px] font-bold">{f.Participant2}</span>
        </span>
      </div>

      {hasOdds ? (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint">Who will win?</div>
          <WinBar p1={odds!.p1} draw={odds!.draw} p2={odds!.p2} />
        </div>
      ) : (
        <div className="flex h-[34px] items-center gap-1.5 text-xs font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-yes" /> Open for betting
          <span className="text-faint">· live odds at kick-off</span>
        </div>
      )}

      <div className="flex items-center justify-end text-xs font-medium text-muted transition group-hover:text-brand">
        View markets <ChevronRight className="h-4 w-4" />
      </div>
    </Link>
  );
}

function WinBar({ p1, draw, p2 }: { p1: number | null; draw: number | null; p2: number | null }) {
  const a = p1 ?? 0;
  const d = draw ?? 0;
  const b = p2 ?? 0;
  const sum = a + d + b || 1;
  const w = (v: number) => `${(100 * v) / sum}%`;
  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full bg-yes" style={{ width: w(a) }} />
        <div className="h-full bg-faint" style={{ width: w(d) }} />
        <div className="h-full bg-brand" style={{ width: w(b) }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums">
        <span className="font-medium text-yes">{pct(p1)}</span>
        <span className="text-muted">draw {pct(draw)}</span>
        <span className="font-medium text-brand">{pct(p2)}</span>
      </div>
    </div>
  );
}

function Footer() {
  const explorer = `https://explorer.solana.com/address/${ONSIDE_PROGRAM_ID}?cluster=devnet`;
  return (
    <footer className="mt-6 border-t border-edge">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>
          <span className="font-semibold text-ink">Onside</span> · World Cup prediction markets
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Powered by TxODDS</span>
          <span>Built on Solana</span>
          <a href={explorer} target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-brand hover:underline">
            Verify the contract
          </a>
          <span className="text-faint">Devnet · test SOL only</span>
        </div>
      </div>
    </footer>
  );
}

function Skeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[150px] animate-pulse rounded-xl border border-edge bg-surface" />
      ))}
    </div>
  );
}
