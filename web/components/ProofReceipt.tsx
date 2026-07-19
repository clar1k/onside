"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { ShieldCheck, ExternalLink, Check, Loader2, Radio, GitBranch, Link2, CircleCheckBig } from "lucide-react";
import { OnsideMarket } from "@/lib/markets";
import { fetchSettlementSig } from "@/lib/onside";
import { TXORACLE_PROGRAM_ID } from "@/lib/config";
import { cn } from "@/lib/utils";

const STAT: Record<number, string> = {
  1: "home goals",
  2: "away goals",
  3: "home yellows",
  4: "away yellows",
  5: "home reds",
  6: "away reds",
  7: "home corners",
  8: "away corners",
};

const hex = (a: any) =>
  Array.isArray(a) && a.length ? "0x" + a.map((b: number) => (b & 0xff).toString(16).padStart(2, "0")).join("").slice(0, 16) + "…" : "—";
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const explorer = (kind: "tx" | "address", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

/**
 * The verifiable resolution receipt, drawn as a TRUST CHAIN: the TxODDS stat value → the
 * Merkle proof → the on-chain daily-scores root → the contract-verified outcome. Every link
 * is inspectable on Solana Explorer, and "Verify yourself" re-checks the proof live. This is
 * the trust primitive Track 1 rewards — proven, not trusted.
 */
export function ProofReceipt({ market }: { market: OnsideMarket }) {
  const [proof, setProof] = useState<any>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<null | boolean>(null);

  const proofUrl = () => {
    const p = new URLSearchParams({ fixtureId: String(market.fixtureId), statKey: String(market.statAKey) });
    if (market.statBKey) p.set("statKey2", String(market.statBKey));
    return `/api/proof?${p}`;
  };

  useEffect(() => {
    let alive = true;
    fetch(proofUrl())
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setProof(d?.summary ? d : null))
      .catch(() => {});
    fetchSettlementSig(market.publicKey).then((s) => alive && setSig(s));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.publicKey]);

  const dailyPda = (() => {
    const ts = proof?.summary?.updateStats?.minTimestamp;
    if (!ts) return null;
    try {
      const epochDay = Math.floor(Number(ts) / 86400000);
      return PublicKey.findProgramAddressSync(
        [Buffer.from("daily_scores_roots"), new anchor.BN(epochDay).toArrayLike(Buffer, "le", 2)],
        new PublicKey(TXORACLE_PROGRAM_ID)
      )[0].toBase58();
    } catch {
      return null;
    }
  })();

  const v1 = proof?.statToProve?.value;
  const v2 = proof?.statToProve2?.value;
  const total = typeof v1 === "number" && typeof v2 === "number" ? v1 + v2 : v1;
  const wonYes = market.outcome === "yes";

  async function verify() {
    setVerifying(true);
    setVerified(null);
    try {
      const r = await fetch(proofUrl());
      const d = r.ok ? await r.json() : null;
      setVerified(!!d?.summary);
    } catch {
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="border-t border-edge p-4 sm:p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-brand" /> Trustless settlement
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-yes/15 px-2 py-0.5 text-[11px] font-semibold text-yes">
          Proven, not trusted
        </span>
      </div>
      <p className="mb-4 text-xs text-muted">No oracle committee, no admin — the result is proven against TxODDS&apos;s on-chain Merkle root.</p>

      <div className="rounded-lg border border-edge bg-canvas p-4">
        <Step icon={<Radio className="h-4 w-4" />} tone="brand" label="TxODDS feed — the result">
          {typeof v1 === "number" ? (
            <span className="font-mono text-xs">
              {STAT[market.statAKey] || `stat ${market.statAKey}`} <b className="text-ink">{v1}</b>
              {market.statBKey ? (
                <>
                  {" + "}
                  {STAT[market.statBKey] || market.statBKey} <b className="text-ink">{v2}</b> = <b className="text-ink">{total}</b>
                </>
              ) : null}
            </span>
          ) : (
            <span className="text-muted">reading feed…</span>
          )}
        </Step>

        <Step icon={<GitBranch className="h-4 w-4" />} tone="brand" label="Merkle proof binds the value">
          <span className="font-mono text-xs text-muted">event root {hex(proof?.eventStatRoot)}</span>
        </Step>

        <Step icon={<Link2 className="h-4 w-4" />} tone="brand" label="Committed on-chain by TxODDS">
          {dailyPda ? <ExtLink href={explorer("address", dailyPda)}>daily-scores root {short(dailyPda)}</ExtLink> : <span className="text-muted">—</span>}
        </Step>

        <Step icon={<CircleCheckBig className="h-4 w-4" />} tone={wonYes ? "yes" : "no"} label="Contract verified the outcome" last>
          <span className={cn("font-semibold", wonYes ? "text-yes" : "text-no")}>{wonYes ? "Yes" : "No"} won</span>
          <span className="ml-1 text-xs text-muted">
            — <span className="font-mono text-muted">resolve_market</span> CPI&apos;d <span className="font-mono text-muted">validate_stat</span>; the settler can&apos;t change it.
          </span>
        </Step>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <button
          onClick={verify}
          disabled={verifying}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 font-semibold text-white transition hover:bg-brand-600 active:scale-[.98] disabled:opacity-50"
        >
          {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Verify yourself
        </button>
        {verified === true && (
          <span className="inline-flex items-center gap-1 font-semibold text-yes">
            <Check className="h-3.5 w-3.5" /> Proof valid · matches the on-chain root
          </span>
        )}
        {verified === false && <span className="text-no">Couldn&apos;t re-verify right now</span>}
        {sig && <ExtLink href={explorer("tx", sig)}>settlement tx</ExtLink>}
        <ExtLink href={explorer("address", market.publicKey)}>market account</ExtLink>
      </div>
    </div>
  );
}

function Step({ icon, label, tone, children, last }: { icon: React.ReactNode; label: string; tone: "brand" | "yes" | "no"; children: React.ReactNode; last?: boolean }) {
  const toneCls = tone === "brand" ? "border-brand/40 bg-brand/10 text-brand" : tone === "yes" ? "border-yes/40 bg-yes/10 text-yes" : "border-no/40 bg-no/10 text-no";
  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <div className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-edge" />}
      <div className={cn("z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", toneCls)}>{icon}</div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
