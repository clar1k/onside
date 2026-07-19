/**
 * Seed goal micro-markets across ALL World Cup fixtures (breadth for the home page).
 * Idempotent: a single getProgramAccounts scan skips fixtures that already have a
 * recent batch (within CLOSE-ish window), so re-running won't duplicate.
 *
 * Env: PERIOD (4=H2), CLOSE_SEC (window, default 1800), LIMIT (0=all), ONLY_WITH_DATA=1.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import axios from "axios";
import onsideIdl from "../idl/onside.json";
import { getProvider, DEVNET_API, loadToken } from "./config";

const PERIOD = Number(process.env.PERIOD || 0); // 0 = bind on stat key only (settle with latest verified value)
const CLOSE_SEC = Number(process.env.CLOSE_SEC || 1800);
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY_WITH_DATA = process.env.ONLY_WITH_DATA === "1";
const FORCE = process.env.FORCE === "1"; // ignore the recent-batch idempotency guard
const FRESH_WINDOW = 1800; // skip a fixture already seeded within this many seconds
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const gt = (t: number) => ({ threshold: t, comparison: { greaterThan: {} } });

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(onsideIdl as any, provider);
  const authority = provider.wallet.publicKey;
  const { jwt, apiToken } = loadToken();
  const http = axios.create({ baseURL: DEVNET_API, headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken } });

  let fx = ((await http.get("/api/fixtures/snapshot")).data as any[])
    .filter((f) => f.CompetitionId === 72)
    .sort((a, b) => a.StartTime - b.StartTime);
  if (LIMIT) fx = fx.slice(0, LIMIT);

  // idempotency: which fixtures already have a recent batch from this authority
  const existing = await (program.account as any).market.all([
    { memcmp: { offset: 8, bytes: anchor.utils.bytes.bs58.encode(authority.toBuffer()) } },
  ]);
  const nowSec = Math.floor(Date.now() / 1000);
  const recent = new Set<number>();
  for (const x of existing) {
    if (nowSec - Number(x.account.createdAt) < FRESH_WINDOW) recent.add(Number(x.account.fixtureId));
  }

  let seeded = 0;
  for (const f of fx) {
    if (!FORCE && recent.has(f.FixtureId)) {
      console.log(`skip (recent) ${f.Participant1} v ${f.Participant2}`);
      continue;
    }
    if (ONLY_WITH_DATA) {
      try {
        const s = (await http.get(`/api/scores/snapshot/${f.FixtureId}?asOf=${Date.now()}`)).data;
        if (!Array.isArray(s) || !s.length) continue;
      } catch {
        continue;
      }
    }
    const t1 = f.Participant1;
    const base = Date.now() + Math.floor(Math.random() * 100000);
    const templates = [
      { desc: `Over 0.5 goals`, a: 1, b: 2, op: 1, yes: gt(0) },
      { desc: `Over 1.5 goals`, a: 1, b: 2, op: 1, yes: gt(1) },
      { desc: `Over 2.5 goals`, a: 1, b: 2, op: 1, yes: gt(2) },
      { desc: `${t1} to win`, a: 1, b: 2, op: 2, yes: gt(0) },
      { desc: `${t1} to score`, a: 1, b: 0, op: 0, yes: gt(0) },
    ];
    try {
      for (let i = 0; i < templates.length; i++) {
        const tpl = templates[i];
        const marketId = new BN(base + i);
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from("market"), authority.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
          program.programId
        );
        await program.methods
          .initializeMarket({
            marketId,
            fixtureId: new BN(f.FixtureId),
            period: PERIOD,
            statAKey: tpl.a,
            statBKey: tpl.b,
            op: tpl.op,
            yesPredicate: tpl.yes,
            closeTs: new BN(nowSec + CLOSE_SEC),
            settleAfterTs: new BN(1),
            feeBps: 0,
            description: tpl.desc.slice(0, 80),
          })
          .accounts({ market: pda, authority, systemProgram: SystemProgram.programId })
          .rpc();
        await sleep(700); // throttle to stay under public devnet RPC rate limits
      }
      seeded++;
      console.log(`seeded ${f.Participant1} v ${f.Participant2} (${f.FixtureId})`);
    } catch (e: any) {
      console.log(`skip ${f.FixtureId}: ${e?.error?.errorMessage || String(e?.message).split("\n")[0]}`);
    }
  }
  console.log(`\ndone — ${seeded} fixtures seeded, ${recent.size} already recent`);
}

main().catch((e) => {
  console.error("seed-all failed:", e?.message || e);
  process.exit(1);
});
