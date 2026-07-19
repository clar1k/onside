"use client";

import { useEffect, useRef } from "react";
import { useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { X, Zap, ExternalLink } from "lucide-react";
import { useGuest } from "@/lib/wallet";

export function ConnectModal() {
  const { wallets, select, connected, connecting, wallet } = useAdapterWallet();
  const guest = useGuest();
  const pending = useRef(false);

  // Report success only when actually connected (never on a promise that no-ops).
  useEffect(() => {
    if (pending.current && connected) {
      pending.current = false;
      toast.success("Wallet connected", {
        description: "Onside runs on Solana Devnet — set your wallet to Devnet, then tap Add funds.",
        duration: 7000,
      });
      guest.closeConnect();
    }
  }, [connected, guest]);

  // Connect DIRECTLY inside the click handler. Wallet extensions require the connect
  // popup to be opened from a real user gesture — calling connect() from an effect loses
  // that gesture and the popup silently never appears (the "nothing happens" bug).
  const pick = async (w: any) => {
    pending.current = true;
    try {
      select(w.adapter.name);
      if (!w.adapter.connected) await w.adapter.connect();
    } catch (e: any) {
      // autoConnect may connect in parallel; only surface a genuine failure.
      if (!w.adapter.connected) {
        pending.current = false;
        toast.error(e?.message || "Connection failed");
      }
    }
  };

  if (!guest.connectOpen) return null;

  const detected = wallets.filter((w) => w.readyState === "Installed" || w.readyState === "Loadable");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={guest.closeConnect} />
      <div className="relative w-full max-w-sm animate-fade-up rounded-t-2xl border border-edge bg-surface p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Connect a wallet</h2>
          <button onClick={guest.closeConnect} aria-label="Close" className="rounded-full p-1.5 text-muted transition hover:bg-raised hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2">
          {detected.map((w) => (
            <button
              key={w.adapter.name}
              data-testid="wallet-option"
              disabled={connecting}
              onClick={() => pick(w)}
              className="flex w-full items-center gap-3 rounded-lg border border-edge bg-canvas px-4 py-3 transition hover:border-faint disabled:opacity-60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.adapter.icon} alt="" className="h-6 w-6 rounded" />
              <span className="font-semibold">{w.adapter.name}</span>
              <span className="ml-auto text-xs text-muted">
                {connecting && wallet?.adapter.name === w.adapter.name ? "Connecting…" : "Detected"}
              </span>
            </button>
          ))}

          {detected.length === 0 && (
            <a
              href="https://phantom.app/download"
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center gap-3 rounded-lg border border-edge bg-canvas px-4 py-3 text-ink transition hover:border-faint"
            >
              <span className="font-semibold">Get a Solana wallet</span>
              <ExternalLink className="ml-auto h-4 w-4 text-muted" />
            </a>
          )}
        </div>

        {detected.length > 0 && (
          <div className="mt-3 rounded-lg border border-edge bg-canvas px-3 py-2 text-[11px] leading-relaxed text-muted">
            Onside runs on <span className="font-semibold text-ink">Solana Devnet</span>. Set your wallet to Devnet
            (Phantom → Settings → Developer Settings), then <span className="text-ink">Add funds</span> — or use guest below,
            it&apos;s already on devnet.
          </div>
        )}

        <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wider text-faint">
          <span className="h-px flex-1 bg-edge" /> or <span className="h-px flex-1 bg-edge" />
        </div>

        <button
          data-testid="guest-btn"
          onClick={guest.enable}
          className="flex w-full items-center gap-3 rounded-lg border border-brand/30 bg-brand/10 px-4 py-3 text-left transition hover:bg-brand/15"
        >
          <Zap className="h-5 w-5 shrink-0 text-brand" />
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-brand">Continue as guest</span>
            <span className="text-[11px] text-muted">Instant in-browser devnet wallet — no install</span>
          </span>
        </button>

        <p className="mt-3 text-center text-[11px] text-faint">Devnet only · test SOL, no real funds at risk</p>
      </div>
    </div>
  );
}
