"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ExternalLink, CircleCheckBig } from "lucide-react";
import { Header } from "@/components/Header";
import { fetchAllMarkets, fetchSettlementSigs } from "@/lib/onside";
import { OnsideMarket, marketPhase } from "@/lib/markets";
import { getCachedFixtureName } from "@/lib/fixtureNames";
import { cn } from "@/lib/utils";

/** Public audit trail: every market Onside settled + the on-chain proof that settled it.
 *  The trustless-settlement hero, made undeniable — "don't trust us, verify on-chain." */
export default function Proofs() {
  const [markets, setMarkets] = useState<OnsideMarket[] | null>(null);
  const [fixtures, setFixtures] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchAllMarkets()
      .then(setMarkets)
      .catch(() => setMarkets([]));
    fetch("/api/txodds/fixtures/snapshot")
      .then((r) => r.json())
      .then((d: any) => {
        const m: Record<number, string> = {};
        (Array.isArray(d) ? d : []).forEach((f: any) => (m[f.FixtureId] = `${f.Participant1} v ${f.Participant2}`));
        setFixtures(m);
      })
      .catch(() => {});
  }, []);

  const nameMap = useMemo(() => {
    const map: Record<number, string> = { ...fixtures };
    for (const m of markets || []) {
      if (map[m.fixtureId]) continue;
      const c = getCachedFixtureName(m.fixtureId);
      if (c) map[m.fixtureId] = `${c.p1} v ${c.p2}`;
    }
    return map;
  }, [markets, fixtures]);

  const resolved = useMemo(
    () => (markets || []).filter((m) => marketPhase(m) === "resolved").sort((a, b) => b.createdAt - a.createdAt),
    [markets]
  );

  // Fetch every settlement sig from ONE concurrency-capped batch (not 40 rows racing the
  // RPC at once, which just 429s them all). Rows fill in their on-chain link as each lands.
  const [sigs, setSigs] = useState<Record<string, string | null>>({});
  const pubkeysKey = resolved.map((m) => m.publicKey).join(",");
  useEffect(() => {
    if (!resolved.length) return;
    let alive = true;
    fetchSettlementSigs(
      resolved.map((m) => m.publicKey),
      (pk, sig) => alive && setSigs((prev) => ({ ...prev, [pk]: sig }))
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkeysKey]);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-4xl px-4 pb-24 sm:px-6">
        <div className="mt-6 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-brand" />
          <h1 className="text-2xl font-bold">Proofs</h1>
        </div>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
          Every market Onside has settled — and the on-chain proof that settled it. Each result is proven against
          TxODDS&apos;s Merkle root by the smart contract itself: <span className="font-mono text-faint">resolve_market</span> CPIs into{" "}
          <span className="font-mono text-faint">validate_stat</span>, which binds the value to the on-chain daily root. No oracle
          committee, no admin. <span className="text-ink">Don&apos;t trust us — verify it.</span>
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="Settled markets" value={resolved.length} />
          <Stat label="Matches" value={new Set(resolved.map((m) => m.fixtureId)).size} />
          <Stat label="Trusted oracles" value="0" accent />
        </div>

        {markets === null && <div className="mt-6 h-64 animate-pulse rounded-xl border border-edge bg-surface" />}
        {markets && (
          <div className="mt-6 overflow-hidden rounded-xl border border-edge bg-surface">
            <div className="grid grid-cols-[1fr_5rem_6rem] items-center gap-3 border-b border-edge px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span>Market</span>
              <span className="text-right">Result</span>
              <span className="text-right">Proof</span>
            </div>
            {resolved.map((m) => (
              <ProofRow key={m.publicKey} m={m} match={nameMap[m.fixtureId]} sig={sigs[m.publicKey]} />
            ))}
            {resolved.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted">No settled markets yet — they appear here the moment a match resolves.</div>
            )}
          </div>
        )}
      </main>
    </>
  );
}

function ProofRow({ m, match, sig }: { m: OnsideMarket; match?: string; sig?: string | null }) {
  const wonYes = m.outcome === "yes";
  return (
    <div className="grid grid-cols-[1fr_5rem_6rem] items-center gap-3 border-b border-edge/60 px-4 py-3 transition last:border-0 hover:bg-raised">
      <Link href={`/fixture/${m.fixtureId}`} prefetch={false} className="group min-w-0">
        <div className="truncate text-sm font-medium transition group-hover:text-brand">{m.description}</div>
        {match && <div className="truncate text-xs text-muted">{match}</div>}
      </Link>
      <div className="text-right">
        <span className={cn("inline-flex items-center gap-1 text-sm font-semibold", wonYes ? "text-yes" : "text-no")}>
          <CircleCheckBig className="h-3.5 w-3.5" /> {wonYes ? "Yes" : "No"}
        </span>
      </div>
      <div className="text-right">
        {sig ? (
          <a
            href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            on-chain <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <Link href={`/fixture/${m.fixtureId}`} prefetch={false} className="text-xs text-muted transition hover:text-brand">
            view →
          </Link>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-1 text-xl font-bold tabular-nums", accent && "text-yes")}>{value}</div>
    </div>
  );
}
