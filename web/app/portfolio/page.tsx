"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Header } from "@/components/Header";
import { useWallet } from "@/lib/wallet";
import { fetchAllPositions, fetchMarketsByPubkeys, fetchParlayTickets, ParlayTicket } from "@/lib/onside";
import { OnsideMarket, Position, marketPhase, projectedPayout, LAMPORTS } from "@/lib/markets";
import { SolIcon } from "@/components/icons";
import { cn, fmtSol } from "@/lib/utils";

type Row = { pos: Position; m: OnsideMarket };
type ParlayRow = { ticket: ParlayTicket; markets: OnsideMarket[] };

export default function Portfolio() {
  const wallet = useWallet();
  const owner = wallet.publicKey?.toBase58();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [parlays, setParlays] = useState<ParlayRow[]>([]);
  const [fixtures, setFixtures] = useState<Record<number, string>>({});

  useEffect(() => {
    fetch("/api/txodds/fixtures/snapshot")
      .then((r) => r.json())
      .then((d: any) => {
        const map: Record<number, string> = {};
        (Array.isArray(d) ? d : []).forEach((f: any) => (map[f.FixtureId] = `${f.Participant1} v ${f.Participant2}`));
        setFixtures(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!wallet.publicKey) {
      setRows(wallet.kind === "none" ? null : []);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const [positions, tickets] = await Promise.all([
          fetchAllPositions(wallet.publicKey!),
          fetchParlayTickets(wallet.publicKey!),
        ]);
        const keys = [...positions.map((p) => p.market), ...tickets.flatMap((ticket) => ticket.legs.map((leg) => leg.market))];
        const markets = await fetchMarketsByPubkeys([...new Set(keys)]);
        const rs: Row[] = positions
          .map((pos) => ({ pos, m: markets[pos.market] }))
          .filter((r): r is Row => !!r.m && (r.pos.yesAmount > 0 || r.pos.noAmount > 0));
        const rank = (r: Row) => ({ open: 0, settling: 1, resolved: 2, void: 3 }[marketPhase(r.m)]);
        rs.sort((a, b) => rank(a) - rank(b) || b.m.createdAt - a.m.createdAt);
        if (alive) {
          setRows(rs);
          setParlays(tickets.map((ticket) => ({ ticket, markets: ticket.legs.map((leg) => markets[leg.market]).filter(Boolean) })));
        }
      } catch {
        if (alive) setRows([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const r = rows || [];
    let staked = 0,
      active = 0,
      won = 0,
      returned = 0;
    for (const { pos, m } of r) {
      staked += pos.yesAmount + pos.noAmount;
      const phase = marketPhase(m);
      if (phase === "open" || phase === "settling") active++;
      if (phase === "resolved") {
        const win = (m.outcome === "yes" && pos.yesAmount > 0) || (m.outcome === "no" && pos.noAmount > 0);
        if (win) {
          won++;
          returned += projectedPayout(m.totalYes, m.totalNo, m.outcome as "yes" | "no", m.outcome === "yes" ? pos.yesAmount : pos.noAmount, m.feeBps);
        }
      }
    }
    for (const { ticket } of parlays) {
      staked += ticket.stake;
      if (ticket.status === "open") active++;
      if (ticket.status === "won" || ticket.status === "claimed") {
        won++;
        returned += ticket.payout;
      }
    }
    return { staked, active, won, returned, count: r.length + parlays.length };
  }, [rows, parlays]);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
        <h1 className="mt-6 text-2xl font-bold">My bets</h1>
        <p className="mt-1 text-sm text-muted">Your bets across every World Cup match.</p>

        {wallet.kind === "none" ? (
          <div className="mt-8 rounded-xl border border-edge bg-surface p-8 text-center">
            <p className="text-sm text-muted">Connect a wallet to see your bets.</p>
            <button onClick={wallet.openConnect} className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600">
              Connect
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total staked" value={<><SolIcon className="h-3.5 w-3.5" /> {fmtSol(summary.staked)}</>} />
              <Stat label="Active" value={summary.active} />
              <Stat label="Won" value={summary.won} accent="yes" />
              <Stat label="Returned" value={<><SolIcon className="h-3.5 w-3.5" /> {fmtSol(summary.returned)}</>} accent="yes" />
            </div>

            {rows === null && <div className="mt-5 h-40 animate-pulse rounded-xl border border-edge bg-surface" />}
            {rows && rows.length === 0 && parlays.length === 0 && (
              <div className="mt-5 rounded-xl border border-edge bg-surface p-8 text-center text-sm text-muted">
                No bets yet.{" "}
                <Link href="/" className="text-brand hover:underline">
                  Browse markets
                </Link>
              </div>
            )}

            <div className="mt-5 space-y-2">
              {parlays.map((row) => <ParlayBetRow key={row.ticket.publicKey} row={row} fixtureName={fixtures[row.ticket.fixtureId]} />)}
              {rows?.map((r) => (
                <BetRow key={r.pos.market} row={r} fixtureName={fixtures[r.m.fixtureId]} />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function ParlayBetRow({ row, fixtureName }: { row: ParlayRow; fixtureName?: string }) {
  const { ticket, markets } = row;
  const status = ticket.status === "open"
    ? { text: "Open", cls: "bg-yes/15 text-yes" }
    : ticket.status === "lost"
    ? { text: "Lost", cls: "bg-no/15 text-no" }
    : ticket.status === "claimed"
    ? { text: "Paid", cls: "bg-yes/15 text-yes" }
    : { text: "Won", cls: "bg-yes/15 text-yes" };
  return (
    <Link href={`/fixture/${ticket.fixtureId}`} className="flex items-center gap-3 rounded-xl border border-brand/30 bg-surface px-4 py-3 transition hover:border-brand/60">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{ticket.legs.length}-pick parlay</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", status.cls)}>{status.text}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">{fixtureName || `Fixture ${ticket.fixtureId}`} · {markets.map((m) => m.description).join(" · ")}</div>
      </div>
      <div className="shrink-0 text-right text-sm">
        <div>{fmtSol(ticket.stake)} SOL · {(ticket.oddsBps / 10_000).toFixed(2)}×</div>
        <div className="text-[11px] text-yes">Pays {fmtSol(ticket.payout)} SOL</div>
      </div>
      <ChevronRight className="h-4 w-4 text-faint" />
    </Link>
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

function BetRow({ row, fixtureName }: { row: Row; fixtureName?: string }) {
  const { pos, m } = row;
  const phase = marketPhase(m);
  const win = (m.outcome === "yes" && pos.yesAmount > 0) || (m.outcome === "no" && pos.noAmount > 0);
  const payout = win ? projectedPayout(m.totalYes, m.totalNo, m.outcome as "yes" | "no", m.outcome === "yes" ? pos.yesAmount : pos.noAmount, m.feeBps) : 0;

  const status =
    phase === "open"
      ? { text: "Open", cls: "bg-yes/15 text-yes" }
      : phase === "settling"
      ? { text: "Resolving", cls: "bg-amber-500/15 text-amber-400" }
      : phase === "resolved"
      ? win
        ? { text: "Won", cls: "bg-yes/15 text-yes" }
        : { text: "Lost", cls: "bg-no/15 text-no" }
      : { text: "Refunded", cls: "bg-raised text-muted" };

  return (
    <Link href={`/fixture/${m.fixtureId}`} className="flex items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3 transition hover:border-faint">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{m.description}</span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", status.cls)}>{status.text}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">{fixtureName || `Fixture ${m.fixtureId}`}</div>
      </div>

      <div className="shrink-0 text-right">
        <div className="flex items-center justify-end gap-1.5 text-sm">
          {pos.yesAmount > 0 && <span className="font-medium text-yes">{fmtSol(pos.yesAmount)} Yes</span>}
          {pos.noAmount > 0 && <span className="font-medium text-no">{fmtSol(pos.noAmount)} No</span>}
        </div>
        {phase === "resolved" && win && <div className="text-[11px] text-yes">+{fmtSol(payout)} SOL</div>}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
    </Link>
  );
}
