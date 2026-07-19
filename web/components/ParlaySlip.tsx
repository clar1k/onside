"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ReceiptText, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { OnsideMarket, LAMPORTS } from "@/lib/markets";
import { placeParlay } from "@/lib/onside";
import { useWallet } from "@/lib/wallet";
import { SolIcon, Spinner } from "@/components/icons";

export type ParlayPick = { market: OnsideMarket; side: "yes" | "no"; chance: number };

export function ParlaySlip({ picks, onRemove, onDone }: {
  picks: ParlayPick[];
  onRemove: (market: string) => void;
  onDone: () => void;
}) {
  const wallet = useWallet();
  const [amount, setAmount] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stake = Number(amount);
  const combinedOdds = useMemo(() => picks.reduce((odds, pick) => {
    const probability = (pick.side === "yes" ? pick.chance : 100 - pick.chance) / 100;
    return odds * (0.95 / Math.max(0.1, Math.min(0.9, probability)));
  }, 1), [picks]);
  const shownOdds = Math.max(1, Math.min(20, combinedOdds));
  const payout = Number.isFinite(stake) && stake > 0 ? stake * shownOdds : 0;

  async function submit() {
    if (!wallet.anchorWallet) return wallet.openConnect();
    if (picks.length < 2 || !stake || stake <= 0) return;
    setError("");
    setBusy(true);
    const id = toast.loading("Placing parlay…");
    try {
      await placeParlay(wallet.anchorWallet, Math.floor(stake * LAMPORTS), picks.map((pick) => ({
        market: pick.market.publicKey,
        side: pick.side,
      })));
      toast.success("Parlay placed", { id });
      await wallet.refresh();
      onDone();
    } catch (error: any) {
      const message = error?.message || "Unable to place parlay";
      setError(message);
      toast.error(message, { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="overflow-hidden rounded-lg border border-edge bg-surface lg:sticky lg:top-32 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
      <div className="flex h-14 items-center justify-between bg-brand px-4 text-white">
        <h3 className="flex items-center gap-2 font-semibold"><ReceiptText className="h-5 w-5" aria-hidden="true" /> Bet slip</h3>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-xs font-bold">{picks.length}</span>
          {picks.length > 0 && <button onClick={() => picks.forEach((pick) => onRemove(pick.market.publicKey))} aria-label="Clear bet slip" className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white"><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>

      <div className="grid grid-cols-2 border-b border-edge bg-raised/60 text-center text-sm font-semibold">
        <span className="py-3 text-muted">Single</span>
        <span className="border-b-2 border-brand py-3 text-ink">Combo</span>
      </div>

      {picks.length === 0 ? (
        <div className="m-3 rounded-md border border-dashed border-edge bg-canvas px-4 py-10 text-center">
          <ReceiptText className="mx-auto h-8 w-8 text-faint" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-ink">Your bet slip is empty</p>
          <p className="mt-1 text-xs leading-5 text-muted">Select odds from at least two markets to build a combo.</p>
        </div>
      ) : (
        <div className="divide-y divide-edge border-b border-edge">
          {picks.map((pick) => (
            <div key={pick.market.publicKey} className="bg-surface p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{pick.side === "yes" ? "Yes" : "No"}</p>
                  <p className="mt-0.5 truncate text-sm font-semibold">{pick.market.description}</p>
                  <p className="mt-1 text-xs text-muted">Same-match market</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-base font-bold text-brand tabular-nums">{(0.95 / Math.max(0.1, Math.min(0.9, (pick.side === "yes" ? pick.chance : 100 - pick.chance) / 100))).toFixed(2)}</span>
                  <button onClick={() => onRemove(pick.market.publicKey)} aria-label="Remove pick" className="flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"><X className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="p-3">
        <div className="flex items-center justify-between">
          <label htmlFor="parlay-stake" className="text-xs font-semibold uppercase tracking-wider text-muted">Stake</label>
          <span className="text-xs text-muted">Balance <span className="font-mono text-ink">{wallet.balance.toFixed(3)}</span></span>
        </div>
        <div className="mt-2 flex min-h-12 items-center gap-2 rounded-md border border-edge bg-canvas px-3 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
          <SolIcon className="h-4 w-4" />
          <input id="parlay-stake" type="text" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="w-full bg-transparent font-mono text-xl font-bold tabular-nums outline-none" aria-describedby="parlay-summary" />
          <span className="text-xs font-semibold text-muted">SOL</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {[0.05, 0.1, 0.25, 0.5].map((value) => <button key={value} onClick={() => setAmount(String(value))} className="min-h-10 rounded-md bg-raised font-mono text-xs font-semibold text-muted transition-colors duration-100 hover:bg-brand/15 hover:text-brand active:translate-y-px focus-visible:ring-2 focus-visible:ring-brand">{value}</button>)}
        </div>

        <div id="parlay-summary" className="mt-4 space-y-2 border-t border-edge pt-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Total odds</span><strong className="font-mono tabular-nums">{shownOdds.toFixed(2)}</strong></div>
          <div className="flex justify-between"><span className="text-muted">Total stake</span><strong className="font-mono tabular-nums">{Number.isFinite(stake) ? stake.toFixed(3) : "0.000"} SOL</strong></div>
          <div className="flex items-baseline justify-between pt-1"><span className="font-semibold uppercase tracking-wide text-ink">Potential payout</span><strong className="font-mono text-xl text-yes tabular-nums">{payout.toFixed(3)} SOL</strong></div>
        </div>

        {error && <div className="mt-3 flex gap-2 rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{error} Try again.</span></div>}

        <button onClick={submit} aria-busy={busy} disabled={busy || (!!wallet.anchorWallet && (picks.length < 2 || !stake || stake <= 0))} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand font-semibold text-white transition-colors duration-100 hover:bg-brand-600 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand">
          {busy && <Spinner className="h-5 w-5" />}
          {!wallet.anchorWallet ? "Connect wallet" : picks.length < 2 ? "Add another selection" : busy ? "Confirming parlay…" : "Place combo bet"}
        </button>
        <p className="mt-2 text-center text-xs text-muted">All selections must win. Odds lock on confirmation.</p>
      </div>
    </aside>
  );
}
