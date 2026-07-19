import "server-only";
import fs from "fs";
import path from "path";

const DEVNET_API = "https://txline-dev.txodds.com";

/** TxLINE credentials from env (production) with a dev-only file fallback. */
function token(): { jwt: string; apiToken: string } {
  if (process.env.TXLINE_JWT && process.env.TXLINE_API_TOKEN) {
    return { jwt: process.env.TXLINE_JWT, apiToken: process.env.TXLINE_API_TOKEN };
  }
  const p = path.join(process.cwd(), "..", "client", ".txline-token.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export async function txoddsGet(apiPath: string, search: URLSearchParams) {
  const { jwt, apiToken } = token();
  const qs = search.toString();
  const url = `${DEVNET_API}${apiPath}${qs ? "?" + qs : ""}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
    cache: "no-store",
  });
  return { status: r.status, body: await r.text() };
}

/** Open an upstream SSE stream (token kept server-side); the route pipes `.body`
 *  straight to the browser's EventSource. `search` includes the leading "?". */
export async function txoddsStream(apiPath: string, search: string, signal?: AbortSignal): Promise<Response> {
  const { jwt, apiToken } = token();
  return fetch(`${DEVNET_API}${apiPath}${search || ""}`, {
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken, Accept: "text/event-stream" },
    cache: "no-store",
    signal,
  });
}
