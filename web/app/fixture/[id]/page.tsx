"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Play } from "lucide-react";
import { useLiveTick } from "@/lib/stream";
import { cacheFixtureName, getCachedFixtureName } from "@/lib/fixtureNames";
import { Header } from "@/components/Header";
import { ScoreBoard } from "@/components/ScoreBoard";
import { WatchLive } from "@/components/WatchLive";
import { MatchDetails } from "@/components/MatchDetails";
import { buildMatchState } from "@/lib/broadcast";
import { DEMO_STREAM_URL } from "@/lib/config";
import { MarketList } from "@/components/MarketList";
import { ParlaySlip } from "@/components/ParlaySlip";
import { SportsSidebar } from "@/components/SportsSidebar";
import { fetchMarketsForFixture, fetchPositions, claimMarket } from "@/lib/onside";
import { OnsideMarket, Position } from "@/lib/markets";
import { Consensus, SnapAt, OddsLine, fetchOdds, fetchOddsHistory, fixtureOdds, consensusForMarket, seriesForMarket } from "@/lib/odds";
import { useWallet } from "@/lib/wallet";

const BACKFILL_MINS = [60, 45, 35, 27, 20, 14, 9, 5, 2];

export default function FixturePage({ params }: { params: { id: string } }) {
  const fixtureId = Number(params.id);
  const wallet = useWallet();
  const [fixture, setFixture] = useState<any>(null);
  const [fixtureLoaded, setFixtureLoaded] = useState(false);
  const [cachedName, setCachedName] = useState<{ p1: string; p2: string } | null>(null);
  const [score, setScore] = useState<any>(null);
  const [markets, setMarkets] = useState<OnsideMarket[] | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, { side: "yes" | "no"; chance: number }>>({});
  const [watch, setWatch] = useState(false);
  const userPicked = useRef(false);

  const [oddsLines, setOddsLines] = useState<OddsLine[]>([]);
  const [oddsHistory, setOddsHistory] = useState<SnapAt[]>([]);

  const ownerKey = wallet.publicKey?.toBase58();
  const { tick, live: streamLive } = useLiveTick(fixtureId);

  // Team names: live snapshot → cached (seen earlier) → derived from a "<Team> to win"
  // market. A match can rotate out of the TxODDS snapshot while its markets live on.
  const derivedP1 = useMemo(() => {
    for (const m of markets || []) {
      const mt = /(.+?)\s+to\s+(win|score)/i.exec(m.description);
      if (mt) return mt[1].trim();
    }
    return undefined;
  }, [markets]);
  const p1name = (fixture?.Participant1 as string | undefined) || cachedName?.p1 || derivedP1;
  const p2name = (fixture?.Participant2 as string | undefined) || cachedName?.p2;
  const p1 = p1name;

  const loadMarkets = useCallback(async () => {
    try {
      const ms = await fetchMarketsForFixture(fixtureId);
      setMarkets(ms);
      if (wallet.publicKey) {
        const ps = await fetchPositions(wallet.publicKey, ms.map((m) => m.publicKey)).catch(() => ({}));
        setPositions(ps);
      }
    } catch {
      // RPC hiccup — keep the skeleton and let the 8s poll retry, rather than wrongly
      // flipping to "no markets" for a match that has them.
      setMarkets((cur) => cur);
    }
  }, [fixtureId, ownerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCachedName(getCachedFixtureName(fixtureId));
    fetch("/api/txodds/fixtures/snapshot")
      .then((r) => r.json())
      .then((d: any) => {
        const f = (Array.isArray(d) ? d : []).find((x: any) => x.FixtureId === fixtureId);
        if (f) {
          setFixture(f);
          cacheFixtureName(fixtureId, f.Participant1, f.Participant2);
        }
      })
      .catch(() => {})
      .finally(() => setFixtureLoaded(true));

    const fetchScore = () =>
      fetch(`/api/txodds/scores/snapshot/${fixtureId}?asOf=${Date.now()}`)
        .then((r) => r.json())
        .then(setScore)
        .catch(() => {});

    fetchScore();
    loadMarkets();
    // Score is a cheap TxODDS proxy call — poll it often. Markets are a HEAVY on-chain
    // getProgramAccounts — poll it slowly (they only change on a bet, and the trade panel
    // + SSE tick already refresh markets the instant something happens). Hammering it every
    // 8s is what exhausted the RPC's per-IP quota.
    const scoreTimer = setInterval(fetchScore, 8000);
    const marketTimer = setInterval(loadMarkets, 30000);
    return () => {
      clearInterval(scoreTimer);
      clearInterval(marketTimer);
    };
  }, [fixtureId, loadMarkets]);

  useEffect(() => {
    let alive = true;
    let timer: any;
    (async () => {
      const back = await fetchOddsHistory(fixtureId, BACKFILL_MINS, Date.now());
      if (!alive) return;
      const cur = await fetchOdds(fixtureId);
      const init = [...back];
      if (cur.length) {
        setOddsLines(cur);
        init.push({ t: Date.now(), lines: cur });
      }
      setOddsHistory(init);
      timer = setInterval(async () => {
        const lines = await fetchOdds(fixtureId);
        if (!alive || !lines.length) return;
        setOddsLines(lines);
        setOddsHistory((h) => [...h, { t: Date.now(), lines }].slice(-80));
      }, 12000);
    })();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [fixtureId]);

  // SSE-driven: re-pull the latest the instant the TxODDS stream reports a change
  // (event-driven, not a fixed timer). The intervals above stay as a backstop.
  useEffect(() => {
    if (tick === 0) return;
    fetch(`/api/txodds/scores/snapshot/${fixtureId}?asOf=${Date.now()}`).then((r) => r.json()).then(setScore).catch(() => {});
    fetchOdds(fixtureId).then((lines) => {
      if (lines.length) {
        setOddsLines(lines);
        setOddsHistory((h) => [...h, { t: Date.now(), lines }].slice(-80));
      }
    });
    loadMarkets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const fixOdds = useMemo(() => fixtureOdds(oddsLines), [oddsLines]);

  const consensusMap = useMemo(() => {
    const map: Record<string, Consensus | null> = {};
    for (const m of markets || []) map[m.publicKey] = consensusForMarket(m, oddsLines, p1);
    return map;
  }, [markets, oddsLines, p1]);

  const seriesMap = useMemo(() => {
    const map: Record<string, { t: number; pct: number }[]> = {};
    for (const m of markets || []) map[m.publicKey] = seriesForMarket(oddsHistory, m, p1);
    return map;
  }, [markets, oddsHistory, p1]);

  const preferred = useMemo(
    () => markets?.find((m) => consensusMap[m.publicKey] || (seriesMap[m.publicKey]?.length ?? 0) > 1)?.publicKey,
    [markets, consensusMap, seriesMap]
  );
  useEffect(() => {
    if (!markets || !markets.length || userPicked.current) return;
    setSelected(preferred || markets[0].publicKey);
  }, [markets, preferred]);

  const onSelect = (pk: string) => {
    userPicked.current = true;
    setSelected(pk);
  };

  const claiming = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!markets || !wallet.anchorWallet) return;
    for (const m of markets) {
      const pos = positions[m.publicKey];
      if (!pos) continue;
      const resolvedWin = m.status === "resolved" && ((m.outcome === "yes" && pos.yesAmount > 0) || (m.outcome === "no" && pos.noAmount > 0));
      const voidRefund = m.status === "void" && (pos.yesAmount > 0 || pos.noAmount > 0);
      if ((!resolvedWin && !voidRefund) || claiming.current.has(m.publicKey)) continue;
      claiming.current.add(m.publicKey);
      claimMarket(wallet.anchorWallet, m)
        .then(() => {
          toast.success(resolvedWin ? "Winnings paid out" : "Refund paid out");
          wallet.refresh();
          loadMarkets();
        })
        .catch(() => claiming.current.delete(m.publicKey));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets, positions, ownerKey]);

  const matchState = useMemo(() => buildMatchState(score, fixture?.StartTime), [score, fixture]);
  const sc = matchState.phase === "pre" ? null : { g1: matchState.g1, g2: matchState.g2, minute: matchState.minute, running: matchState.running };
  // Fixtures rotated out of the TxODDS snapshot: backfill kickoff + home/away from the
  // score event stream (it carries StartTime + Participant1IsHome) so details still fill in.
  const meta = useMemo(() => {
    const arr = Array.isArray(score) ? score : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i];
      if (e && (e.StartTime || e.Participant1IsHome !== undefined))
        return { startTime: e.StartTime as number | undefined, p1Home: e.Participant1IsHome as boolean | undefined };
    }
    return null;
  }, [score]);
  const parlayPicks = useMemo(() => (markets || []).flatMap((market) => {
    const pick = picks[market.publicKey];
    return pick ? [{ market, ...pick }] : [];
  }), [markets, picks]);

  const addPick = (market: OnsideMarket, pickSide: "yes" | "no", chance: number) => {
    setPicks((current) => {
      if (!current[market.publicKey] && Object.keys(current).length >= 8) {
        toast.error("A parlay can contain up to 8 picks");
        return current;
      }
      return { ...current, [market.publicKey]: { side: pickSide, chance } };
    });
  };

  return (
    <>
      <Header />
      <main className="mx-auto max-w-[1600px] px-3 pb-24 sm:px-5">
        <div className="flex min-h-14 items-center justify-between gap-2">
          <Link href="/" className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-muted transition-colors duration-100 hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand">
            <ArrowLeft className="h-4 w-4" /> All matches
          </Link>
          <div className="flex items-center gap-2">
            {streamLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted" title="Real-time TxODDS SSE stream connected">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yes opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yes" />
                </span>
                Live feed · SSE
              </span>
            )}
            <button
              onClick={() => setWatch((v) => !v)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-edge bg-surface px-3 text-xs font-semibold text-ink transition-colors duration-100 hover:bg-raised focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Play className="h-3 w-3 fill-current" /> Watch live
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
          <SportsSidebar fixture={p1name && p2name ? `${p1name} vs ${p2name}` : undefined} />

          <div className="min-w-0 space-y-4">
            {watch && <WatchLive title={p1name && p2name ? `${p1name} vs ${p2name}` : "Match stream"} streamUrl={(fixture as any)?.streamUrl ?? DEMO_STREAM_URL} onClose={() => setWatch(false)} />}
            <ScoreBoard p1={p1name} p2={p2name} score={sc} startTime={fixture?.StartTime ?? meta?.startTime} odds={fixOdds} loading={!fixtureLoaded} />

            {markets === null && <Loading />}
            {markets && markets.length === 0 && (
              <div className="rounded-lg border border-edge bg-surface p-8 text-center">
                <p className="text-sm font-semibold text-ink">Markets are being prepared</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">Live odds are available. Check another match while this market opens.</p>
                <Link href="/" className="mt-4 inline-flex min-h-10 items-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand">Browse matches</Link>
              </div>
            )}

            {markets && markets.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <div><h1 className="text-lg font-bold">Match markets</h1><p className="text-xs text-muted">Select two or more odds to build your combo.</p></div>
                  <span className="rounded-md bg-raised px-2 py-1 font-mono text-xs text-muted">{markets.length} markets</span>
                </div>
                <MarketList markets={markets} selected={selected} onSelect={onSelect} consensusMap={consensusMap} seriesMap={seriesMap} positions={positions} picks={Object.fromEntries(Object.entries(picks).map(([key, value]) => [key, value.side]))} onPick={addPick} />
              </section>
            )}

            <div className="xl:hidden">
              <ParlaySlip
                picks={parlayPicks}
                onRemove={(market) => setPicks((current) => {
                  const next = { ...current };
                  delete next[market];
                  return next;
                })}
                onDone={() => { setPicks({}); loadMarkets(); }}
              />
            </div>

            {fixtureLoaded && <MatchDetails p1={p1name} p2={p2name} state={matchState} competition={(fixture as any)?.Competition} startTime={fixture?.StartTime ?? meta?.startTime} p1Home={(fixture as any)?.Participant1IsHome ?? meta?.p1Home} />}
          </div>

          <div className="hidden min-w-0 xl:block">
            <ParlaySlip
                picks={parlayPicks}
                onRemove={(market) => setPicks((current) => {
                  const next = { ...current };
                  delete next[market];
                  return next;
                })}
                onDone={() => { setPicks({}); loadMarkets(); }}
              />
          </div>
        </div>
      </main>
    </>
  );
}

function Loading() {
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface">
      <div className="h-10 animate-pulse border-b border-edge bg-raised" />
      <div className="divide-y divide-edge">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse bg-surface" />
        ))}
      </div>
    </div>
  );
}
