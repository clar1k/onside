/** Close all currently-open markets for one fixture so proof settlement can begin.
 * Run: FIXTURE_ID=<id> npx tsx src/close-markets.ts
 */
import * as anchor from "@coral-xyz/anchor";
import idl from "../idl/onside.json";
import { getProvider } from "./config";

async function main() {
  const fixtureId = Number(process.env.FIXTURE_ID);
  if (!fixtureId) throw new Error("Set FIXTURE_ID");
  const provider = getProvider();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;
  const markets = await (program.account as any).market.all([
    { memcmp: { offset: 8, bytes: anchor.utils.bytes.bs58.encode(authority.toBuffer()) } },
  ]);
  const selected = markets.filter((row: any) =>
    Number(row.account.fixtureId) === fixtureId && row.account.status.open
  );
  for (const row of selected) {
    const signature = await program.methods.closeMarketEarly()
      .accounts({ market: row.publicKey, authority })
      .rpc();
    console.log("closed", row.account.description, signature);
  }
  console.log(`closed ${selected.length} market(s)`);
}

main().catch((error) => {
  console.error(error?.error?.errorMessage || error?.message || error);
  process.exit(1);
});
