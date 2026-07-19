"use client";

import { Radio } from "lucide-react";
import { FixtureOdds } from "@/lib/odds";
import { cn } from "@/lib/utils";

type Score = { g1: number; g2: number; minute: number; running: boolean } | null;

export function ScoreBoard({
  p1,
  p2,
  score,
  startTime,
  odds,
  loading,
}: {
  p1?: string;
  p2?: string;
  score: Score;
  startTime?: number;
  odds: FixtureOdds | null;
  loading?: boolean;
}) {
  if (loading) return <ScoreBoardSkeleton />;

  return (
    <section className="overflow-hidden rounded-xl border border-edge bg-surface">
      <div className="flex items-center justify-between gap-4 p-5 sm:p-6">
        <TeamName name={p1} align="left" />
        <div className="shrink-0 px-2 text-center">
          <div className="text-4xl font-bold tabular-nums sm:text-5xl">{score ? `${score.g1} – ${score.g2}` : "vs"}</div>
          <div className="mt-1.5 flex items-center justify-center text-xs">
            {score && (score.running || odds?.inRunning) ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-no/15 px-2 py-0.5 font-semibold uppercase tracking-wide text-no">
                <Radio className="h-3 w-3 animate-pulse" />
                {score.running ? `${score.minute}'` : "Live"}
              </span>
            ) : score ? (
              <span className="font-semibold uppercase tracking-wide text-muted">Full time</span>
            ) : (
              <span className="text-muted">
                {startTime ? new Date(startTime).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "Kick-off soon"}
              </span>
            )}
          </div>
        </div>
        <TeamName name={p2} align="right" />
      </div>

      {odds && (odds.p1 != null || odds.p2 != null) && (
        <div className="border-t border-edge px-5 pb-4 pt-3 sm:px-6">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted">
            <span>Who will win?</span>
            <span className="text-faint">live odds · TxODDS</span>
          </div>
          <WinBar p1={odds.p1} draw={odds.draw} p2={odds.p2} n1={p1} n2={p2} />
        </div>
      )}
    </section>
  );
}

function WinBar({ p1, draw, p2, n1, n2 }: { p1: number | null; draw: number | null; p2: number | null; n1?: string; n2?: string }) {
  const a = p1 ?? 0;
  const d = draw ?? 0;
  const b = p2 ?? 0;
  const sum = a + d + b || 1;
  const seg = (v: number) => `${(100 * v) / sum}%`;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full bg-yes" style={{ width: seg(a) }} />
        <div className="h-full bg-faint" style={{ width: seg(d) }} />
        <div className="h-full bg-brand" style={{ width: seg(b) }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-yes">
          <Dot className="bg-yes" /> {short(n1)} {fmtPct(p1)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted">
          <Dot className="bg-faint" /> Draw {fmtPct(draw)}
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium text-brand">
          {short(n2)} {fmtPct(p2)} <Dot className="bg-brand" />
        </span>
      </div>
    </div>
  );
}

function ScoreBoardSkeleton() {
  return (
    <section className="overflow-hidden rounded-xl border border-edge bg-surface">
      <div className="flex items-center justify-between gap-4 p-5 sm:p-6">
        <div className="h-7 w-32 animate-pulse rounded-lg bg-raised" />
        <div className="h-10 w-20 shrink-0 animate-pulse rounded-lg bg-raised" />
        <div className="h-7 w-32 animate-pulse rounded-lg bg-raised" />
      </div>
      <div className="border-t border-edge px-5 pb-5 pt-4 sm:px-6">
        <div className="h-2.5 w-full animate-pulse rounded-full bg-raised" />
      </div>
    </section>
  );
}

const Dot = ({ className }: { className: string }) => <span className={cn("inline-block h-2 w-2 rounded-full", className)} />;
const fmtPct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
const short = (s?: string) => (s ? (s.length > 12 ? s.slice(0, 11) + "…" : s) : "—");

function TeamName({ name, align }: { name?: string; align: "left" | "right" }) {
  return (
    <div className={cn("min-w-0 flex-1", align === "right" ? "text-right" : "text-left")}>
      <div className="truncate text-lg font-bold leading-tight sm:text-2xl">{name || "—"}</div>
    </div>
  );
}
