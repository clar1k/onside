"use client";

import { CheckCircle2, XCircle, Radio, ShieldCheck } from "lucide-react";
import { OnsideMarket, Position, impliedYesPct, marketPhase, fmtCountdown, marketChance, positionValue } from "@/lib/markets";
import { Consensus } from "@/lib/odds";
import { ProbChart } from "@/components/OddsChart";
import { ProofReceipt } from "@/components/ProofReceipt";
import { Spinner, SolIcon } from "@/components/icons";
import { cn, fmtSol } from "@/lib/utils";

function explain(desc: string): string {
  const over = /Over\s+(\d+(?:\.\d+)?)\s+(.+)/i.exec(desc);
  if (over) return `You win if there are ${Math.ceil(parseFloat(over[1]))} or more ${over[2].trim()} in the match`;
  if (/red card/i.test(desc)) return "You win if a red card is shown in the match";
  const win = /(.+?)\s+to win/i.exec(desc);
  if (win) return `You win if ${win[1].trim()} wins the match`;
  const score = /(.+?)\s+to score/i.exec(desc);
  if (score) return `You win if ${score[1].trim()} scores`;
  return "Back Yes or No on this outcome";
}

export function MarketDetail({
  m,
  position,
  consensus,
  series,
  live,
  busy,
  onSettle,
}: {
  m: OnsideMarket;
  position?: Position;
  consensus?: Consensus | null;
  series?: { t: number; pct: number }[];
  live?: boolean;
  busy?: boolean;
  onSettle: (m: OnsideMarket) => void;
}) {
  const phase = marketPhase(m);
  const pool = m.totalYes + m.totalNo;
  const hasLiquidity = pool > 0;
  const consPct = consensus?.pct ?? null;
  const seriesLast = series && series.length ? series[series.length - 1].pct : null;
  const chance = marketChance(m, consPct, seriesLast);

  const youYes = position?.yesAmount ?? 0;
  const youNo = position?.noAmount ?? 0;

  const chartSeries = series && series.length > 1 ? [{ label: "Chance", color: "#3db468", points: series }] : [];
  const hasChart = chartSeries.length > 0;
  const loadingOdds = series === undefined;

  return (
    <div className="rounded-xl border border-edge bg-surface">
      <div className="border-b border-edge p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{m.description}</h2>
            <p className="mt-0.5 text-sm text-muted">{explain(m.description)}</p>
          </div>
          <StatusPill phase={phase} m={m} live={live} />
        </div>

        <div className="mt-4 flex items-end gap-6">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tabular-nums text-yes">{chance != null ? `${chance}%` : "—"}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted">{chance != null ? "chance of Yes" : "no odds yet · set at first bet"}</div>
          </div>
          {hasLiquidity && (
            <div className="ml-auto text-right">
              <div className="flex items-baseline justify-end gap-1">
                <span className="text-xl font-bold tabular-nums">{fmtSol(pool)}</span>
                <span className="text-xs font-semibold text-muted">SOL</span>
              </div>
              <div className="mt-0.5 text-xs text-muted">in the pool</div>
            </div>
          )}
        </div>
      </div>

      {(youYes > 0 || youNo > 0) && (phase === "open" || phase === "settling") && (
        <div className="border-b border-edge px-4 py-3 sm:px-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Your position</div>
          <div className="space-y-2">
            {youYes > 0 && <PositionRow side="yes" stake={youYes} payout={positionValue(m, "yes", youYes)} />}
            {youNo > 0 && <PositionRow side="no" stake={youNo} payout={positionValue(m, "no", youNo)} />}
          </div>
        </div>
      )}

      {(hasChart || loadingOdds) && (
        <div className="p-4 sm:p-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Chance over time · live odds</div>
          {hasChart ? <ProbChart series={chartSeries} /> : <ChartSkeleton />}
        </div>
      )}

      {hasLiquidity && (
        <div className={cn("px-4 pb-4 sm:px-5", !hasChart && !loadingOdds && "pt-4")}>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Where the crowd is</div>
          <div className="flex h-7 overflow-hidden rounded-lg text-[11px] font-semibold">
            <div className="flex items-center justify-start bg-yes/20 pl-2 text-yes" style={{ width: `${Math.max(impliedYesPct(m), 12)}%` }}>
              Yes {fmtSol(m.totalYes)}
            </div>
            <div className="flex flex-1 items-center justify-end bg-no/20 pr-2 text-no">{fmtSol(m.totalNo)} No</div>
          </div>
        </div>
      )}

      {phase === "settling" && (
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-edge px-4 py-3 text-sm text-muted sm:px-5">
          <Spinner className="h-4 w-4" /> Betting closed — winners are paid automatically once the result is confirmed.
          <button data-testid="settle-btn" onClick={() => onSettle(m)} disabled={busy} className="text-[11px] underline-offset-2 transition hover:text-ink hover:underline disabled:opacity-50">
            {busy ? "confirming…" : "confirm now"}
          </button>
        </div>
      )}

      {phase === "resolved" && (
        <div className={cn("flex items-center justify-center gap-2 border-t border-edge px-4 py-3 text-base font-semibold sm:px-5", m.outcome === "yes" ? "text-yes" : "text-no")}>
          {m.outcome === "yes" ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          {m.outcome === "yes" ? "Yes" : "No"} won
          {(youYes > 0 || youNo > 0) && (m.outcome === "yes" ? youYes > 0 : youNo > 0) && <span className="text-muted">· you won</span>}
        </div>
      )}

      {phase === "resolved" && <ProofReceipt market={m} />}
    </div>
  );
}

function PositionRow({ side, stake, payout }: { side: "yes" | "no"; stake: number; payout: number }) {
  const isYes = side === "yes";
  return (
    <div className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2.5">
      <span className="inline-flex items-center gap-2">
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold uppercase", isYes ? "bg-yes/15 text-yes" : "bg-no/15 text-no")}>{isYes ? "Yes" : "No"}</span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
          <SolIcon className="h-3 w-3" /> {fmtSol(stake)}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 text-sm">
        <span className="text-muted">to win</span>
        <span className={cn("inline-flex items-center gap-1 font-bold tabular-nums", isYes ? "text-yes" : "text-no")}>
          <SolIcon className="h-3 w-3" /> {fmtSol(payout)}
        </span>
      </span>
    </div>
  );
}

function StatusPill({ phase, m, live }: { phase: string; m: OnsideMarket; live?: boolean }) {
  if (phase === "open") {
    const left = m.closeTs - Date.now() / 1000;
    // A 30-day betting window shouldn't read as a scary "708h" countdown — only surface a
    // countdown when the close is actually near; otherwise the market is simply "Open".
    const soon = left <= 48 * 3600;
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-yes/15 px-2.5 py-1 text-xs font-semibold text-yes">
        {live && <Radio className="h-3 w-3 animate-pulse" />}
        {live ? "Live" : "Open"}
        {soon && ` · closes in ${fmtCountdown(left)}`}
      </span>
    );
  }
  if (phase === "settling")
    return <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400"><Spinner className="h-3 w-3" /> Resolving</span>;
  if (phase === "resolved")
    return <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", m.outcome === "yes" ? "bg-yes/15 text-yes" : "bg-no/15 text-no")}>Resolved</span>;
  return <span className="shrink-0 rounded-full bg-raised px-2.5 py-1 text-xs font-semibold text-muted">Cancelled</span>;
}

function ChartSkeleton() {
  return (
    <div className="relative h-[230px] overflow-hidden rounded-lg border border-edge bg-canvas">
      <div className="absolute inset-x-0 top-1/4 h-px animate-pulse bg-edge" />
      <div className="absolute inset-x-0 top-1/2 h-px animate-pulse bg-edge" />
      <div className="absolute inset-x-0 top-3/4 h-px animate-pulse bg-edge" />
      <div className="flex h-full items-center justify-center text-xs text-faint">Loading live odds…</div>
    </div>
  );
}
