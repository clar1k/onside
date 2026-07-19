"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { OnsideMarket, Position, projectedPayout, marketPhase, LAMPORTS } from "@/lib/markets";
import { walletProgram, positionPda } from "@/lib/onside";
import { useWallet } from "@/lib/wallet";
import { SolIcon, Spinner } from "@/components/icons";
import { cn, fmtSol } from "@/lib/utils";

const QUICK = [0.05, 0.1, 0.25, 0.5];
const FEE_BUFFER = 0.003;

export function TradePanel({
  market,
  side,
  onSide,
  chance,
  position,
  onDone,
}: {
  market: OnsideMarket;
  side: "yes" | "no";
  onSide: (s: "yes" | "no") => void;
  chance: number | null;
  position?: Position;
  onDone: () => void;
}) {
  const w = useWallet();
  const [amount, setAmount] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const phase = marketPhase(market);

  const yesPct = chance ?? 50;
  const noPct = 100 - yesPct;
  const sidePct = side === "yes" ? yesPct : noPct;
  const isYes = side === "yes";

  const amt = parseFloat(amount);
  const valid = !isNaN(amt) && amt > 0;
  const lamports = valid ? Math.floor(amt * LAMPORTS) : 0;
  const insufficient = valid && amt > w.balance;
  const noWallet = !w.anchorWallet;
  const payout = projectedPayout(market.totalYes, market.totalNo, side, lamports, market.feeBps) / LAMPORTS;
  const mult = amt > 0 ? payout / amt : 0;
  const canBuy = valid && !insufficient && !busy && !noWallet;

  const setMax = () => setAmount(Math.max(0, w.balance - FEE_BUFFER).toFixed(3));

  async function buy() {
    if (noWallet) return w.openConnect();
    if (!canBuy) return;
    setBusy(true);
    const tid = toast.loading("Placing bet…");
    try {
      const program = walletProgram(w.anchorWallet);
      const marketPk = new PublicKey(market.publicKey);
      const pos = positionPda(marketPk, w.publicKey!);
      const sig = await program.methods
        .placeBet(isYes ? { yes: {} } : { no: {} }, new anchor.BN(lamports))
        .accounts({ market: marketPk, position: pos, bettor: w.publicKey!, systemProgram: SystemProgram.programId })
        .rpc();
      await w.refresh();
      toast.success(`Bet placed · ${amt.toFixed(2)} SOL on ${isYes ? "Yes" : "No"}`, { id: tid });
      void sig;
      onDone();
    } catch (e: any) {
      toast.error(e?.error?.errorMessage || String(e?.message || e).split("\n")[0], { id: tid });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="rounded-xl border border-edge bg-surface p-4 lg:sticky lg:top-20">
      <h3 className="truncate text-[15px] font-semibold">{market.description}</h3>

      <p className="mt-0.5 text-xs text-muted">{explainShort(market.description)}</p>

      {phase === "open" ? (
        <>
          {/* Yes / No price toggle */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <OutcomeToggle active={isYes} side="yes" price={`${yesPct}%`} onClick={() => onSide("yes")} />
            <OutcomeToggle active={!isYes} side="no" price={`${noPct}%`} onClick={() => onSide("no")} />
          </div>

          {/* amount */}
          <div className="mt-4 flex items-center justify-between">
            <label htmlFor="trade-amount" className="text-xs font-medium text-muted">Amount</label>
            <button onClick={setMax} className="text-xs text-muted transition hover:text-ink">
              Balance {w.balance.toFixed(3)} · Max
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-edge bg-canvas px-3.5 py-3 focus-within:border-faint">
            <SolIcon className="h-4 w-4" />
            <input
              id="trade-amount"
              data-testid="amount-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-full bg-transparent text-2xl font-bold tabular-nums outline-none"
              placeholder="0.00"
            />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => setAmount(q.toFixed(2))}
                className={cn(
                  "rounded-md py-1.5 text-sm font-medium transition",
                  amt === q ? "bg-raised text-ink" : "bg-canvas text-muted hover:bg-raised"
                )}
              >
                {q}
              </button>
            ))}
          </div>

          {/* summary — your pick + the payout AND the multiple, so 1× is obvious */}
          <div className="mt-4 space-y-2 text-sm">
            <Row label="Your pick" valueClass={isYes ? "text-yes" : "text-no"}>
              {isYes ? "Yes" : "No"} · {sidePct}% chance
            </Row>
            <Row label="Payout if you win" valueClass={isYes ? "text-yes" : "text-no"}>
              <SolIcon className="h-3 w-3" />
              {payout.toFixed(3)}
              {valid && <span className="text-muted"> · {mult.toFixed(mult >= 10 ? 0 : 2)}×</span>}
            </Row>
          </div>
          {valid && mult < 1.1 && (
            <p className="mt-2 rounded-lg border border-edge bg-canvas px-3 py-2 text-[11px] leading-snug text-muted">
              Parimutuel — winners split the pool. Almost no one has backed {isYes ? "No" : "Yes"} yet, so your payout is near your stake; it rises as they do. Smaller bets earn bigger multiples.
            </p>
          )}

          {insufficient && !noWallet && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Not enough balance
              </span>
              <button
                onClick={() => toast.promise(w.fund(), { loading: "Adding 0.2 SOL…", success: "Added 0.2 SOL", error: (e) => e?.message || "Faucet busy" })}
                className="font-semibold underline-offset-2 hover:underline"
              >
                Add funds
              </button>
            </div>
          )}

          <button
            data-testid="place-btn"
            onClick={buy}
            disabled={noWallet ? false : !canBuy}
            className={cn(
              "mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-semibold text-white transition active:scale-[.99] disabled:opacity-50",
              isYes ? "bg-yes hover:bg-yes-600" : "bg-no hover:bg-no-600"
            )}
          >
            {busy ? <Spinner className="h-5 w-5" /> : null}
            {noWallet
              ? "Connect to trade"
              : busy
              ? "Confirming…"
              : !valid
              ? "Enter an amount"
              : insufficient
              ? "Insufficient balance"
              : `Bet ${amt.toFixed(2)} SOL on ${isYes ? "Yes" : "No"}`}
          </button>
          <p className="mt-2.5 text-center text-[11px] text-faint">Winners are paid out automatically when the match settles.</p>
        </>
      ) : (
        <div className="mt-3 rounded-lg bg-canvas px-3 py-4 text-center text-sm text-muted">
          {phase === "settling" && "Betting is closed — the result is being confirmed on-chain."}
          {phase === "resolved" && `Result is in — ${market.outcome === "yes" ? "Yes" : "No"} won.`}
          {phase === "void" && "Cancelled — stakes refunded."}
        </div>
      )}

    </aside>
  );
}

