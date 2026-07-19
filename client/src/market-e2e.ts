/**
 * End-to-end: initialize a parimutuel market over a real World Cup fixture,
 * place YES/NO bets, then trustlessly resolve it by proving the goals via the
 * cloned txoracle (CPI validate_stat), and claim. Uses a saved proof so the
 * result is deterministic against the cloned on-chain Merkle root.
 *
 * Run against the local cloned validator:
 *   ANCHOR_PROVIDER_URL=http://localhost:8899 npx ts-node src/market-e2e.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import fs from "fs";
import onsideIdl from "../idl/onside.json";
import { getProvider, TXORACLE_PROGRAM_ID } from "./config";

const FIXTURE = 17926615; // Colombia v Congo DR (devnet re-run)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const onside = new anchor.Program(onsideIdl as any, provider);
  const wallet = provider.wallet.publicKey;
  const connection = provider.connection;
  console.log("cluster:", (connection as any)._rpcEndpoint, " wallet:", wallet.toBase58());

  const v = JSON.parse(fs.readFileSync(__dirname + "/../proof.json", "utf8"));
  console.log("proof: P1 goals =", v.statToProve.value, " P2 goals =", v.statToProve2.value, " period =", v.statToProve.period);

  const marketId = new BN(Date.now());
  const nowSec = Math.floor(Date.now() / 1000);
  const params = {
    marketId,
    fixtureId: new BN(FIXTURE),
    period: v.statToProve.period, // 4 = H2
    statAKey: v.statToProve.key, // 1 = P1 goals
    statBKey: v.statToProve2.key, // 2 = P2 goals
    op: 1, // add => total goals
    yesPredicate: { threshold: 0, comparison: { greaterThan: {} } }, // total > 0 (Over 0.5)
    closeTs: new BN(nowSec + 6),
    settleAfterTs: new BN(1),
    feeBps: 0,
    description: "Over 0.5 goals: COL v CODR",
  };

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), wallet.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
    onside.programId
  );
  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), marketPda.toBuffer(), wallet.toBuffer()],
    onside.programId
  );

  console.log("\n1) initialize_market", marketPda.toBase58());
  await onside.methods
    .initializeMarket(params)
    .accounts({ market: marketPda, authority: wallet, systemProgram: SystemProgram.programId })
    .rpc();

  console.log("2) place_bet  YES 0.10 SOL, NO 0.05 SOL");
  const betAccts = { market: marketPda, position: positionPda, bettor: wallet, systemProgram: SystemProgram.programId };
  await onside.methods.placeBet({ yes: {} }, new BN(0.1 * 1e9)).accounts(betAccts).rpc();
  await onside.methods.placeBet({ no: {} }, new BN(0.05 * 1e9)).accounts(betAccts).rpc();
  const m1 = await onside.account.market.fetch(marketPda);
  console.log("   pools: YES", Number(m1.totalYes) / 1e9, " NO", Number(m1.totalNo) / 1e9);

  const waitMs = (nowSec + 6) * 1000 - Date.now() + 2500;
  if (waitMs > 0) {
    console.log(`   waiting ${Math.ceil(waitMs / 1000)}s for betting to close…`);
    await sleep(waitMs);
  }

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

  console.log(`3) resolve_market — proving total goals = ${v.statToProve.value} + ${v.statToProve2.value} via CPI`);
  await onside.methods
    .resolveMarket(new BN(ts), fixtureSummary, toNodes(v.subTreeProof), toNodes(v.mainTreeProof), statA, statB)
    .accounts({
      market: marketPda,
      dailyScoresMerkleRoots: rootsPda,
      txOracleProgram: TXORACLE_PROGRAM_ID,
      resolver: wallet,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  const m2 = await onside.account.market.fetch(marketPda);
  console.log("   => outcome:", JSON.stringify(m2.outcome), " status:", JSON.stringify(m2.status));

  console.log("4) claim");
  const before = await connection.getBalance(wallet);
  await onside.methods.claim().accounts({ market: marketPda, position: positionPda, owner: wallet }).rpc();
  const after = await connection.getBalance(wallet);
  console.log("   claim net delta:", ((after - before) / 1e9).toFixed(4), "SOL (incl. position rent refund)");
  console.log("\n✅ end-to-end OK");
}

main().catch((e) => {
  console.error("e2e failed:", e?.error?.errorMessage || e?.message || e);
  process.exit(1);
});
