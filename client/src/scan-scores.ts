/** Scan all accessible World Cup fixtures for available scores data. */
import axios from "axios";
import { DEVNET_API, loadToken } from "./config";

async function main() {
  const { jwt, apiToken } = loadToken();
  const http = axios.create({
    baseURL: DEVNET_API,
    timeout: 30000,
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
  });

  const fx = (await http.get("/api/fixtures/snapshot")).data as any[];
  console.log(`fixtures: ${fx.length}\n`);

  for (const f of fx) {
    const id = f.FixtureId;
    const label = `#${id} ${f.Participant1} v ${f.Participant2}`;
    try {
      const s = (await http.get(`/api/scores/snapshot/${id}?asOf=${Date.now()}`)).data;
      const str = JSON.stringify(s);
      const len = Array.isArray(s) ? s.length : Object.keys(s || {}).length;
      console.log(`${label}  start=${new Date(f.StartTime).toISOString()}  scores[${len}] ${str.slice(0, 240)}`);
    } catch (e: any) {
      console.log(`${label}  scoresERR ${e?.response?.status} ${JSON.stringify(e?.response?.data)?.slice(0, 100)}`);
    }
  }
}

main().catch(console.error);
