/**
 * Seed parimutuel liquidity so small user bets pay a real multiple instead of collapsing
 * to ~1x on an empty pool. For each OPEN market we seed both sides at the consensus-implied
 * ratio (YES pool : NO pool = p : 1-p, where p is the TxODDS consensus YES-probability, or a
 * standard football prior when the feed doesn't price that market). A position PDA is keyed
 * by (market, owner), so one wallet can't hold both sides — the treasury seeds every YES side
 * and a second seed wallet seeds every NO side.
 *
 * The seed is recoverable: after a market settles, whichever wallet backed the winning side
 * claims its share back. This is just liquidity, not a giveaway, and it never touches
 * settlement — resolution is still proven against TxODDS on-chain.
 *
 * DRY RUN by default (prints the plan + SOL math, sends nothing). Set EXECUTE=1 to place bets.
 *
 *   # preview the plan
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com npx --yes tsx src/seed-liquidity.ts
 *   # actually seed (POOL_SOL = SOL of liquidity per market, split across both sides)
 *   EXECUTE=1 POOL_SOL=0.5 ANCHOR_PROVIDER_URL=https://api.devnet.solana.com npx --yes tsx src/seed-liquidity.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import onsideIdl from "../idl/onside.json";
import { getProvider, DEVNET_API, loadToken } from "./config";

const EXECUTE = process.env.EXECUTE === "1";
const POOL_SOL = Number(process.env.POOL_SOL || 0.5); // total liquidity per market (both sides)
const MAX_TREASURY_SPEND = Number(process.env.MAX_SPEND || 13); // hard cap, safety
const SOL = LAMPORTS_PER_SOL;
const B_WALLET_FILE = path.join(__dirname, "..", ".seed-wallet-b.json");
const ONSIDE_ID = new PublicKey((onsideIdl as any).address);
const SLEEP_MS = Number(process.env.SLEEP_MS || 1500); // between markets — public devnet RPC throttles hard
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sol = (l: number) => (l / SOL).toFixed(3);

// Public devnet RPCs 429 under a burst of txs, and web3's async confirmation can reject
// off the call stack — swallow those so one throttled confirm can't crash the whole seed run.
process.on("unhandledRejection", (e: any) => {
  const m = String(e?.message || e);
  if (!m.includes("429") && !m.includes("Too Many")) console.log("unhandledRejection:", m.slice(0, 140));
});

/** Retry a send through transient 429/timeout with backoff; returns null if it never lands. */
async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 5): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const m = String(e?.message || e);
      if (i === tries - 1) {
        console.log(`  ! ${label} failed: ${m.slice(0, 90)}`);
        return null;
      }
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

// ---- consensus + priors -------------------------------------------------------------------

type Line = { type: "1x2" | "ou"; line: number | null; names: string[]; pct: (number | null)[] };

function parseOddsLines(raw: any): Line[] {
  const out: Line[] = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    const t: string = o?.SuperOddsType || "";
    const type = t.startsWith("1X2") ? "1x2" : t.startsWith("OVERUNDER") ? "ou" : null;
    if (!type) continue;
    if ((o.MarketPeriod || "").includes("half=1")) continue; // full match only
    const lm = /line=(-?\d+(?:\.\d+)?)/.exec(o.MarketParameters || "");
    out.push({
      type,
      line: lm ? parseFloat(lm[1]) : null,
      names: Array.isArray(o.PriceNames) ? o.PriceNames : [],
      pct: Array.isArray(o.Pct) ? o.Pct.map((p: any) => (p == null || p === "NA" ? null : parseFloat(p))) : [],
    });
  }
  return out;
}

/** Consensus YES-probability (0..1) for a market, or null if the feed doesn't price it. */
function consensusYes(desc: string, lines: Line[], p1?: string): number | null {
  const ou = /Over\s+(\d+(?:\.\d+)?)\s+goals/i.exec(desc);
  if (ou) {
    const l = lines.find((x) => x.type === "ou" && x.line === parseFloat(ou[1]));
    const i = l ? l.names.indexOf("over") : -1;
    return l && i >= 0 && l.pct[i] != null ? (l.pct[i] as number) / 100 : null;
  }
  if (/to win/i.test(desc)) {
    const x = lines.find((l) => l.type === "1x2");
    if (!x) return null;
    const isP1 = !!p1 && desc.toLowerCase().startsWith(p1.toLowerCase());
    const i = x.names.indexOf(isP1 ? "part1" : "part2");
    return i >= 0 && x.pct[i] != null ? (x.pct[i] as number) / 100 : null;
  }
  return null;
}

