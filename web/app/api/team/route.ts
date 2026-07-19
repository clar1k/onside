import { NextRequest } from "next/server";

// Team crest + squad + facts from TheSportsDB (free, no key). TxODDS gives no team metadata
// or player names, so this fills the "team info / squad" gap. NOTE: this is the team's
// general roster, not the exact match-day XI (no free source has a starting XI for our
// replayed fixtures). Cached a day — it barely changes.
export const revalidate = 86400;

const BASE = "https://www.thesportsdb.com/api/v1/json/3";

export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get("name") || "").trim();
  if (!name) return Response.json({ found: false });
  try {
    const t = await fetch(`${BASE}/searchteams.php?t=${encodeURIComponent(name)}`, { next: { revalidate: 86400 } }).then((r) => r.json());
    const teams: any[] = Array.isArray(t?.teams) ? t.teams : [];
    const team = teams.find((x) => x.strSport === "Soccer") || teams[0];
    if (!team) return Response.json({ found: false });

    let players: { name: string; pos: string }[] = [];
    try {
      const p = await fetch(`${BASE}/lookup_all_players.php?id=${team.idTeam}`, { next: { revalidate: 86400 } }).then((r) => r.json());
      players = (Array.isArray(p?.player) ? p.player : [])
        .map((x: any) => ({ name: x.strPlayer as string, pos: (x.strPosition as string) || "" }))
        .filter((x) => x.name)
        .slice(0, 24);
    } catch {}

    return Response.json({
      found: true,
      name: team.strTeam,
      badge: team.strBadge || null,
      stadium: team.strStadium || null,
      formed: team.intFormedYear || null,
      players,
    });
  } catch {
    return Response.json({ found: false });
  }
}
