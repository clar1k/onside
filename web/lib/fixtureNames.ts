"use client";

// TxODDS's fixtures snapshot is a rolling window — a match can drop out of it while its
// on-chain markets still exist. We cache team names as we see them so a "rotated-out"
// match still renders with its real names instead of a stuck skeleton.
const KEY = "onside_fixture_names_v1";

type Name = { p1: string; p2: string };

// Known replay fixtures that rotate out of the live snapshot — a static fallback so their
// names always resolve (the settlement showcase uses one). Participant1 IDs verified against
// the snapshot (Argentina=1489, Switzerland=3099, Belgium=1575, France=1999, Norway=2661,
// Spain=3021); opponents from the fixtures as they appeared in the lobby.
const STATIC: Record<number, Name> = {
  18202701: { p1: "Argentina", p2: "Egypt" },
  18193785: { p1: "USA", p2: "Belgium" },
  18202783: { p1: "Switzerland", p2: "Colombia" },
  18209181: { p1: "France", p2: "Morocco" },
  18213979: { p1: "Norway", p2: "England" },
  18218149: { p1: "Spain", p2: "Belgium" },
  18222446: { p1: "Argentina", p2: "Switzerland" },
};

export function cacheFixtureName(id: number, p1?: string, p2?: string) {
  if (!p1 || !p2 || typeof window === "undefined") return;
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || "{}");
    m[id] = { p1, p2 };
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {}
}

export function getCachedFixtureName(id: number): Name | null {
  if (typeof window === "undefined") return STATIC[id] || null;
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}")[id] || STATIC[id] || null;
  } catch {
    return STATIC[id] || null;
  }
}

export function getKnownFixtureName(id: number): Name | null {
  return STATIC[id] || null;
}
