"use client";

import { ChevronRight, LockKeyhole } from "lucide-react";
import { OnsideMarket, Position, marketPhase, marketChance } from "@/lib/markets";
import { Consensus } from "@/lib/odds";
import { Sparkline } from "@/components/OddsChart";
import { cn } from "@/lib/utils";

export function MarketList({
  markets,
  selected,
  onSelect,
  consensusMap,
  seriesMap,
  positions,
  picks,
  onPick,
}: {
  markets: OnsideMarket[];
  selected: string | null;
  onSelect: (pubkey: string) => void;
  consensusMap: Record<string, Consensus | null>;
  seriesMap: Record<string, { t: number; pct: number }[]>;
  positions: Record<string, Position>;
  picks?: Record<string, "yes" | "no">;
  onPick?: (market: OnsideMarket, side: "yes" | "no", chance: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface">
      <div className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-2 border-b border-edge bg-raised/70 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted sm:grid-cols-[minmax(0,1fr)_110px_110px]">
        <span>Market</span><span className="text-center">Yes</span><span className="text-center">No</span>
      </div>
      {markets.map((m, index) => (
        <Row
          key={m.publicKey}
          m={m}
          active={selected === m.publicKey}
          onSelect={() => onSelect(m.publicKey)}
          consensus={consensusMap[m.publicKey]}
          series={seriesMap[m.publicKey] || []}
          position={positions[m.publicKey]}
          pick={picks?.[m.publicKey]}
          onPick={onPick}
          last={index === markets.length - 1}
        />
      ))}
    </div>
  );
}

function Row({
  m,
  active,
  onSelect,
  consensus,
  series,
  position,
  pick,
  onPick,
  last,
}: {
  m: OnsideMarket;
  active: boolean;
  onSelect: () => void;
  consensus?: Consensus | null;
  series: { t: number; pct: number }[];
  position?: Position;
  pick?: "yes" | "no";
  onPick?: (market: OnsideMarket, side: "yes" | "no", chance: number) => void;
  last: boolean;
}) {
  const phase = marketPhase(m);
  const seriesLast = series.length ? series[series.length - 1].pct : null;
  const chance = marketChance(m, consensus?.pct ?? null, seriesLast);
  const pool = m.totalYes + m.totalNo;
  const quoteChance = pool > 0 ? (100 * m.totalYes) / pool : 50;
  const hasPos = (position?.yesAmount ?? 0) > 0 || (position?.noAmount ?? 0) > 0;
  const yesOdds = 0.95 / Math.max(0.1, Math.min(0.9, quoteChance / 100));
  const noOdds = 0.95 / Math.max(0.1, Math.min(0.9, 1 - quoteChance / 100));

  const dot =
    phase === "open" ? "bg-yes" : phase === "settling" ? "bg-amber-400" : phase === "resolved" ? (m.outcome === "yes" ? "bg-yes" : "bg-no") : "bg-faint";
  const statusLabel = phase === "open" ? "Open" : phase === "settling" ? "Resolving" : phase === "resolved" ? "Resolved" : "Cancelled";

  return (
    <div
      className={cn(
        "grid min-h-16 w-full grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-2 px-3 py-2.5 text-left sm:grid-cols-[minmax(0,1fr)_110px_110px]",
        !last && "border-b border-edge",
        active && "bg-brand/5"
      )}
    >
      <button onClick={onSelect} className="flex min-h-11 min-w-0 items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-brand">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot, phase === "open" && "animate-pulse")} />
          <span className="truncate text-sm font-semibold">{m.description}</span>
          {hasPos && <span className="hidden shrink-0 rounded bg-raised px-1.5 py-0.5 text-[10px] font-semibold text-muted sm:inline">YOURS</span>}
          </span>
          <span className="flex items-center gap-2 pl-3.5 text-xs text-muted"><span>{statusLabel}</span><Sparkline points={series} className="hidden h-4 w-16 lg:block" /></span>
        </span>
      </button>

      {phase === "open" && chance != null && onPick ? (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onPick(m, "yes", quoteChance); }}
            aria-pressed={pick === "yes"}
            className={cn("flex min-h-11 flex-col items-center justify-center rounded-md border px-2 font-mono text-sm font-bold tabular-nums transition-colors duration-100 active:translate-y-px focus-visible:ring-2 focus-visible:ring-brand", pick === "yes" ? "border-brand bg-brand text-white" : "border-brand/20 bg-brand/10 text-brand hover:bg-brand/20")}
          ><span className="text-[10px] font-sans font-medium uppercase opacity-75 sm:hidden">Yes</span>{yesOdds.toFixed(2)}</button>
          <button
            onClick={(e) => { e.stopPropagation(); onPick(m, "no", quoteChance); }}
            aria-pressed={pick === "no"}
            className={cn("flex min-h-11 flex-col items-center justify-center rounded-md border px-2 font-mono text-sm font-bold tabular-nums transition-colors duration-100 active:translate-y-px focus-visible:ring-2 focus-visible:ring-brand", pick === "no" ? "border-brand bg-brand text-white" : "border-brand/20 bg-brand/10 text-brand hover:bg-brand/20")}
          ><span className="text-[10px] font-sans font-medium uppercase opacity-75 sm:hidden">No</span>{noOdds.toFixed(2)}</button>
        </>
      ) : phase === "resolved" ? (
        <><span className={cn("text-center text-sm font-bold", m.outcome === "yes" ? "text-yes" : "text-muted")}>{m.outcome === "yes" ? "Won" : "—"}</span><span className={cn("text-center text-sm font-bold", m.outcome === "no" ? "text-yes" : "text-muted")}>{m.outcome === "no" ? "Won" : "—"}</span></>
      ) : chance != null ? (
        <><span className="flex justify-center text-muted"><LockKeyhole className="h-4 w-4" /></span><span className="flex justify-center text-muted"><LockKeyhole className="h-4 w-4" /></span></>
      ) : (
        <><ChevronRight className="mx-auto h-4 w-4 text-faint" /><ChevronRight className="mx-auto h-4 w-4 text-faint" /></>
      )}
    </div>
  );
}
