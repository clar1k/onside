"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { streamEmbed } from "@/lib/streamEmbed";
import { cn } from "@/lib/utils";

const STREAM_KEY = "onside_stream_url_v1";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Match stream. Opens INLINE as a section on the page (Polymarket-style), with a "pop out"
 * that detaches it into a floating mini-player you can DRAG (by the title bar) and RESIZE
 * (bottom-right handle). Shows a real embeddable stream; licensed World Cup video can't be
 * embedded, so it defaults to a public football stream and "Change stream" lets you swap it.
 */
export function WatchLive({ title, streamUrl, onClose }: { title?: string; streamUrl?: string | null; onClose: () => void }) {
  const [stored, setStored] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pip, setPip] = useState(false);
  const [pos, setPos] = useState({ x: 40, y: 96 });
  const [width, setWidth] = useState(460);
  const [dragging, setDragging] = useState(false);

  const posRef = useRef(pos);
  posRef.current = pos;
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    setStored(localStorage.getItem(STREAM_KEY));
    setReady(true);
    setMounted(true);
    setPos({ x: Math.max(16, window.innerWidth - 500), y: Math.max(80, window.innerHeight - 360) });
  }, []);

  const effectiveUrl = !ready ? streamUrl : stored === "off" ? null : stored || streamUrl;
  const embed = useMemo(() => streamEmbed(effectiveUrl), [effectiveUrl]);

  const changeStream = () => {
    const cur = stored && stored !== "off" ? stored : streamUrl || "";
    const url = window.prompt("Paste a live stream URL (YouTube, Twitch or Kick) that plays in your region.", cur);
    if (url === null) return;
    const v = url.trim() || "off";
    localStorage.setItem(STREAM_KEY, v);
    setStored(v);
  };

  const startDrag = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...posRef.current };
    const w = widthRef.current;
    const move = (ev: MouseEvent) => {
      setPos({
        x: clamp(orig.x + (ev.clientX - startX), 0, window.innerWidth - w),
        y: clamp(orig.y + (ev.clientY - startY), 0, window.innerHeight - 48),
      });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    setDragging(true);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startX = e.clientX;
    const w0 = widthRef.current;
    const move = (ev: MouseEvent) => setWidth(clamp(w0 + (ev.clientX - startX), 300, Math.min(900, window.innerWidth - posRef.current.x - 8)));
    const up = () => {
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    setDragging(true);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const Header = ({ draggable }: { draggable?: boolean }) => (
    <div
      onMouseDown={draggable ? startDrag : undefined}
      className={cn("flex select-none items-center justify-between gap-2 border-b border-edge/70 px-3 py-2", draggable && "cursor-move")}
    >
      <span className="truncate text-xs font-semibold">{title || "Match stream"}</span>
      <div className="flex shrink-0 items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
        <button onClick={changeStream} title="Use a different stream" className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-muted transition hover:bg-raised hover:text-ink">
          Change stream
        </button>
        <button onClick={() => setPip((v) => !v)} title={pip ? "Dock into page" : "Pop out (drag & resize)"} className="rounded-md p-1 text-muted transition hover:bg-raised hover:text-ink">
          {pip ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onClose} title="Close" aria-label="Close stream" className="rounded-md p-1 text-muted transition hover:bg-raised hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const Video = () =>
    embed ? (
      <div className="relative w-full bg-black" style={{ aspectRatio: "16 / 9" }}>
        {/* eslint-disable-next-line jsx-a11y/iframe-has-title */}
        <iframe title="Match stream" src={embed.src} className="absolute inset-0 h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        {/* during drag/resize, cover the iframe so it doesn't swallow the mouse */}
        {dragging && <div className="absolute inset-0" />}
      </div>
    ) : (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-canvas px-4 text-center text-sm text-muted">
        <p>No stream set for this match.</p>
        <button onClick={changeStream} className="text-xs font-medium text-brand hover:underline">
          Paste a stream URL
        </button>
      </div>
    );

  const Caption = () => (
    <p className="px-3 py-2 text-[11px] leading-snug text-faint">
      Public football stream — licensed World Cup video can&apos;t be embedded. Use &ldquo;Change stream&rdquo; for one that plays in your region.
    </p>
  );

  // Popped out: slim inline placeholder in the page + a floating draggable/resizable window.
  if (pip) {
    return (
      <>
        <div className="overflow-hidden rounded-xl border border-edge bg-surface">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-muted">
            <span>Stream is playing in the floating player ↗</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setPip(false)} className="text-xs font-medium text-brand hover:underline">
                Dock back
              </button>
              <button onClick={onClose} aria-label="Close stream" className="text-muted hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        {mounted &&
          createPortal(
            <div className="fixed z-[70] overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl" style={{ left: pos.x, top: pos.y, width }}>
              <Header draggable />
              <Video />
              <div onMouseDown={startResize} className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end p-0.5" title="Resize">
                <span className="h-2 w-2 border-b-2 border-r-2 border-faint" />
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }

  // Inline section on the page.
  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-surface">
      <Header />
      <Video />
      <Caption />
    </div>
  );
}
