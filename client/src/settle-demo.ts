/**
 * Full lifecycle on DEVNET against the real txoracle, in one run:
 *   create market (closes in 5s) → bet YES+NO → settle via Merkle proof → claim.
 * Proves trustless settlement + parimutuel claim end-to-end on devnet.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import fs from "fs";
import onsideIdl from "../idl/onside.json";
import { getProvider, TXORACLE_PROGRAM_ID } from "./config";

const FIXTURE = 17926615;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(onsideIdl as any, provider);
  const auth = provider.wallet.publicKey;
  const v = JSON.parse(fs.readFileSync(__dirname + "/../proof.json", "utf8"));
  console.log("proof goals:", v.statToProve.value, "+", v.statToProve2.value, "(period", v.statToProve.period + ")");

  const marketId = new BN(Date.now());
  const nowSec = Math.floor(Date.now() / 1000);
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), auth.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [posPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), marketPda.toBuffer(), auth.toBuffer()],
    program.programId
  );

  console.log("1) create market (Over 0.5 goals, closes in 5s)");
  await program.methods
    .initializeMarket({
      marketId,
      fixtureId: new BN(FIXTURE),
      period: v.statToProve.period,
      statAKey: v.statToProve.key,
      statBKey: v.statToProve2.key,
      op: 1,
      yesPredicate: { threshold: 0, comparison: { greaterThan: {} } },
      closeTs: new BN(nowSec + 5),
      settleAfterTs: new BN(1),
      feeBps: 0,
      description: "Settle demo: Over 0.5 goals",
    })
    .accounts({ market: marketPda, authority: auth, systemProgram: SystemProgram.programId })
    .rpc();

  console.log("2) bet YES 0.05, NO 0.03");
  const betAccts = { market: marketPda, position: posPda, bettor: auth, systemProgram: SystemProgram.programId };
  await program.methods.placeBet({ yes: {} }, new BN(0.05 * 1e9)).accounts(betAccts).rpc();
  await program.methods.placeBet({ no: {} }, new BN(0.03 * 1e9)).accounts(betAccts).rpc();

  console.log("   waiting for betting to close…");
  await sleep(7000);

  console.log("3) settle from TxODDS Merkle proof (CPI validate_stat)");
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
  const statA = {
    statToProve: { key: v.statToProve.key, value: v.statToProve.value, period: v.statToProve.period },
    eventStatRoot: v.eventStatRoot,
    statProof: toNodes(v.statProof),
  };
  const statB = {
    statToProve: { key: v.statToProve2.key, value: v.statToProve2.value, period: v.statToProve2.period },
    eventStatRoot: v.eventStatRoot,
    statProof: toNodes(v.statProof2),
  };
  const epochDay = Math.floor(ts / 86400000);
  const [rootsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXORACLE_PROGRAM_ID
  );
  await program.methods
    .resolveMarket(new BN(ts), fixtureSummary, toNodes(v.subTreeProof), toNodes(v.mainTreeProof), statA, statB)
    .accounts({
      market: marketPda,
      dailyScoresMerkleRoots: rootsPda,
      txOracleProgram: TXORACLE_PROGRAM_ID,
      resolver: auth,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  const m = await program.account.market.fetch(marketPda);
  console.log("   => outcome:", JSON.stringify(m.outcome));

  console.log("4) claim");
  const before = await provider.connection.getBalance(auth);
  await program.methods.claim().accounts({ market: marketPda, position: posPda, owner: auth }).rpc();
  const after = await provider.connection.getBalance(auth);
  console.log("   claim net delta:", ((after - before) / 1e9).toFixed(4), "SOL");
  console.log("\n✅ settle + claim on devnet OK   market:", marketPda.toBase58());
}

main().catch((e) => {
  console.error("settle-demo failed:", e?.error?.errorMessage || e?.message || e);
  process.exit(1);
});
