/** Inspect one fixture's scores schema + timeline, and fetch a goals stat-validation proof. */
import axios from "axios";
import { DEVNET_API, loadToken } from "./config";

const FIXTURE = Number(process.env.FIXTURE_ID || 17926615);

async function main() {
  const { jwt, apiToken } = loadToken();
  const http = axios.create({
    baseURL: DEVNET_API,
    timeout: 30000,
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
  });

  const s = (await http.get(`/api/scores/snapshot/${FIXTURE}?asOf=${Date.now()}`))
    .data as any[];
  console.log(`fixture ${FIXTURE}: ${s.length} events`);
  const last = s[s.length - 1];
  console.log("event keys:", Object.keys(last));
  console.log("LAST event:\n", JSON.stringify(last, null, 2));

  const pick = (e: any, names: string[]) => {
    for (const n of names) if (e[n] !== undefined) return e[n];
    return undefined;
  };
  console.log("\n# timeline");
  for (const e of s) {
    const seq = pick(e, ["Seq", "seq"]);
    const p1 = pick(e, ["Participant1Score", "Participant1Goals", "P1Score"]);
    const p2 = pick(e, ["Participant2Score", "Participant2Goals", "P2Score"]);
    const phase = pick(e, ["Phase", "GamePhase", "GameState"]);
    const min = pick(e, ["Minute", "GameMinute"]);
    console.log(`  seq=${seq} phase=${phase} score=${p1}-${p2} min=${min}`);
  }

  const lastSeq = pick(last, ["Seq", "seq"]);
  console.log(`\n# stat-validation (fixture ${FIXTURE}, seq ${lastSeq}, goals 1 vs 2)`);
  try {
    const v = (
      await http.get("/api/scores/stat-validation", {
        params: { fixtureId: FIXTURE, seq: lastSeq, statKey: 1, statKey2: 2 },
      })
    ).data;
    console.log("response keys:", Object.keys(v));
    console.log(JSON.stringify(v, null, 2).slice(0, 1800));
  } catch (e: any) {
    console.log("stat-val ERR", e?.response?.status, JSON.stringify(e?.response?.data)?.slice(0, 250));
  }
}

main().catch(console.error);
