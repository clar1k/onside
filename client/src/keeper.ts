/**
 * Keeper — auto-settles markets so users never click "settle". Loops over every
 * market past its betting close, waits for TxODDS to report full-time, fetches the
 * final TxODDS proof, and resolves it on-chain. Settlement is permissionless, so this is just the default automation;
 * anyone could run a keeper (censorship-resistant). Claims are handled client-side.
 *
 * Run: npx ts-node src/keeper.ts   (env INTERVAL ms, default 15000)
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import axios from "axios";
import onsideIdl from "../idl/onside.json";
import { getProvider, DEVNET_API, TXORACLE_PROGRAM_ID, loadToken } from "./config";

const INTERVAL = Number(process.env.INTERVAL || 15000);
const STALE_SEC = Number(process.env.STALE_SEC || 3600); // skip markets closed longer ago than this
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toNodes = (a: any[]) => a.map((n: any) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));

function latestScoreEvent(snapshot: any[]): any | null {
  if (!Array.isArray(snapshot) || !snapshot.length) return null;
  return snapshot.reduce((latest, event) => {
    if (!latest) return event;
    const seq = Number(event?.Seq || 0);
    const latestSeq = Number(latest?.Seq || 0);
    if (seq !== latestSeq) return seq > latestSeq ? event : latest;
    return Number(event?.Ts || 0) > Number(latest?.Ts || 0) ? event : latest;
  }, null as any);
}

function isFullTime(snapshot: any[]): boolean {
  const latest = latestScoreEvent(snapshot);
  if (!latest) return false;

  const gameState = String(latest.GameState || "").trim().toLowerCase();
  if (/finish|ended|complete|full.?time|^ft$/.test(gameState)) return true;

  const seconds = Number(latest.Clock?.Seconds || 0);
  return latest.Clock?.Running === false && seconds >= 90 * 60;
}

async function liveProof(http: any, fixtureId: number, statKey: number, statKey2?: number) {
  const snap = (await http.get(`/api/scores/snapshot/${fixtureId}?asOf=${Date.now()}`)).data;
  if (!Array.isArray(snap) || !snap.length) return null;
  if (!isFullTime(snap)) return null;
  let seq = 0;
  for (const e of snap) if (typeof e?.Seq === "number" && e.Seq > seq) seq = e.Seq;
  if (!seq) return null;
  const params: any = { fixtureId, seq, statKey };
  if (statKey2) params.statKey2 = statKey2;
  const v = (await http.get(`/api/scores/stat-validation`, { params })).data;
  return v?.summary ? v : null;
}

async function settle(program: any, resolver: PublicKey, http: any, m: any): Promise<boolean> {
  const a = m.account;
  const v = await liveProof(http, Number(a.fixtureId), a.statAKey, a.statBKey || undefined);
  if (!v) return false;

  const ts = v.summary.updateStats.minTimestamp;
  const fixtureSummary = {
    fixtureId: new BN(v.summary.fixtureId),
    updateStats: { updateCount: v.summary.updateStats.updateCount, minTimestamp: new BN(v.summary.updateStats.minTimestamp), maxTimestamp: new BN(v.summary.updateStats.maxTimestamp) },
    eventsSubTreeRoot: v.summary.eventStatsSubTreeRoot,
  };
  const statA = { statToProve: { key: v.statToProve.key, value: v.statToProve.value, period: v.statToProve.period }, eventStatRoot: v.eventStatRoot, statProof: toNodes(v.statProof) };
  const statB = a.statBKey ? { statToProve: { key: v.statToProve2.key, value: v.statToProve2.value, period: v.statToProve2.period }, eventStatRoot: v.eventStatRoot, statProof: toNodes(v.statProof2) } : null;
  const epochDay = Math.floor(ts / 86400000);
  const [rootsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXORACLE_PROGRAM_ID
  );
  await program.methods
    .resolveMarket(new BN(ts), fixtureSummary, toNodes(v.subTreeProof), toNodes(v.mainTreeProof), statA, statB)
    .accounts({ market: m.publicKey, dailyScoresMerkleRoots: rootsPda, txOracleProgram: TXORACLE_PROGRAM_ID, resolver })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  return true;
}

async function tick(program: any, resolver: PublicKey, http: any) {
  const all = await (program.account as any).market.all([
    { memcmp: { offset: 8, bytes: anchor.utils.bytes.bs58.encode(resolver.toBuffer()) } },
  ]);
  const now = Math.floor(Date.now() / 1000);
  let settled = 0;
  for (const m of all) {
    const a = m.account;
    if (!a.status.open) continue; // already resolved/void
    if (now < Number(a.closeTs)) continue; // betting still open
    if (now - Number(a.closeTs) > STALE_SEC) continue; // skip long-closed/stale markets
    try {
      if (await settle(program, resolver, http, m)) {
        settled++;
        console.log(`settled ${a.description} fixture ${a.fixtureId}`);
      }
    } catch (e: any) {
      // no proof yet / match not at this moment / already resolved — skip quietly
    }
    await sleep(400);
  }
  if (settled) console.log(`tick: settled ${settled} market(s)`);

  const tickets = await (program.account as any).parlayTicket.all();
  for (const row of tickets) {
    let ticket = row.account;
    if (ticket.status.open) {
      try {
        await program.methods.settleParlay()
          .accounts({ ticket: row.publicKey })
          .remainingAccounts(ticket.legs.map((leg: any) => ({ pubkey: leg.market, isSigner: false, isWritable: false })))
          .rpc();
        ticket = await (program.account as any).parlayTicket.fetch(row.publicKey);
        console.log(`settled parlay ${row.publicKey.toBase58()}`);
      } catch {
        continue;
      }
    }
    if (ticket.status.won) {
      try {
        await program.methods.claimParlay()
          .accounts({ ticket: row.publicKey, vault: ticket.vault, owner: ticket.owner })
          .rpc();
        console.log(`paid parlay ${row.publicKey.toBase58()}`);
      } catch (e: any) {
        console.log(`parlay payout pending ${row.publicKey.toBase58()}: ${String(e?.message || e).slice(0, 80)}`);
      }
    }
  }
}

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(onsideIdl as any, provider);
  const resolver = provider.wallet.publicKey;
  const { jwt, apiToken } = loadToken();
  const http = axios.create({ baseURL: DEVNET_API, headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken } });
  console.log(`keeper running (interval ${INTERVAL}ms, resolver ${resolver.toBase58()})`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(program, resolver, http);
    } catch (e: any) {
      console.log("tick error:", e?.message || e);
    }
    await sleep(INTERVAL);
  }
}

main().catch((e) => {
  console.error("keeper failed:", e?.message || e);
  process.exit(1);
});
