/**
 * Discover which fixtures/competitions our FREE devnet bundle can access,
 * and what the scores payloads look like (input for the resolver + markets).
 */
import axios from "axios";
import { DEVNET_API, loadToken } from "./config";

async function main() {
  const { jwt, apiToken } = loadToken();
  const http = axios.create({
    baseURL: DEVNET_API,
    timeout: 30000,
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
  });

  const tryGet = async (label: string, url: string, params?: any) => {
    try {
      const r = await http.get(url, { params });
      const d = r.data;
      const arr = Array.isArray(d) ? d : d?.fixtures || d?.items || d?.data || null;
      console.log(
        `\n# ${label}  ${url}  -> ${Array.isArray(arr) ? arr.length + " items" : typeof d}`
      );
      if (Array.isArray(arr)) {
        const comps: Record<string, number> = {};
        for (const f of arr) {
          const c =
            f.competitionId ?? f.competition_id ?? f.competition?.id ?? "?";
          comps[c] = (comps[c] || 0) + 1;
        }
        console.log("  competitions:", JSON.stringify(comps));
        console.log("  sample:", JSON.stringify(arr.slice(0, 2)).slice(0, 900));
      } else {
        console.log("  body:", JSON.stringify(d).slice(0, 900));
      }
      return arr;
    } catch (e: any) {
      console.log(
        `\n# ${label}  ${url}  ERR`,
        e?.response?.status,
        JSON.stringify(e?.response?.data)?.slice(0, 200)
      );
    }
  };

  const now = new Date();
  await tryGet("fixtures snapshot", "/api/fixtures/snapshot");

  // Scan recent hourly fixture-update batches for active fixtures (re-runs).
  for (let h = 0; h < 8; h++) {
    const t = new Date(now.getTime() - h * 3600000);
    const ed = Math.floor(t.getTime() / 86400000);
    const hr = t.getUTCHours();
    await tryGet(`fixtures updates -${h}h`, `/api/fixtures/updates/${ed}/${hr}`);
  }
}

main().catch(console.error);
