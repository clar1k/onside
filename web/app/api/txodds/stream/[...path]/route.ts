import { NextRequest } from "next/server";
import { txoddsStream } from "@/lib/txodds";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Pipes a TxODDS Server-Sent Events stream to the browser's EventSource. The token
// stays server-side; the client connects to /api/txodds/stream/scores/stream?fixtureId=…
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const apiPath = "/api/" + params.path.join("/");
  try {
    const upstream = await txoddsStream(apiPath, req.nextUrl.search, req.signal);
    if (!upstream.ok || !upstream.body) {
      return new Response(`upstream ${upstream.status}`, { status: upstream.status || 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (e: any) {
    return new Response(e?.message || "stream error", { status: 500 });
  }
}
