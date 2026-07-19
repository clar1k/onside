import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Onside } from "../target/types/onside";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

// Local-validator coverage for the pool/claim math and guards. The settlement CPI
// (resolve_market → txoracle.validate_stat) and NO-outcome resolution are covered by
// the real devnet scripts: client/src/verify-settlement.ts and settle-fixture.ts.
describe("onside", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Onside as Program<Onside>;
  const authority = provider.wallet.publicKey;

  const sol = (n: number) => new BN(Math.round(n * LAMPORTS_PER_SOL));
  const pdas = (marketId: BN) => {
    const [market] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), authority.toBuffer(), marketId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [position] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), market.toBuffer(), authority.toBuffer()],
      program.programId
    );
    return { market, position };
  };

  const initParams = (marketId: BN, closeInSec: number) => ({
    marketId,
    fixtureId: new BN(1),
    period: 0,
    statAKey: 1,
    statBKey: 2,
    op: 1,
    yesPredicate: { threshold: 0, comparison: { greaterThan: {} } },
    closeTs: new BN(Math.floor(Date.now() / 1000) + closeInSec),
    settleAfterTs: new BN(1),
    feeBps: 0,
    description: "Test market",
  });

  it("init → bet YES+NO → void → claim refund", async () => {
    const marketId = new BN(Date.now());
    const { market, position } = pdas(marketId);

    await program.methods
      .initializeMarket(initParams(marketId, 5))
      .accounts({ market, authority, systemProgram: SystemProgram.programId })
      .rpc();

    const betAccts = { market, position, bettor: authority, systemProgram: SystemProgram.programId };
    await program.methods.placeBet({ yes: {} }, sol(0.1)).accounts(betAccts).rpc();
    await program.methods.placeBet({ no: {} }, sol(0.05)).accounts(betAccts).rpc();

    let m = await program.account.market.fetch(market);
    assert.equal(m.totalYes.toNumber(), 0.1 * LAMPORTS_PER_SOL, "YES pool");
    assert.equal(m.totalNo.toNumber(), 0.05 * LAMPORTS_PER_SOL, "NO pool");

    await program.methods.voidMarket().accounts({ market, authority }).rpc();
    m = await program.account.market.fetch(market);
    assert.ok((m.status as any).void, "voided");

    const before = await provider.connection.getBalance(authority);
    await program.methods.claim().accounts({ market, position, owner: authority }).rpc();
    const after = await provider.connection.getBalance(authority);
    assert.ok(after > before, "refund increased balance");
  });

  it("rejects a bet after the close time", async () => {
    const marketId = new BN(Date.now() + 1);
    const { market, position } = pdas(marketId);
    await program.methods
      .initializeMarket(initParams(marketId, 1))
      .accounts({ market, authority, systemProgram: SystemProgram.programId })
      .rpc();
    await new Promise((r) => setTimeout(r, 2500));
    let rejected = false;
    try {
      await program.methods
        .placeBet({ yes: {} }, sol(0.01))
        .accounts({ market, position, bettor: authority, systemProgram: SystemProgram.programId })
        .rpc();
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "bet after close must be rejected");
  });

  it("rejects a millisecond close_ts (unit guard)", async () => {
    const marketId = new BN(Date.now() + 2);
    const { market } = pdas(marketId);
    const bad = initParams(marketId, 5);
    bad.closeTs = new BN(Date.now()); // milliseconds → far in the future → rejected
    let rejected = false;
    try {
      await program.methods
        .initializeMarket(bad)
        .accounts({ market, authority, systemProgram: SystemProgram.programId })
        .rpc();
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "ms close_ts must be rejected");
  });
});
