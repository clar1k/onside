/**
 * Decisive correctness check for C1: does resolve_market correctly settle a NO
 * outcome, or does the validate_stat CPI abort on a false predicate?
 * Creates an "Over 0.5" (should be YES) and an "Over 2.5" (should be NO) market
 * for a 1-0 fixture and settles both via the real on-chain resolve_market.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import fs from "fs";
import onsideIdl from "../idl/onside.json";
import { getProvider, TXORACLE_PROGRAM_ID } from "./config";

const FIXTURE = 17926615;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeAndSettle(program: any, auth: PublicKey, v: any, desc: string, yesThreshold: number) {
  const marketId = new BN(Date.now() + Math.floor(Math.random() * 100000));
  const nowSec = Math.floor(Date.now() / 1000);
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), auth.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  await program.methods
    .initializeMarket({
      marketId,
      fixtureId: new BN(FIXTURE),
      period: 0,
      statAKey: v.statToProve.key,
      statBKey: v.statToProve2.key,
      op: 1,
      yesPredicate: { threshold: yesThreshold, comparison: { greaterThan: {} } },
      closeTs: new BN(nowSec + 4),
      settleAfterTs: new BN(1),
      feeBps: 0,
      description: desc,
    })
    .accounts({ market: marketPda, authority: auth, systemProgram: SystemProgram.programId })
    .rpc();
  await sleep(6000);

  const toNodes = (a: any[]) => a.map((n: any) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));
  const ts = v.summary.updateStats.minTimestamp;
  const fixtureSummary = {
    fixtureId: new BN(v.summary.fixtureId),
    updateStats: {
      updateCount: v.summary.updateStats.updateCount,
      minTimestamp: new BN(v.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: v.summary.eventStatsSubTreeRoot,
  };
  const statA = { statToProve: { key: v.statToProve.key, value: v.statToProve.value, period: v.statToProve.period }, eventStatRoot: v.eventStatRoot, statProof: toNodes(v.statProof) };
  const statB = { statToProve: { key: v.statToProve2.key, value: v.statToProve2.value, period: v.statToProve2.period }, eventStatRoot: v.eventStatRoot, statProof: toNodes(v.statProof2) };
  const epochDay = Math.floor(ts / 86400000);
  const [rootsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXORACLE_PROGRAM_ID
  );
  try {
    await program.methods
      .resolveMarket(new BN(ts), fixtureSummary, toNodes(v.subTreeProof), toNodes(v.mainTreeProof), statA, statB)
      .accounts({ market: marketPda, dailyScoresMerkleRoots: rootsPda, txOracleProgram: TXORACLE_PROGRAM_ID, resolver: auth })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
      .rpc();
    const m = await program.account.market.fetch(marketPda);
    console.log(`  ${desc}: outcome=${JSON.stringify(m.outcome)}  status=${JSON.stringify(m.status)}`);
  } catch (e: any) {
    console.log(`  ${desc}: RESOLVE ABORTED -> ${e?.error?.errorMessage || String(e?.message).split("\n")[0]}`);
  }
}

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(onsideIdl as any, provider);
  const auth = provider.wallet.publicKey;
  const v = JSON.parse(fs.readFileSync(__dirname + "/../proof.json", "utf8"));
  const total = v.statToProve.value + v.statToProve2.value;
  console.log(`proof: P1 ${v.statToProve.value} + P2 ${v.statToProve2.value} = ${total} goals\n`);
  await makeAndSettle(program, auth, v, "Over 0.5 (expect YES)", 0);
  await makeAndSettle(program, auth, v, "Over 2.5 (expect NO)", 2);
}

main().catch((e) => {
  console.error("verify failed:", e?.error?.errorMessage || e?.message || e);
  process.exit(1);
});
