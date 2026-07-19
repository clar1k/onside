import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { txoddsGet } from "@/lib/txodds";
import { DEMO_FIXTURE } from "@/lib/config";

export const dynamic = "force-dynamic";

// Returns the TxODDS stat-validation Merkle proof for a fixture + stat keys, fetched
// LIVE at the latest available sequence so ANY fixture with on-chain data can settle.
// Falls back to a pinned proof only for the canonical demo fixture, so the showcase
// path always resolves cleanly even if the devnet re-run loop has moved on.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const fixtureId = sp.get("fixtureId");
  const statKey = sp.get("statKey") || "1";
  const statKey2 = sp.get("statKey2");
  if (!fixtureId) {
    return Response.json({ error: "fixtureId required" }, { status: 400 });
  }

  try {
    // 1) latest sequence from the scores snapshot
    const snap = await txoddsGet(
      `/api/scores/snapshot/${fixtureId}`,
      new URLSearchParams({ asOf: String(Date.now()) })
    );
    const events = JSON.parse(snap.body || "[]");
    if (!Array.isArray(events) || events.length === 0) throw new Error("no scores yet");
    let seq = 0;
    for (const e of events) if (typeof e?.Seq === "number" && e.Seq > seq) seq = e.Seq;
    if (!seq) throw new Error("no sequence");

    // 2) the stat-validation proof at that sequence
    const params = new URLSearchParams({ fixtureId, seq: String(seq), statKey });
    if (statKey2 && statKey2 !== "0") params.set("statKey2", statKey2);
    const proofRes = await txoddsGet("/api/scores/stat-validation", params);
    const proof = JSON.parse(proofRes.body || "{}");
    if (proofRes.status !== 200 || !proof?.summary) {
      throw new Error(proof?.message || `proof unavailable (${proofRes.status})`);
    }
    return Response.json(proof);
  } catch (e: any) {
    if (Number(fixtureId) === DEMO_FIXTURE) {
      try {
        const p = path.join(process.cwd(), "..", "client", "proof.json");
        return new Response(fs.readFileSync(p, "utf8"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } catch {}
    }
    return Response.json(
      { error: e?.message || "no proof available — match may not have reached this moment yet" },
      { status: 404 }
    );
  }
}