/** Standard football prior for markets the consensus feed doesn't price. */
function priorYes(desc: string): number {
  const d = desc.toLowerCase();
  const ou = /over\s+(\d+(?:\.\d+)?)\s+goals/.exec(d);
  if (ou) {
    const l = parseFloat(ou[1]);
    return l <= 0.5 ? 0.88 : l <= 1.5 ? 0.68 : l <= 2.5 ? 0.46 : l <= 3.5 ? 0.26 : 0.14;
  }
  if (d.includes("red card")) return 0.16;
  if (d.includes("to win")) return 0.42;
  if (d.includes("to score")) return 0.7;
  if (d.includes("corner")) return 0.52;
  if (d.includes("yellow") || d.includes("card")) return 0.55;
  return 0.5;
}

// ---- main ---------------------------------------------------------------------------------

function loadOrCreateB(): Keypair {
  if (fs.existsSync(B_WALLET_FILE)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(B_WALLET_FILE, "utf8"))));
  const kp = Keypair.generate();
  fs.writeFileSync(B_WALLET_FILE, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

const posPda = (market: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), owner.toBuffer()], ONSIDE_ID)[0];

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(onsideIdl as any, provider);
  const conn = provider.connection;
  const treasury = provider.wallet.publicKey;

  const { jwt, apiToken } = loadToken();
  const http = axios.create({ baseURL: DEVNET_API, headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken } });

  // Participant1 names (to resolve "<Team> to win" onto the right 1X2 side).
  const p1of: Record<number, string> = {};
  try {
    const fx = (await http.get(`/api/fixtures/snapshot`)).data;
    for (const f of Array.isArray(fx) ? fx : []) if (f?.FixtureId) p1of[f.FixtureId] = f.Participant1;
  } catch {
    /* names optional — "to win" falls back to prior */
  }

  const all = await (program.account as any).market.all([
    { memcmp: { offset: 8, bytes: anchor.utils.bytes.bs58.encode(treasury.toBuffer()) } },
  ]);
  const now = Math.floor(Date.now() / 1000);

  // Mirror the lobby exactly: per fixture keep only the latest creation batch (deduped by
  // description), then only the markets that are actually open/bettable. Stale older batches
  // and resolved showcase batches are ignored, so we seed only what users see and can bet.
  const BATCH_WINDOW = 180;
  const perFixtureAll = new Map<number, any[]>();
  for (const m of all) {
    const f = Number(m.account.fixtureId);
    (perFixtureAll.get(f) || perFixtureAll.set(f, []).get(f)!).push(m);
  }
  const byFixture = new Map<number, any[]>();
  for (const [f, ms] of perFixtureAll) {
    const maxCreated = Math.max(...ms.map((m: any) => Number(m.account.createdAt)));
    const recent = ms.filter((m: any) => Number(m.account.createdAt) >= maxCreated - BATCH_WINDOW);
    const byDesc = new Map<string, any>();
    for (const m of recent) {
      const cur = byDesc.get(m.account.description);
      if (!cur || Number(m.account.createdAt) > Number(cur.account.createdAt)) byDesc.set(m.account.description, m);
    }
    const latestOpen = [...byDesc.values()].filter((m: any) => m.account.status.open && now < Number(m.account.closeTs));
    if (latestOpen.length) byFixture.set(f, latestOpen);
  }
  const open = [...byFixture.values()].flat();

  type Plan = { m: any; desc: string; fixtureId: number; p: number; src: string; yes: number; no: number };
  const plan: Plan[] = [];
  let skipped = 0;
  for (const [fixtureId, ms] of byFixture) {
    let lines: Line[] = [];
    try {
      lines = parseOddsLines((await http.get(`/api/odds/snapshot/${fixtureId}?asOf=${Date.now()}`)).data);
    } catch {
      /* no odds — priors only */
    }
    for (const m of ms) {
      const a = m.account;
      if (Number(a.totalYes) > 0 && Number(a.totalNo) > 0) {
        skipped++;
        continue; // already has two-sided liquidity — don't double-seed
      }
      const desc = a.description as string;
      const c = consensusYes(desc, lines, p1of[fixtureId]);
      const p = Math.min(0.92, Math.max(0.08, c ?? priorYes(desc))); // clamp so neither side is dust
      const yes = Math.round(p * POOL_SOL * SOL);
      const no = Math.round((1 - p) * POOL_SOL * SOL);
      plan.push({ m, desc, fixtureId, p, src: c != null ? "consensus" : "prior", yes, no });
    }
    await sleep(120);
  }

  // Report.
  const yesSum = plan.reduce((s, x) => s + x.yes, 0);
  const noSum = plan.reduce((s, x) => s + x.no, 0);
  const bal = await conn.getBalance(treasury);
  console.log(`\nTreasury ${treasury.toBase58()}  balance ${sol(bal)} SOL`);
  console.log(`Open markets: ${open.length}   to seed: ${plan.length}   already-seeded (skipped): ${skipped}`);
  console.log(`POOL_SOL per market: ${POOL_SOL}\n`);
  console.log(`${"MARKET".padEnd(26)} ${"FIXTURE".padEnd(9)} ${"p(YES)".padEnd(7)} ${"SRC".padEnd(10)} YES     NO`);
  for (const x of plan)
    console.log(`${x.desc.slice(0, 25).padEnd(26)} ${String(x.fixtureId).padEnd(9)} ${x.p.toFixed(2).padEnd(7)} ${x.src.padEnd(10)} ${sol(x.yes).padEnd(7)} ${sol(x.no)}`);
  const bFundNeeded = noSum + Math.ceil(plan.length * 0.0017 * SOL) + 0.05 * SOL; // NO stakes + position rent + fees
  // Wallet B may already hold SOL from a prior (partial) run — only the shortfall costs the
  // treasury now, so the guard doesn't double-count funding on a resume.
  const bBalNow = fs.existsSync(B_WALLET_FILE)
    ? await conn.getBalance(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(B_WALLET_FILE, "utf8")))).publicKey)
    : 0;
  const bTopUp = Math.max(0, bFundNeeded - bBalNow);
  const treasurySpend = yesSum + bTopUp;
  console.log(`\nYES side (treasury): ${sol(yesSum)} SOL`);
  console.log(`NO side  (wallet B): ${sol(noSum)} SOL  (need ~${sol(bFundNeeded)}, B holds ${sol(bBalNow)} → top up ${sol(bTopUp)})`);
  console.log(`Treasury total outlay: ~${sol(treasurySpend)} SOL   (cap ${MAX_TREASURY_SPEND})`);
  console.log(`Recoverable after settlement by claiming the winning side.\n`);

  if (!plan.length) {
    console.log("Nothing to seed.");
    return;
  }
  if (treasurySpend > MAX_TREASURY_SPEND * SOL) {
    console.log(`ABORT: outlay exceeds MAX_SPEND (${MAX_TREASURY_SPEND}). Lower POOL_SOL or raise MAX_SPEND.`);
    return;
  }
  if (treasurySpend > bal - 0.2 * SOL) {
    console.log(`ABORT: treasury balance too low. Need ~${sol(treasurySpend)} + buffer, have ${sol(bal)}.`);
    return;
  }
  if (!EXECUTE) {
    console.log("DRY RUN — set EXECUTE=1 to place these bets.");
    return;
  }

  // Execute: fund wallet B, then place YES (treasury) + NO (B) per market.
  const b = loadOrCreateB();
  const bProvider = new anchor.AnchorProvider(conn, new anchor.Wallet(b), { commitment: "confirmed" });
  const bProgram = new anchor.Program(onsideIdl as any, bProvider);

  const bBal = await conn.getBalance(b.publicKey);
  if (bBal < bFundNeeded) {
    const topUp = bFundNeeded - bBal;
    console.log(`Funding wallet B ${b.publicKey.toBase58()} with ${sol(topUp)} SOL…`);
    const sig = await withRetry(() => {
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({ fromPubkey: treasury, toPubkey: b.publicKey, lamports: topUp })
      );
      return provider.sendAndConfirm!(tx);
    }, "fund wallet B");
    if (!sig) {
      console.log("ABORT: could not fund wallet B.");
      return;
    }
    await sleep(1500);
  } else {
    console.log(`Wallet B ${b.publicKey.toBase58()} already holds ${sol(bBal)} SOL — no top-up needed.`);
  }

  // Per-side idempotency: never re-stake a side that already has liquidity, so a retry after a
  // partial run tops up the missing side instead of doubling the filled one.
  let doneY = 0,
    doneN = 0;
  for (const x of plan) {
    const market = x.m.publicKey as PublicKey;
    const a = x.m.account;
    let y = "·",
      n = "·";
    if (x.yes > 0 && Number(a.totalYes) === 0) {
      const r = await withRetry(
        () =>
          program.methods
            .placeBet({ yes: {} }, new BN(x.yes))
            .accounts({ market, position: posPda(market, treasury), bettor: treasury, systemProgram: SystemProgram.programId })
            .rpc(),
        `YES ${x.desc}`
      );
      if (r) {
        doneY++;
        y = "YES✓";
      }
      await sleep(500);
    }
    if (x.no > 0 && Number(a.totalNo) === 0) {
      const r = await withRetry(
        () =>
          bProgram.methods
            .placeBet({ no: {} }, new BN(x.no))
            .accounts({ market, position: posPda(market, b.publicKey), bettor: b.publicKey, systemProgram: SystemProgram.programId })
            .rpc(),
        `NO ${x.desc}`
      );
      if (r) {
        doneN++;
        n = "NO✓";
      }
    }
    console.log(`${x.desc.slice(0, 26).padEnd(27)} ${y.padEnd(5)} ${n.padEnd(5)} YES ${sol(x.yes)} / NO ${sol(x.no)}`);
    await sleep(SLEEP_MS);
  }
  console.log(`\nSeeded ${doneY} YES + ${doneN} NO sides across ${plan.length} markets. Wallet B key: ${B_WALLET_FILE}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
