import { NextRequest } from "next/server";
import { txoddsGet } from "@/lib/txodds";

export const dynamic = "force-dynamic";

// Proxies /api/txodds/<...> -> https://txline-dev.txodds.com/api/<...>
// so the browser never sees the token and there are no CORS issues.
export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const apiPath = "/api/" + params.path.join("/");
  try {
    const { status, body } = await txoddsGet(apiPath, req.nextUrl.searchParams);
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "proxy error" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
