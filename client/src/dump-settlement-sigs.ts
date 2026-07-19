/**
 * One-off: snapshot each resolved market's *settlement* (resolve_market) transaction
 * signature to web/lib/settlementSigs.json. Settlement is immutable, so this static map
 * lets the Proofs page and the resolution receipt link straight to Solana Explorer with
 * zero RPC at load time — no 429 storm from dozens of rows racing getSignaturesForAddress.
 *
 * A market's newest signature can be a later *claim* tx, so we identify the actual
 * resolve_market tx by its Anchor instruction log rather than blindly taking the latest.
 *
 * Run: ANCHOR_PROVIDER_URL=https://api.devnet.solana.com npx --yes tsx src/dump-settlement-sigs.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import onsideIdl from "../idl/onside.json";
import { getProvider } from "./config";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The resolve_market signature for a market, found by scanning its history for the tx
 *  whose logs carry the ResolveMarket instruction (claims/bets come after, so we can't
 *  just grab the newest). Falls back to the newest successful sig if none is identified. */
async function settlementSig(conn: Connection, market: PublicKey): Promise<string | null> {
  const sigs = await conn.getSignaturesForAddress(market, { limit: 100 });
  for (const s of sigs) {
    if (s.err) continue;
    await sleep(200);
    try {
      const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages || [];
      if (logs.some((l) => l.includes("Instruction: ResolveMarket"))) return s.signature;
    } catch {
      /* transient — keep scanning */
    }
  }
  const ok = sigs.find((s) => !s.err) || sigs[0];
  return ok?.signature ?? null;
}

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(onsideIdl as any, provider);
  const conn = provider.connection;

  const all = await (program.account as any).market.all();
  const resolved = all.filter((m: any) => m.account.status.resolved);
  console.log(`${all.length} markets, ${resolved.length} resolved`);

  const dest = path.join(__dirname, "..", "..", "web", "lib", "settlementSigs.json");
  const out: Record<string, string> = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, "utf8")) : {};

  let found = 0;
  for (const m of resolved) {
    const key = m.publicKey.toBase58();
    if (out[key]) {
      found++;
      continue; // immutable — already snapshotted
    }
    try {
      const sig = await settlementSig(conn, m.publicKey);
      if (sig) {
        out[key] = sig;
        found++;
      }
      console.log(`${key}  ${m.account.description}  ->  ${sig ?? "—"}`);
    } catch (e: any) {
      console.log(`skip ${key}: ${e.message}`);
    }
    await sleep(250);
  }

  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${Object.keys(out).length} sigs (${found} of ${resolved.length} resolved covered) -> ${dest}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
