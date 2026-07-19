// Turns the raw TxODDS scores event sequence into a live "match-centre broadcast" state:
// the current clock/score/stats plus a timeline of discrete events (goals, cards, corners)
// derived by diffing consecutive stat snapshots. This is what powers the data-driven
// broadcast — no video rights needed, just the feed we already stream over SSE.
//
// TxODDS match-level Stats keys: 1/2 = P1/P2 goals, 3/4 = P1/P2 yellow cards,
// 5/6 = P1/P2 red cards, 7/8 = P1/P2 corners. (Period-scoped keys like 1001+ are ignored.)

export type Phase = "pre" | "live" | "ended";
export type EventKind = "goal" | "yellow" | "red" | "corner";

export interface BroadcastEvent {
  seq: number;
  minute: number;
  kind: EventKind;
  team: 1 | 2;
}

export interface MatchState {
  phase: Phase;
  running: boolean;
  minute: number;
  seconds: number; // total elapsed match seconds (for a smooth ticking clock)
  g1: number;
  g2: number;
  y1: number;
  y2: number;
  r1: number;
  r2: number;
  c1: number;
  c2: number;
  timeline: BroadcastEvent[]; // newest last
}

const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : 0);

/** A "stat line" for one event, read from Stats map with Score.Total as a fallback. */
function statsOf(e: any): { g1: number; g2: number; y1: number; y2: number; r1: number; r2: number; c1: number; c2: number } {
  const s = e?.Stats || {};
  const t1 = e?.Score?.Participant1?.Total || {};
  const t2 = e?.Score?.Participant2?.Total || {};
  return {
    g1: num(s["1"]) || num(t1.Goals),
    g2: num(s["2"]) || num(t2.Goals),
    y1: num(s["3"]) || num(t1.YellowCards),
    y2: num(s["4"]) || num(t2.YellowCards),
    r1: num(s["5"]) || num(t1.RedCards),
    r2: num(s["6"]) || num(t2.RedCards),
    c1: num(s["7"]) || num(t1.Corners),
    c2: num(s["8"]) || num(t2.Corners),
  };
}

const KINDS: { key: EventKind; a: keyof ReturnType<typeof statsOf>; b: keyof ReturnType<typeof statsOf> }[] = [
  { key: "goal", a: "g1", b: "g2" },
  { key: "red", a: "r1", b: "r2" },
  { key: "yellow", a: "y1", b: "y2" },
  { key: "corner", a: "c1", b: "c2" },
];

export function buildMatchState(rawEvents: any, startTime?: number): MatchState {
  const events: any[] = Array.isArray(rawEvents) ? [...rawEvents] : [];
  // Chronological order by Seq (fall back to Ts) so diffs read forward in time.
  events.sort((a, b) => num(a?.Seq) - num(b?.Seq) || num(a?.Ts) - num(b?.Ts));

  const timeline: BroadcastEvent[] = [];
  let prev = statsOf({});
  let seenAny = false;
  let last: any = null;

  for (const e of events) {
    if (!e?.Stats && !e?.Score) continue;
    seenAny = true;
    last = e;
    const cur = statsOf(e);
    const minute = Math.floor(num(e?.Clock?.Seconds) / 60);
    const seq = num(e?.Seq);
    for (const { key, a, b } of KINDS) {
      for (const team of [1, 2] as const) {
        const field = team === 1 ? a : b;
        const delta = cur[field] - prev[field];
        // Emit one line per unit increase (a double-corner in one tick → 2 lines).
        for (let i = 0; i < delta && i < 5; i++) timeline.push({ seq, minute, kind: key, team });
      }
    }
    prev = cur;
  }

  const final = statsOf(last || {});
  const running = !!last?.Clock?.Running;
  const seconds = num(last?.Clock?.Seconds);
  const minute = Math.floor(seconds / 60);
  const gameState = String(last?.GameState || "").toLowerCase();
  const ended = /finish|ended|complete|full|ft|abandon/.test(gameState) || (!running && minute >= 90);
  const notStarted = !seenAny || (!running && minute === 0 && final.g1 + final.g2 === 0 && !/play|live|1st|2nd|half/.test(gameState));

  let phase: Phase = "live";
  if (ended) phase = "ended";
  else if (notStarted && (!startTime || Date.now() < startTime)) phase = "pre";
  else if (notStarted) phase = "pre";

  return { phase, running, minute, seconds, ...final, timeline };
}

const EVENT_META: Record<EventKind, { label: string; emoji: string }> = {
  goal: { label: "Goal", emoji: "⚽" },
  yellow: { label: "Yellow card", emoji: "🟨" },
  red: { label: "Red card", emoji: "🟥" },
  corner: { label: "Corner", emoji: "⛳" },
};

export function eventMeta(kind: EventKind) {
  return EVENT_META[kind];
}
