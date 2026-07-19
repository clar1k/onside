"use client";

import { useEffect, useState } from "react";
import { MatchState, eventMeta, BroadcastEvent } from "@/lib/broadcast";
import { flag } from "@/lib/flags";
import { cn } from "@/lib/utils";

type TeamInfo = { badge?: string | null; stadium?: string | null; formed?: string | null; players?: { name: string; pos: string }[] };
const teamCache = new Map<string, TeamInfo | null>();
async function fetchTeam(name: string): Promise<TeamInfo | null> {
  if (!name) return null;
  if (teamCache.has(name)) return teamCache.get(name)!;
  try {
    const d = await fetch(`/api/team?name=${encodeURIComponent(name)}`).then((r) => r.json());
    const info: TeamInfo | null = d?.found ? { badge: d.badge, stadium: d.stadium, formed: d.formed, players: d.players || [] } : null;
    teamCache.set(name, info);
    return info;
  } catch {
    return null;
  }
}

/**
 * Team + match info: real crests + squads (via TheSportsDB — TxODDS has no team/player
 * data), competition, kick-off, home/away, and — once the match is running — a live
 * team-stats comparison + a goal/card timeline from the TxODDS feed.
 */
export function MatchDetails({
  p1 = "Home",
  p2 = "Away",
  state,
  competition,
  startTime,
  p1Home,
}: {
  p1?: string;
  p2?: string;
  state: MatchState;
  competition?: string;
  startTime?: number;
  p1Home?: boolean;
}) {
  const hasStats = state.phase === "live" || state.phase === "ended";
  const [t1, setT1] = useState<TeamInfo | null>(null);
  const [t2, setT2] = useState<TeamInfo | null>(null);
  useEffect(() => {
    let ok = true;
    if (p1 && p1 !== "Home") fetchTeam(p1).then((t) => ok && setT1(t));
    return () => {
      ok = false;
    };
  }, [p1]);
  useEffect(() => {
    let ok = true;
    if (p2 && p2 !== "Away") fetchTeam(p2).then((t) => ok && setT2(t));
    return () => {
      ok = false;
    };
  }, [p2]);
  const hasSquads = !!(t1?.players?.length || t2?.players?.length);

  return (
    <section className="rounded-xl border border-edge bg-surface p-4 sm:p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Match details</h2>

      {/* team headers with real crests (flag fallback) */}
      <div className="mt-3 flex items-stretch gap-3">
        <TeamHead name={p1} home={p1Home} badge={t1?.badge} />
        <div className="flex shrink-0 items-center text-xs font-semibold uppercase tracking-wide text-faint">vs</div>
        <TeamHead name={p2} home={p1Home === undefined ? undefined : !p1Home} badge={t2?.badge} right />
      </div>

      {/* info grid */}
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge/40 sm:grid-cols-3">
        <Info label="Competition" value={competition || "World Cup"} />
        <Info label="Kick-off" value={fmtKickoff(startTime)} />
        <Info label="Home side" value={p1Home === undefined ? "—" : p1Home ? p1 : p2} />
      </div>

      {hasStats ? (
        <>
          <StatCompare state={state} p1={p1} p2={p2} />
          {state.timeline.length > 0 && <Timeline state={state} p1={p1} p2={p2} />}
        </>
      ) : (
        <p className="mt-4 text-xs text-faint">Live stats, goals and cards appear here the moment the match kicks off.</p>
      )}

      {hasSquads && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Squads</div>
          <div className="grid grid-cols-2 gap-3">
            <SquadCol team={t1} name={p1} />
            <SquadCol team={t2} name={p2} />
          </div>
          <p className="mt-2 text-[10px] text-faint">Crests &amp; squads via TheSportsDB — each team&apos;s roster, not the match-day XI.</p>
        </div>
      )}
    </section>
  );
}

function TeamHead({ name, home, badge, right }: { name: string; home?: boolean; badge?: string | null; right?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2.5", right && "flex-row-reverse text-right")}>
      {badge ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={badge} alt="" className="h-7 w-7 shrink-0 object-contain" />
      ) : (
        <span className="text-2xl leading-none">{flag(name) || "🏳️"}</span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{name}</span>
        {home !== undefined && (
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{home ? "Home" : "Away"}</span>
        )}
      </span>
    </div>
  );
}

function SquadCol({ team, name }: { team: TeamInfo | null; name: string }) {
  const players = team?.players?.slice(0, 16) || [];
  return (
    <div className="rounded-lg border border-edge bg-canvas p-2.5">
      <div className="mb-2 flex items-center gap-2">
        {team?.badge ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.badge} alt="" className="h-5 w-5 shrink-0 object-contain" />
        ) : (
          <span className="text-base leading-none">{flag(name) || "🏳️"}</span>
        )}
        <span className="truncate text-xs font-bold">{name}</span>
      </div>
      {players.length ? (
        <ul className="space-y-1">
          {players.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate">{p.name}</span>
              {p.pos && <span className="shrink-0 text-faint">{p.pos.slice(0, 3).toUpperCase()}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-faint">Squad not listed.</p>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function StatCompare({ state, p1, p2 }: { state: MatchState; p1: string; p2: string }) {
  const rows: { label: string; a: number; b: number }[] = [
    { label: "Goals", a: state.g1, b: state.g2 },
    { label: "Corners", a: state.c1, b: state.c2 },
    { label: "Yellow cards", a: state.y1, b: state.y2 },
  ];
  if (state.r1 || state.r2) rows.push({ label: "Red cards", a: state.r1, b: state.r2 });

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide">
        <span className="truncate text-yes">{p1}</span>
        <span className="text-faint">Team stats</span>
        <span className="truncate text-brand">{p2}</span>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const sum = r.a + r.b || 1;
          return (
            <div key={r.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="w-6 text-left font-bold tabular-nums text-yes">{r.a}</span>
                <span className="text-muted">{r.label}</span>
                <span className="w-6 text-right font-bold tabular-nums text-brand">{r.b}</span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-raised">
                <div className="bg-yes" style={{ width: `${(100 * r.a) / sum}%` }} />
                <div className="bg-brand" style={{ width: `${(100 * r.b) / sum}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Timeline({ state, p1, p2 }: { state: MatchState; p1: string; p2: string }) {
  const items: BroadcastEvent[] = [...state.timeline].reverse().slice(0, 12);
  return (
    <div className="mt-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Match events</div>
      <ul className="divide-y divide-edge/50 overflow-hidden rounded-lg border border-edge">
        {items.map((e, i) => {
          const m = eventMeta(e.kind);
          return (
            <li key={`${e.seq}-${e.kind}-${e.team}-${i}`} className="flex items-center gap-2.5 px-3 py-2 text-sm">
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted">{e.minute}&apos;</span>
              <span className="text-base leading-none" aria-hidden>
                {m.emoji}
              </span>
              <span className="font-medium">{m.label}</span>
              <span className="ml-auto truncate pl-2 text-xs text-muted">{e.team === 1 ? p1 : p2}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function fmtKickoff(t?: number): string {
  if (!t) return "TBD";
  try {
    return new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "TBD";
  }
}
