/**
 * M0 — Smoke-test the data pipeline with the cached apiToken.
 * Pulls free guest odds, a scores snapshot, and a stat-validation proof
 * for a sample devnet re-run fixture.
 */
import axios from "axios";
import { DEVNET_API, loadToken } from "./config";

// Sample devnet re-run fixture id used in the TxODDS examples.
const FIXTURE_ID = Number(process.env.FIXTURE_ID || 17271370);

async function main() {
  const { jwt, apiToken } = loadToken();
  const http = axios.create({
    baseURL: DEVNET_API,
    timeout: 30000,
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
  });

  const show = (label: string, data: any) =>
    console.log(`\n# ${label}\n` + JSON.stringify(data, null, 2).slice(0, 1200));

  // Free de-margined guest odds (JWT-only).
  try {
    const g = await http.get("/api/guest/odds/snapshot");
    show("guest odds snapshot", g.data);
  } catch (e: any) {
    console.log("guest odds:", e?.response?.status, e?.response?.data || e?.message);
  }

  // Scores snapshot for a fixture.
  try {
    const s = await http.get(`/api/scores/snapshot/${FIXTURE_ID}?asOf=${Date.now()}`);
    show(`scores snapshot ${FIXTURE_ID}`, s.data);
  } catch (e: any) {
    console.log("scores snapshot:", e?.response?.status, e?.response?.data || e?.message);
  }

  // Stat-validation proof (goals: key 1 vs key 2) — the input to settlement.
  try {
    const v = await http.get("/api/scores/stat-validation", {
      params: { fixtureId: FIXTURE_ID, seq: 401, statKey: 1, statKey2: 2 },
    });
    console.log("\n# stat-validation response keys:", Object.keys(v.data));
    show("stat-validation", v.data);
  } catch (e: any) {
    console.log("stat-validation:", e?.response?.status, e?.response?.data || e?.message);
  }
}

main().catch(console.error);