function OutcomeToggle({ active, side, price, onClick }: { active: boolean; side: "yes" | "no"; price: string; onClick: () => void }) {
  const isYes = side === "yes";
  return (
    <button
      onClick={onClick}
      data-testid={isYes ? "yes-btn" : "no-btn"}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg py-2.5 text-sm font-semibold transition active:scale-[.98]",
        active
          ? isYes
            ? "bg-yes text-white"
            : "bg-no text-white"
          : isYes
          ? "bg-yes/12 text-yes hover:bg-yes/20"
          : "bg-no/12 text-no hover:bg-no/20"
      )}
    >
      <span>{isYes ? "Yes" : "No"}</span>
      <span className="text-lg font-bold tabular-nums">{price}</span>
    </button>
  );
}

function Row({ label, valueClass, children }: { label: string; valueClass?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", valueClass)}>{children}</span>
    </div>
  );
}

const Chip = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 font-medium", className)}>
    <SolIcon className="h-2.5 w-2.5" />
    {children}
  </span>
);

function explainShort(desc: string): string {
  const over = /Over\s+(\d+(?:\.\d+)?)\s+(.+)/i.exec(desc);
  if (over) return `Win if there are ${Math.ceil(parseFloat(over[1]))}+ ${over[2].trim()}`;
  if (/red card/i.test(desc)) return "Win if a red card is shown";
  const win = /(.+?)\s+to win/i.exec(desc);
  if (win) return `Win if ${win[1].trim()} wins`;
  const score = /(.+?)\s+to score/i.exec(desc);
  if (score) return `Win if ${score[1].trim()} scores`;
  return "Back Yes or No on this";
}
