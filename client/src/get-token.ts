/**
 * M0 — Obtain a FREE World Cup tier TxLINE apiToken on devnet.
 *
 * Flow (no TxL purchase, no payment):
 *   1. POST /auth/guest/start                  -> guest JWT (30-day)
 *   2. on-chain subscribe(level 12, 4 weeks)   -> 0 TxL (free real-time WC tier)
 *   3. POST /api/token/activate                -> long-lived apiToken
 *   4. cache {jwt, apiToken} for the other scripts
 *
 * Requires a devnet wallet with a little SOL (ATA rent + tx fee):
 *   solana airdrop 2 --url devnet
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import axios from "axios";
import * as nacl from "tweetnacl";
import fs from "fs";
import idl from "../idl/txoracle.json";
import { Txoracle } from "../types/txoracle";
import {
  getProvider,
  getTxoracleProgram,
  loadKeypair,
  DEVNET_API,
  TXLINE_MINT,
  TOKEN_FILE,
} from "./config";

const SERVICE_LEVEL_ID = 1; // devnet pricing matrix row 1 = free (0 TxL), realtime (samplingSec=0)
const DURATION_WEEKS = 4; // 4-week minimum cycle
const SELECTED_LEAGUES: number[] = []; // empty = standard free WC + friendlies bundle

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = getTxoracleProgram(provider);
  const payer = loadKeypair();
  const wallet = provider.wallet.publicKey;
  console.log("Wallet :", wallet.toBase58());

  const lamports = await provider.connection.getBalance(wallet);
  console.log("SOL    :", lamports / 1e9);
  if (lamports < 0.03 * 1e9) {
    console.warn("⚠️  Low SOL — run: solana airdrop 2 --url devnet");
  }

  // Token-2022 ATA for TxL (created if missing; free tier transfers 0 TxL).
  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    TXLINE_MINT,
    wallet,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("TxL ATA:", userTokenAccount.address.toBase58());

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    TXLINE_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  // 1) Guest session
  const jwt = (await axios.post(`${DEVNET_API}/auth/guest/start`)).data.token;
  console.log("✓ guest JWT");

  // 2) On-chain subscribe (free tier → 0 TxL)
  console.log(`Subscribing (level ${SERVICE_LEVEL_ID}, ${DURATION_WEEKS}w)…`);
  const txSig = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: wallet,
      pricingMatrix: pricingMatrixPda,
      tokenMint: TXLINE_MINT,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("✓ subscribe tx:", txSig);
  console.log(`  https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

  // 3) Activate API access
  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const signatureBytes = nacl.sign.detached(
    new TextEncoder().encode(messageString),
    payer.secretKey
  );
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  const activation = await axios.post(
    `${DEVNET_API}/api/token/activate`,
    { txSig, walletSignature, leagues: SELECTED_LEAGUES },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const apiToken = activation.data.token || activation.data;

  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify(
      { jwt, apiToken, wallet: wallet.toBase58(), createdAt: Date.now() },
      null,
      2
    )
  );
  console.log("✓ apiToken acquired, cached →", TOKEN_FILE);
}

main().catch((e) => {
  console.error("get-token failed:", e?.response?.data || e?.message || e);
  process.exit(1);
});
