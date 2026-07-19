import { NextRequest } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

export const dynamic = "force-dynamic";

const RPC = process.env.NEXT_PUBLIC_RPC || "https://api.devnet.solana.com";
const AMOUNT = 0.2 * 1e9; // 0.2 SOL per top-up
const PER_ADDRESS_MAX = 3; // funds per address per server lifetime
const GLOBAL_MAX = 250; // total funds per server lifetime

// In-memory caps (sufficient for a single-instance devnet demo; back with a KV store
// for a multi-instance deployment).
const funded = new Map<string, number>();
let globalCount = 0;

function isDevnet() {
  return RPC.includes("devnet") || RPC.includes("localhost") || RPC.includes("127.0.0.1");
}

// Treasury key from env (production) with a dev-only filesystem fallback.
function treasury(): Keypair {
  const env = process.env.TREASURY_SECRET_KEY;
  const raw = env
    ? env
    : fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

// Devnet-only faucet so judges can try the app instantly without funding a wallet
// (per the hackathon brief). Hard-gated off mainnet, with per-address + global caps.
export async function POST(req: NextRequest) {
  if (!isDevnet()) {
    return Response.json({ error: "faucet is disabled on this network" }, { status: 403 });
  }
  if (globalCount >= GLOBAL_MAX) {
    return Response.json({ error: "faucet limit reached, try later" }, { status: 429 });
  }
  try {
    const { address } = await req.json();
    const to = new PublicKey(address); // throws on a bad address
    const used = funded.get(address) || 0;
    if (used >= PER_ADDRESS_MAX) {
      return Response.json({ error: "top-up limit reached for this wallet" }, { status: 429 });
    }

    const seed = treasury();
    const conn = new Connection(RPC, "confirmed");
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: seed.publicKey, recentBlockhash: blockhash }).add(
      SystemProgram.transfer({ fromPubkey: seed.publicKey, toPubkey: to, lamports: AMOUNT })
    );
    tx.sign(seed);
    const sig = await conn.sendRawTransaction(tx.serialize());
    for (let i = 0; i < 20; i++) {
      const st = await conn.getSignatureStatus(sig);
      const s = st?.value?.confirmationStatus;
      if (s === "confirmed" || s === "finalized") break;
      await new Promise((r) => setTimeout(r, 800));
    }
    funded.set(address, used + 1);
    globalCount++;
    return Response.json({ sig });
  } catch (e: any) {
    return Response.json({ error: e?.message || "fund failed" }, { status: 500 });
  }
}
