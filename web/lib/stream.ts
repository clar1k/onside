"use client";

import { useEffect, useState } from "react";

/**
 * Subscribes to the TxODDS scores + odds SSE streams for a fixture (via our server
 * proxy) and returns a `tick` that increments on every stream event, plus `live`
 * (connected). Callers re-pull the latest snapshot on each tick — so the UI is
 * event-driven by the real-time feed rather than a fixed timer.
 */
export function useLiveTick(fixtureId: number): { tick: number; live: boolean } {
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!fixtureId || typeof window === "undefined") return;
    let alive = true;
    let openCount = 0;
    const sources: EventSource[] = [];

    const open = (path: string) => {
      let es: EventSource;
      try {
        es = new EventSource(path);
      } catch {
        return;
      }
      es.onopen = () => {
        if (alive) {
          openCount++;
          setLive(true);
        }
      };
      es.onmessage = () => alive && setTick((t) => t + 1);
      es.onerror = () => {
        // EventSource auto-reconnects; only flip `live` off if everything is down
        if (alive && es.readyState === EventSource.CLOSED) {
          openCount = Math.max(0, openCount - 1);
          if (openCount === 0) setLive(false);
        }
      };
      sources.push(es);
    };

    open(`/api/txodds/stream/scores/stream?fixtureId=${fixtureId}`);
    open(`/api/txodds/stream/odds/stream?fixtureId=${fixtureId}`);

    return () => {
      alive = false;
      sources.forEach((s) => s.close());
    };
  }, [fixtureId]);

  return { tick, live };
}
