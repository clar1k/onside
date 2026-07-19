/**
 * Multi-match proof: create + settle a market for ANY fixture using the LIVE TxODDS
 * proof (latest sequence), exactly as the web app does. Default: fixture 17588303.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import axios from "axios";
import onsideIdl from "../idl/onside.json";
import { getProvider, DEVNET_API, TXORACLE_PROGRAM_ID, loadToken } from "./config";

const FIXTURE = Number(process.env.FIXTURE_ID || 17588303);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function liveProof(http: any, fixtureId: number, statKey: number, statKey2?: number) {
  const snap = (await http.get(`/api/scores/snapshot/${fixtureId}?asOf=${Date.now()}`)).data;
  let seq = 0;
  for (const e of snap) if (typeof e?.Seq === "number" && e.Seq > seq) seq = e.Seq;
  const params: any = { fixtureId, seq, statKey };
  if (statKey2) params.statKey2 = statKey2;
  return (await http.get(`/api/scores/stat-validation`, { params })).data;
}

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(onsideIdl as any, provider);
  const auth = provider.wallet.publicKey;
  const { jwt, apiToken } = loadToken();
  const http = axios.create({ baseURL: DEVNET_API, headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken } });

  const v = await liveProof(http, FIXTURE, 1, 2);
  const total = v.statToProve.value + v.statToProve2.value;
  console.log(`fixture ${FIXTURE}: P1 ${v.statToProve.value} + P2 ${v.statToProve2.value} = ${total} goals (period ${v.statToProve.period})`);

  const marketId = new BN(Date.now());
  const nowSec = Math.floor(Date.now() / 1000);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), auth.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  await program.methods
    .initializeMarket({
      marketId,
      fixtureId: new BN(FIXTURE),
      period: 0,
      statAKey: 1,
      statBKey: 2,
      op: 1,
      yesPredicate: { threshold: 0, comparison: { greaterThan: {} } },
      closeTs: new BN(nowSec + 4),
      settleAfterTs: new BN(1),
      feeBps: 0,
      description: "Over 0.5 goals",
    })
    .accounts({ market: pda, authority: auth, systemProgram: SystemProgram.programId })
    .rpc();
  await sleep(6000);

  const toNodes = (a: any[]) => a.map((n: any) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));
  const ts = v.summary.updateStats.minTimestamp;
  const fixtureSummary = {
    fixtureId: new BN(v.summary.fixtureId),
    updateStats: { updateCount: v.summary.updateStats.updateCount, minTimestamp: new BN(v.summary.updateStats.minTimestamp), maxTimestamp: new BN(v.summary.updateStats.maxTimestamp) },
    eventsSubTreeRoot: v.summary.eventStatsSubTreeRoot,
  };
  const statA = { statToProve: { key: v.statToProve.key, value: v.statToProve.value, period: v.statToProve.period }, eventStatRoot: v.eventStatRoot, statProof: toNodes(v.statProof) };
  const statB = { statToProve: { key: v.statToProve2.key, value: v.statToProve2.value, period: v.statToProve2.period }, eventStatRoot: v.eventStatRoot, statProof: toNodes(v.statProof2) };
  const epochDay = Math.floor(ts / 86400000);
  const [rootsPda] = PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)], TXORACLE_PROGRAM_ID);
  try {
    await program.methods
      .resolveMarket(new BN(ts), fixtureSummary, toNodes(v.subTreeProof), toNodes(v.mainTreeProof), statA, statB)
      .accounts({ market: pda, dailyScoresMerkleRoots: rootsPda, txOracleProgram: TXORACLE_PROGRAM_ID, resolver: auth })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
      .rpc();
    const m = await program.account.market.fetch(pda);
    console.log(`  Over 0.5 goals -> outcome ${JSON.stringify(m.outcome)} (expect YES for ${total} goals) ✓ multi-match settlement works`);
  } catch (e: any) {
    console.log(`  RESOLVE FAILED: ${e?.error?.errorMessage || String(e?.message).split("\n")[0]}`);
  }
}

main().catch((e) => {
  console.error("settle-fixture failed:", e?.error?.errorMessage || e?.message || e);
  process.exit(1);
});
