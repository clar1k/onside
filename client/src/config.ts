import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";
import idl from "../idl/txoracle.json";

/** Devnet API host (carries match re-runs for integration). */
export const DEVNET_API = "https://txline-dev.txodds.com";

/**
 * TxLINE `txoracle` program on DEVNET.
 * NOTE: the committed `idl/txoracle.json` carries the MAINNET address
 * (9ExbZ…), so we override it explicitly for devnet PDA derivation.
 */
export const TXORACLE_PROGRAM_ID = new PublicKey(
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
);

/**
 * Live devnet TxL mint (Token-2022). The IDL `TXLINE_MINT` constant
 * (Zhw9TVKp…) is stale and absent on devnet; this is verified on-chain.
 */
export const TXLINE_MINT = new PublicKey(
  "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"
);

export const RPC = process.env.ANCHOR_PROVIDER_URL || clusterApiUrl("devnet");

/** Path where get-token.ts caches the JWT + apiToken for other scripts. */
export const TOKEN_FILE = path.join(__dirname, "..", ".txline-token.json");

export function loadKeypair(): Keypair {
  const p =
    process.env.ANCHOR_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function getProvider(): anchor.AnchorProvider {
  const connection = new Connection(RPC, "confirmed");
  const wallet = new anchor.Wallet(loadKeypair());
  return new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

/** Build the txoracle Program with the address forced to the devnet deployment. */
export function getTxoracleProgram(
  provider: anchor.AnchorProvider
): anchor.Program {
  const dl = { ...(idl as any), address: TXORACLE_PROGRAM_ID.toBase58() };
  return new anchor.Program(dl as any, provider);
}

export function loadToken(): { jwt: string; apiToken: string; wallet: string } {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`No token cache at ${TOKEN_FILE}. Run: npm run get-token`);
  }
  return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
}
