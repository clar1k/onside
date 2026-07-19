import { NextRequest } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";
import idl from "@/lib/idl/onside.json";
import { ONSIDE_PROGRAM_ID, RPC } from "@/lib/config";

export const dynamic = "force-dynamic";

const MAX_STAKE = 0.5 * anchor.web3.LAMPORTS_PER_SOL;
const MAX_PAYOUT = 5 * anchor.web3.LAMPORTS_PER_SOL;
const HOUSE_FACTOR = 0.95;

function authority(): Keypair {
  const raw = process.env.TREASURY_SECRET_KEY ||
    fs.readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const owner = new PublicKey(body.owner);
    const stake = Math.floor(Number(body.stakeLamports));
    const legs = Array.isArray(body.legs) ? body.legs : [];
    if (!Number.isSafeInteger(stake) || stake <= 0 || stake > MAX_STAKE)
      return Response.json({ error: "Stake must be between 0 and 0.5 SOL" }, { status: 400 });
    if (legs.length < 2 || legs.length > 8)
      return Response.json({ error: "Choose between 2 and 8 markets" }, { status: 400 });

    const signer = authority();
    const connection = new Connection(RPC, "confirmed");
    const wallet: any = {
      publicKey: signer.publicKey,
      signTransaction: async <T extends Transaction>(tx: T) => { tx.partialSign(signer); return tx; },
      signAllTransactions: async <T extends Transaction>(txs: T[]) => {
        txs.forEach((tx) => tx.partialSign(signer));
        return txs;
      },
    };
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const program = new anchor.Program({ ...(idl as any), address: ONSIDE_PROGRAM_ID }, provider);
    const marketKeys = legs.map((leg: any) => new PublicKey(leg.market));
    if (new Set(marketKeys.map((k: PublicKey) => k.toBase58())).size !== marketKeys.length)
      return Response.json({ error: "A market can only be selected once" }, { status: 400 });

    const markets = await (program.account as any).market.fetchMultiple(marketKeys);
    const now = Math.floor(Date.now() / 1000);
    let fixture: number | null = null;
    let combined = 1;
    const legOddsBps: number[] = [];
    for (let i = 0; i < markets.length; i++) {
      const market = markets[i];
      if (!market) return Response.json({ error: "Market not found" }, { status: 400 });
      if (!market.status.open || Number(market.closeTs) <= now)
        return Response.json({ error: "One of the selected markets is closed" }, { status: 400 });
      const marketFixture = Number(market.fixtureId);
      if (fixture !== null && fixture !== marketFixture)
        return Response.json({ error: "All selections must be from one match" }, { status: 400 });
      fixture = marketFixture;

      const totalYes = Number(market.totalYes);
      const totalNo = Number(market.totalNo);
      const total = totalYes + totalNo;
      const yesProbability = total > 0 ? totalYes / total : 0.5;
      const probability = legs[i].side === "yes" ? yesProbability : 1 - yesProbability;
      const legOdds = HOUSE_FACTOR / Math.max(0.1, Math.min(0.9, probability));
      legOddsBps.push(Math.floor(Math.max(1, legOdds) * 10_000));
      combined *= legOdds;
    }

    const oddsBps = Math.floor(Math.max(1, Math.min(20, combined)) * 10_000);
    const payout = Math.floor((stake * oddsBps) / 10_000);
    if (payout > MAX_PAYOUT)
      return Response.json({ error: "Potential payout exceeds the 5 SOL limit" }, { status: 400 });

    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("parlay_vault"), signer.publicKey.toBuffer()],
      program.programId
    );
    const vaultAccount = await connection.getAccountInfo(vault);
    if (!vaultAccount)
      return Response.json({ error: "Parlay vault is not initialized" }, { status: 503 });
    const rentMinimum = await connection.getMinimumBalanceForRentExemption(vaultAccount.data.length);
    const outstanding = await (program.account as any).parlayTicket.all([{
      memcmp: { offset: 8, bytes: anchor.utils.bytes.bs58.encode(vault.toBuffer()) },
    }]);
    const reserved = outstanding.reduce((sum: number, row: any) =>
      sum + (row.account.status.open || row.account.status.won ? Number(row.account.payout) : 0), 0);
    if (Math.max(0, vaultAccount.lamports - rentMinimum - reserved) + stake < payout)
      return Response.json({ error: "Parlay vault has insufficient liquidity for this payout" }, { status: 503 });

    const ticketId = new anchor.BN(Date.now() * 1000 + Math.floor(Math.random() * 1000));
    const [ticket] = PublicKey.findProgramAddressSync(
      [Buffer.from("parlay_ticket"), owner.toBuffer(), ticketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const instruction = await program.methods
      .placeParlay(
        ticketId,
        new anchor.BN(stake),
        new anchor.BN(oddsBps),
        legs.map((leg: any, i: number) => ({
          market: marketKeys[i],
          side: leg.side === "yes" ? { yes: {} } : { no: {} },
          oddsBps: new anchor.BN(legOddsBps[i]),
        }))
      )
      .accounts({ vault, authority: signer.publicKey, ticket, owner, systemProgram: SystemProgram.programId })
      .remainingAccounts(marketKeys.map((pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false })))
      .instruction();

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(instruction);
    tx.partialSign(signer);
    return Response.json({
      transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
      ticket: ticket.toBase58(),
      oddsBps,
      payout,
      lastValidBlockHeight,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "Unable to quote parlay" }, { status: 500 });
  }
}
