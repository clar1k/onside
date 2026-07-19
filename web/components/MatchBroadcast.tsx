"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X } from "lucide-react";
import { MatchState, eventMeta } from "@/lib/broadcast";
import { streamEmbed } from "@/lib/streamEmbed";
import { cn } from "@/lib/utils";

interface Odds {
  p1?: number;
  draw?: number;
  p2?: number;
  inRunning?: boolean;
}

const STREAM_KEY = "onside_stream_url_v1";

/**
 * Polymarket-style match "broadcast" player. If a fixture carries an embeddable public
 * stream (Twitch/YouTube/Kick) it shows the real video iframe — same mechanism as
 * Polymarket/PolyGaming. Otherwise (licensed sports like the World Cup, which aren't
 * embeddable) it falls back to a live DATA broadcast driven by the TxODDS feed:
 * ticking clock, score, event ticker and a live win-probability bar. Can pop out into a
 * floating mini-player so you can keep watching while you browse markets and bet.
 */
export function MatchBroadcast({
  p1 = "Home",
  p2 = "Away",
  state,
  odds,
  live,
  streamUrl,
  startTime,
  loading,
}: {
  p1?: string;
  p2?: string;
  state: MatchState;
  odds?: Odds | null;
  live?: boolean;
  streamUrl?: string | null;
  startTime?: number;
  loading?: boolean;
}) {
  const [pip, setPip] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Stream URL: a user override in localStorage wins, else the fixture/default stream.
  // "off" = the user explicitly chose the data tracker instead of a video stream.
  const [storedStream, setStoredStream] = useState<string | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  useEffect(() => {
    setStoredStream(localStorage.getItem(STREAM_KEY));
    setStreamReady(true);
  }, []);
  const effectiveUrl = !streamReady ? streamUrl : storedStream === "off" ? null : storedStream || streamUrl;
  const embed = useMemo(() => streamEmbed(effectiveUrl), [effectiveUrl]);
  const changeStream = () => {
    const cur = storedStream && storedStream !== "off" ? storedStream : streamUrl || "";
    const url = window.prompt("Paste a live stream URL (YouTube, Twitch or Kick).\nLeave empty to use the live data tracker instead.", cur);
    if (url === null) return;
    const v = url.trim() || "off";
    localStorage.setItem(STREAM_KEY, v);
    setStoredStream(v);
  };

  // Smooth ticking clock: sync to the feed value, advance locally while the match runs.
  const [sec, setSec] = useState(state.seconds);
  useEffect(() => setSec(state.seconds), [state.seconds]);
  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state.running, state.seconds]);

  const isLive = state.phase === "live";
  const statusText = state.phase === "pre" ? "Pre-match" : state.phase === "ended" ? "Full time" : "Live";
  const clock = state.phase === "live" ? `${Math.min(Math.floor(sec / 60), 120)}'` : state.phase === "ended" ? "FT" : "";

  const header = (
    <div className="flex items-center justify-between gap-2 border-b border-edge/70 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            isLive ? "bg-no/15 text-no" : "bg-raised text-muted"
          )}
        >
          {isLive && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-no opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-no" />
            </span>
          )}
          {statusText}
        </span>
        <span className="truncate text-xs font-medium text-muted">
          Match Centre · <span className="text-faint">{embed ? `live stream · ${embed.site}` : "TxODDS live feed"}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={changeStream}
          title="Set or change the live video stream"
          className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-muted transition hover:bg-raised hover:text-ink"
        >
          {embed ? "Change stream" : "+ Add stream"}
        </button>
        <button
          onClick={() => setPip((v) => !v)}
          title={pip ? "Dock back into the page" : "Pop out into a mini-player"}
          aria-label={pip ? "Dock back" : "Pop out"}
          className="rounded-md p-1 text-muted transition hover:bg-raised hover:text-ink"
        >
          {pip ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        {pip && (
          <button onClick={() => setPip(false)} title="Close mini-player" aria-label="Close" className="rounded-md p-1 text-muted transition hover:bg-raised hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  const screen = <Screen p1={p1} p2={p2} state={state} odds={odds} embed={embed?.src} clock={clock} startTime={startTime} loading={loading} />;

  // Floating mini-player (portal to body, fixed bottom-right).
  if (pip) {
    const pipEl = (
      <div className="fixed bottom-4 right-4 z-[60] w-[340px] max-w-[calc(100vw-2rem)] animate-fade-up overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl">
        {header}
        {screen}
      </div>
    );
    return (
      <>
        <div className="overflow-hidden rounded-xl border border-edge bg-surface">
          {header}
          <div className="flex aspect-[16/7] flex-col items-center justify-center bg-canvas text-center text-sm text-muted">
            <p>Playing in the mini-player ↘</p>
            <button onClick={() => setPip(false)} className="mt-1 text-xs font-medium text-brand hover:underline">
              Dock it back here
            </button>
          </div>
        </div>
        {mounted && createPortal(pipEl, document.body)}
      </>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface">
      {header}
      {screen}
      <BelowScreen p1={p1} p2={p2} state={state} />
    </div>
  );
}

function Screen({
  p1,
  p2,
  state,
  odds,
  embed,
  clock,
  startTime,
  loading,
}: {
  p1: string;
  p2: string;
  state: MatchState;
  odds?: Odds | null;
  embed?: string;
  clock: string;
  startTime?: number;
  loading?: boolean;
}) {
  if (embed) {
    return (
      <div className="relative aspect-video bg-black">
        {/* eslint-disable-next-line jsx-a11y/iframe-has-title */}
        <iframe
          title="Live match stream"
          src={embed}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className="relative aspect-[16/7] w-full overflow-hidden">
      <Pitch />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/40" />

      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-40 animate-pulse rounded-md bg-white/10" />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col px-3 py-2.5 sm:px-4">
          {/* score row */}
          <div className="flex items-center justify-center gap-4 sm:gap-6">
            <TeamSide name={p1} tone="yes" align="right" />
            <div className="text-center">
              <div className="whitespace-nowrap text-3xl font-bold tabular-nums text-white drop-shadow sm:text-4xl">
                {state.phase === "pre" ? <span className="text-2xl text-white/60">vs</span> : `${state.g1} – ${state.g2}`}
              </div>
            </div>
            <TeamSide name={p2} tone="brand" align="left" />
          </div>

          {/* clock / countdown */}
          <div className="mt-1 text-center">
            {state.phase === "live" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-no" />
                {clock}
              </span>
            )}
            {state.phase === "ended" && <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs font-semibold text-white/80">Full time</span>}
            {state.phase === "pre" && <Countdown startTime={startTime} />}
          </div>

          <LastEventFlash state={state} p1={p1} p2={p2} />

          <div className="mt-auto">
            <MomentumBar odds={odds} p1={p1} p2={p2} />
          </div>
        </div>
      )}
    </div>
  );
}

function TeamSide({ name, tone, align }: { name: string; tone: "yes" | "brand"; align: "left" | "right" }) {
  const initials = name.slice(0, 3).toUpperCase();
  return (
    <div className={cn("flex min-w-0 items-center gap-2", align === "right" ? "flex-row justify-end" : "flex-row-reverse justify-end")}>
      <span className="truncate text-sm font-semibold text-white drop-shadow sm:text-base">{name}</span>
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow", tone === "yes" ? "bg-yes" : "bg-brand")}>
        {initials}
      </span>
    </div>
  );
}

function LastEventFlash({ state, p1, p2 }: { state: MatchState; p1: string; p2: string }) {
  const last = state.timeline[state.timeline.length - 1];
  if (!last || state.phase !== "live") return null;
  const m = eventMeta(last.kind);
  return (
    <div className="mt-1.5 flex justify-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
        <span aria-hidden>{m.emoji}</span> {m.label} · {last.team === 1 ? p1 : p2} <span className="text-white/60">{last.minute}&apos;</span>
      </span>
    </div>
  );
}

function MomentumBar({ odds, p1, p2 }: { odds?: Odds | null; p1: string; p2: string }) {
  if (!odds || (odds.p1 == null && odds.p2 == null)) return null;
  const a = Math.max(0, odds.p1 ?? 0);
  const d = Math.max(0, odds.draw ?? 0);
  const b = Math.max(0, odds.p2 ?? 0);
  const sum = a + d + b || 1;
  const pa = Math.round((a / sum) * 100);
  const pd = Math.round((d / sum) * 100);
  const pb = Math.max(0, 100 - pa - pd);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-white/75">
        <span className="truncate">{p1} {pa}%</span>
        <span className="text-white/45">Draw {pd}%</span>
        <span className="truncate">{pb}% {p2}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10">
        <div style={{ width: `${pa}%` }} className="bg-yes" />
        <div style={{ width: `${pd}%` }} className="bg-white/30" />
        <div style={{ width: `${pb}%` }} className="bg-brand" />
      </div>
    </div>
  );
}

function Countdown({ startTime }: { startTime?: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!startTime || now == null) return <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white/80">Kick-off soon</span>;
  const diff = startTime - now;
  if (diff <= 0) return <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white/80">Starting soon</span>;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const d = Math.floor(h / 24);
  const label = d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return <span className="rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white/80">Kicks off in {label}</span>;
}

function BelowScreen({ p1, p2, state }: { p1: string; p2: string; state: MatchState }) {
  return (
    <div className="border-t border-edge/70">
      <StatRow state={state} />
      <Ticker state={state} p1={p1} p2={p2} />
    </div>
  );
}

function StatRow({ state }: { state: MatchState }) {
  const rows: [string, number, number][] = [
    ["Corners", state.c1, state.c2],
    ["Yellow cards", state.y1, state.y2],
  ];
  if (state.r1 || state.r2) rows.push(["Red cards", state.r1, state.r2]);
  return (
    <div className="flex divide-x divide-edge/40 border-b border-edge/40">
      {rows.map(([label, a, b]) => (
        <div key={label} className="flex-1 px-3 py-2 text-center">
          <div className="text-sm font-bold tabular-nums">
            <span className="text-yes">{a}</span> <span className="text-faint">·</span> <span className="text-brand">{b}</span>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}

function Ticker({ state, p1, p2 }: { state: MatchState; p1: string; p2: string }) {
  const items = [...state.timeline].reverse().slice(0, 16);
  if (!items.length) {
    return (
      <div className="px-3 py-5 text-center text-xs text-faint">
        {state.phase === "pre" ? "Match hasn't kicked off yet — events will stream in live." : "Goals, cards and corners will appear here live."}
      </div>
    );
  }
  return (
    <ul className="max-h-56 divide-y divide-edge/50 overflow-y-auto">
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
  );
}

function Pitch() {
  return (
    <svg viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="bcast-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#173a22" />
          <stop offset="1" stopColor="#0d2014" />
        </linearGradient>
      </defs>
      <rect width="320" height="140" fill="url(#bcast-grass)" />
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x={i * 40} width="20" height="140" fill="#ffffff" opacity="0.02" />
      ))}
      <g stroke="#ffffff" strokeOpacity="0.14" fill="none" strokeWidth="1">
        <rect x="6" y="6" width="308" height="128" />
        <line x1="160" y1="6" x2="160" y2="134" />
        <circle cx="160" cy="70" r="22" />
        <rect x="6" y="35" width="34" height="70" />
        <rect x="280" y="35" width="34" height="70" />
      </g>
    </svg>
  );
}
