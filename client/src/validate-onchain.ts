/**
 * Prove the settlement primitive end-to-end on devnet:
 * fetch a goals proof and call the real txoracle.validate_stat — it must
 * PASS for a true predicate and ABORT for a false one.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import axios from "axios";
import {
  getProvider,
  getTxoracleProgram,
  loadToken,
  DEVNET_API,
} from "./config";

const FIXTURE = Number(process.env.FIXTURE_ID || 17926615);
const SEQ = Number(process.env.SEQ || 932);

async function main() {
  const { jwt, apiToken } = loadToken();
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = getTxoracleProgram(provider);

  const http = axios.create({
    baseURL: DEVNET_API,
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
  });
  const v = (
    await http.get("/api/scores/stat-validation", {
      params: { fixtureId: FIXTURE, seq: SEQ, statKey: 1, statKey2: 2 },
    })
  ).data;
  console.log("statToProve:", JSON.stringify(v.statToProve));

  const toNodes = (a: any[]) =>
    a.map((n: any) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));

  const fixtureSummary = {
    fixtureId: new BN(v.summary.fixtureId),
    updateStats: {
      updateCount: v.summary.updateStats.updateCount,
      minTimestamp: new BN(v.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: v.summary.eventStatsSubTreeRoot,
  };
  const fixtureProof = toNodes(v.subTreeProof);
  const mainTreeProof = toNodes(v.mainTreeProof);
  const statA = {
    statToProve: {
      key: v.statToProve.key,
      value: v.statToProve.value,
      period: v.statToProve.period,
    },
    eventStatRoot: v.eventStatRoot,
    statProof: toNodes(v.statProof),
  };

  const epochDay = Math.floor(v.ts / 86400000);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    program.programId
  );
  console.log(`epochDay=${epochDay}  dailyScoresRoots=${pda.toBase58()}`);
  const info = await provider.connection.getAccountInfo(pda);
  console.log("on-chain root exists:", !!info, info ? `(owner ${info.owner.toBase58()})` : "");
  if (!info) {
    console.log("⚠️  No posted root for this day — pick a fixture/seq whose day has a root.");
    return;
  }

  const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const tryTs = async (label: string, tsCand: number, predicate: any) => {
    const ed = Math.floor(tsCand / 86400000);
    const [pdaC] = PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), new BN(ed).toArrayLike(Buffer, "le", 2)],
      program.programId
    );
    try {
      const sig = await program.methods
        .validateStat(new BN(tsCand), fixtureSummary, fixtureProof, mainTreeProof, predicate, statA, null, null)
        .accounts({ dailyScoresMerkleRoots: pdaC })
        .preInstructions([cu])
        .rpc();
      console.log(`✓ ${label} ts=${tsCand}: tx ${sig}`);
      return true;
    } catch (e: any) {
      const msg = e?.error?.errorMessage || String(e?.message || e).split("\n")[0];
      console.log(`✗ ${label} ts=${tsCand}: ${msg}`);
      return false;
    }
  };

  const passPred = { threshold: 0, comparison: { greaterThan: {} } };
  console.log("\n# finding the correct ts (goals > 0, expect PASS):");
  await tryTs("v.ts        ", v.ts, passPred);
  await tryTs("summary.min ", v.summary.updateStats.minTimestamp, passPred);
  await tryTs("summary.max ", v.summary.updateStats.maxTimestamp, passPred);
  console.log("\n# false predicate (goals > 5) — does it abort?:");
  await tryTs("summary.min ", v.summary.updateStats.minTimestamp, { threshold: 5, comparison: { greaterThan: {} } });

  // SECURITY-CRITICAL: claim a tampered value (99) — the Merkle proof must reject it.
  console.log("\n# tampered value=99 (expect ABORT if value is proof-bound):");
  const tsCand = v.summary.updateStats.minTimestamp;
  const ed = Math.floor(tsCand / 86400000);
  const [pdaC] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(ed).toArrayLike(Buffer, "le", 2)],
    program.programId
  );
  const statBad = {
    statToProve: { key: statA.statToProve.key, value: 99, period: statA.statToProve.period },
    eventStatRoot: statA.eventStatRoot,
    statProof: statA.statProof,
  };
  try {
    const sig = await program.methods
      .validateStat(new BN(tsCand), fixtureSummary, fixtureProof, mainTreeProof, passPred, statBad, null, null)
      .accounts({ dailyScoresMerkleRoots: pdaC })
      .preInstructions([cu])
      .rpc();
    console.log(`✗ tampered value PASSED — BAD (value not bound): tx ${sig}`);
  } catch (e: any) {
    const msg = e?.error?.errorMessage || String(e?.message || e).split("\n")[0];
    console.log(`✓ tampered value ABORTED (good — value is proof-bound): ${msg}`);
  }
}

main().catch(console.error);
