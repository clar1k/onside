/**
 * Seed in-play goal micro-markets for a World Cup fixture on devnet.
 * Each run uses unique market ids (SEED_BASE, default now-ms) so re-seeding always
 * creates fresh markets; the web client discovers them via getProgramAccounts and
 * shows the most-recently-created market per outcome.
 *
 * Env: FIXTURE_ID, PERIOD (4=H2), CLOSE_SEC (betting window), SEED_BASE (unique id base).
 * All markets use goals (stat keys 1/2) so they settle from the pinned proof.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import axios from "axios";
import onsideIdl from "../idl/onside.json";
import { getProvider, DEVNET_API, loadToken } from "./config";

const FIXTURE = Number(process.env.FIXTURE_ID || 17926615);
const PERIOD = Number(process.env.PERIOD || 0); // 0 = bind on stat key only (settle with latest verified value)
const CLOSE_SEC = Number(process.env.CLOSE_SEC || 90);
const SEED_BASE = Number(process.env.SEED_BASE || Date.now());

const gt = (threshold: number) => ({ threshold, comparison: { greaterThan: {} } });

const DELAY_MS = Number(process.env.DELAY_MS || 900); // gap between markets so we don't burst the RPC
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The public devnet RPC hands out 429s under load; anchor's own retry caps at ~4s which
 *  isn't enough to clear a per-IP connection-rate cooldown. Ride it out with long backoff. */
async function withRpcRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const backoffs = [1000, 3000, 6000, 12000, 20000, 30000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message || e);
      const is429 = msg.includes("429") || /rate limit/i.test(msg);
      if (!is429 || attempt >= backoffs.length) throw e;
      const wait = backoffs[attempt];
      console.log(`  ${label}: rate-limited, waiting ${wait}ms (attempt ${attempt + 1}/${backoffs.length})`);
      await sleep(wait);
    }
  }
}

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(onsideIdl as any, provider);
  const authority = provider.wallet.publicKey;
  console.log("authority:", authority.toBase58(), "fixture:", FIXTURE, "closeSec:", CLOSE_SEC, "base:", SEED_BASE);

  let t1 = "Home";
  try {
    const { jwt, apiToken } = loadToken();
    const fx = (
      await axios.get(`${DEVNET_API}/api/fixtures/snapshot`, {
        headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
      })
    ).data as any[];
    const f = fx.find((x) => x.FixtureId === FIXTURE);
    if (f) t1 = f.Participant1;
  } catch {}

  const nowSec = Math.floor(Date.now() / 1000);
  const closeTs = new BN(nowSec + CLOSE_SEC);
  const settleAfterTs = new BN(1);

  const goals = [
    { desc: `Over 0.5 goals`, statA: 1, statB: 2, op: 1, yes: gt(0) },
    { desc: `Over 1.5 goals`, statA: 1, statB: 2, op: 1, yes: gt(1) },
    { desc: `Over 2.5 goals`, statA: 1, statB: 2, op: 1, yes: gt(2) },
    { desc: `${t1} to win`, statA: 1, statB: 2, op: 2, yes: gt(0) },
    { desc: `${t1} to score`, statA: 1, statB: 0, op: 0, yes: gt(0) },
  ];
  // Prop / exotic markets (PROPS=1) — proves the settlement engine handles ANY stat, not
  // just goals: corners (keys 7/8), cards (3/4 yellow, 5/6 red). The two-stat combo below
  // is the brief's own example, "Team A Corners + Team B Corners > 10".
  const props =
    process.env.PROPS === "1"
      ? [
          { desc: `Over 8.5 total corners`, statA: 7, statB: 8, op: 1, yes: gt(8) },
          { desc: `Over 10.5 total corners`, statA: 7, statB: 8, op: 1, yes: gt(10) },
          { desc: `Over 3.5 yellow cards`, statA: 3, statB: 4, op: 1, yes: gt(3) },
          { desc: `A red card shown`, statA: 5, statB: 6, op: 1, yes: gt(0) },
        ]
      : [];
  const templates = [...goals, ...props];

  const created: string[] = [];
  for (let i = 0; i < templates.length; i++) {
    const tpl = templates[i];
    const marketId = new BN(SEED_BASE + i);
    const [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), authority.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await withRpcRetry(
      () =>
        program.methods
          .initializeMarket({
            marketId,
            fixtureId: new BN(FIXTURE),
            period: PERIOD,
            statAKey: tpl.statA,
            statBKey: tpl.statB,
            op: tpl.op,
            yesPredicate: tpl.yes,
            closeTs,
            settleAfterTs,
            feeBps: 0,
            description: tpl.desc.slice(0, 80),
          })
          .accounts({ market: marketPda, authority, systemProgram: SystemProgram.programId })
          .rpc(),
      tpl.desc
    );
    created.push(marketPda.toBase58());
    console.log("created ", tpl.desc, marketPda.toBase58());
    if (i < templates.length - 1) await sleep(DELAY_MS);
  }
  // Emit the first market id (useful for e2e to target a specific market).
  console.log("SEED_BASE=" + SEED_BASE);
}

main().catch((e) => {
  console.error("create-markets failed:", e?.error?.errorMessage || e?.message || e);
  process.exit(1);
});
