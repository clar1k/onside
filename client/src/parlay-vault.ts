/** Manage the protocol-funded parlay vault.
 *
 *   ACTION=init npx tsx src/parlay-vault.ts
 *   ACTION=deposit AMOUNT_SOL=5 npx tsx src/parlay-vault.ts
 *   ACTION=withdraw AMOUNT_SOL=5 npx tsx src/parlay-vault.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../idl/onside.json";
import { getProvider } from "./config";

async function main() {
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("parlay_vault"), authority.toBuffer()],
    program.programId
  );
  const action = process.env.ACTION || "status";

  if (action === "init") {
    const sig = await program.methods.initializeParlayVault()
      .accounts({ vault, authority, systemProgram: SystemProgram.programId }).rpc();
    console.log("initialized", vault.toBase58(), sig);
    return;
  }

  const amount = Math.floor(Number(process.env.AMOUNT_SOL || 0) * LAMPORTS_PER_SOL);
  if ((action === "deposit" || action === "withdraw") && amount <= 0)
    throw new Error("Set AMOUNT_SOL to a positive amount");
  if (action === "deposit") {
    const sig = await program.methods.depositParlayLiquidity(new anchor.BN(amount))
      .accounts({ vault, depositor: authority, systemProgram: SystemProgram.programId }).rpc();
    console.log("deposited", process.env.AMOUNT_SOL, "SOL", sig);
  } else if (action === "withdraw") {
    const sig = await program.methods.withdrawParlayLiquidity(new anchor.BN(amount))
      .accounts({ vault, authority }).rpc();
    console.log("withdrew", process.env.AMOUNT_SOL, "SOL", sig);
  } else {
    const balance = await provider.connection.getBalance(vault);
    console.log("vault", vault.toBase58(), "balance", balance / LAMPORTS_PER_SOL, "SOL");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
