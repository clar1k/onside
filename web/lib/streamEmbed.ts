// Convert a public watch URL into an embeddable iframe src — the same trick PolyGaming
// uses (Twitch / YouTube / Kick are freely iframe-embeddable). Licensed broadcasts
// (e.g. the FIFA World Cup) are NOT embeddable, so those return null and the broadcast
// falls back to the data-driven match centre. Kept tiny + dependency-free on purpose.

export type StreamSite = "twitch" | "youtube" | "kick";
export interface StreamEmbed {
  site: StreamSite;
  src: string;
}

function host(): string {
  if (typeof window !== "undefined" && window.location?.hostname) return window.location.hostname;
  return "localhost";
}

/** Returns an iframe src for a supported public stream, or null for anything else. */
export function streamEmbed(url?: string | null): StreamEmbed | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const h = u.hostname.replace(/^www\.|^m\./, "").toLowerCase();
  const parent = host();

  // Twitch: player.twitch.tv?channel=<name>&parent=<host>
  if (h === "twitch.tv" || h === "player.twitch.tv") {
    const channel = h === "player.twitch.tv" ? u.searchParams.get("channel") : u.pathname.split("/").filter(Boolean)[0];
    if (channel) return { site: "twitch", src: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}&muted=true` };
    return null;
  }

  // YouTube: watch?v=<id>, youtu.be/<id>, /embed/<id>, /live/<id>, or a channel live stream
  // (/channel/UC…, ?channel=UC…) which always plays whatever that channel is currently live.
  if (h === "youtube.com" || h === "youtu.be") {
    const chan = u.searchParams.get("channel") || (u.pathname.startsWith("/channel/") ? u.pathname.split("/").filter(Boolean)[1] : null);
    if (chan) return { site: "youtube", src: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(chan)}&autoplay=1&mute=1` };
    let id: string | null = null;
    if (h === "youtu.be") id = u.pathname.split("/").filter(Boolean)[0] || null;
    else if (u.pathname.startsWith("/watch")) id = u.searchParams.get("v");
    else if (u.pathname.startsWith("/embed/") || u.pathname.startsWith("/live/")) id = u.pathname.split("/").filter(Boolean)[1] || null;
    // loop+playlist makes a single clip replay so the "broadcast" never just stops.
    if (id) return { site: "youtube", src: `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(id)}` };
    return null;
  }

  // Kick: kick.com/<channel> or player.kick.com/<channel>
  if (h === "kick.com" || h === "player.kick.com") {
    const channel = u.pathname.split("/").filter(Boolean)[0];
    if (channel) return { site: "kick", src: `https://player.kick.com/${encodeURIComponent(channel)}` };
    return null;
  }

  return null;
}
