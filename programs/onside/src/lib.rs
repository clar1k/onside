use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("6F6fVu5x4ng1mxxLtXseVEE9ZxRAvyjxqeXfDQUsEpvb");

/// TxLINE `txoracle` program (Solana DEVNET). Settlement is verified by CPI into
/// this program's permissionless `validate_stat` instruction, which proves a
/// match statistic against an on-chain Merkle root.
pub const TXORACLE_PROGRAM_ID: Pubkey =
    anchor_lang::pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/// Anchor discriminator for `txoracle::validate_stat` (from the published IDL).
pub const VALIDATE_STAT_DISCM: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];

pub const MAX_DESCRIPTION_LEN: usize = 80;
pub const MAX_FEE_BPS: u16 = 1000; // 10% cap
pub const MAX_PARLAY_LEGS: usize = 8;

#[program]
pub mod onside {
    use super::*;

    /// Create a parimutuel binary market over a TxODDS fixture statistic.
    /// `yes_predicate` / `no_predicate` are the two complementary settlement
    /// conditions (e.g. total goals > 2 vs total goals < 3 for an Over/Under 2.5).
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        params: InitMarketParams,
    ) -> Result<()> {
        require!(
            params.description.len() <= MAX_DESCRIPTION_LEN,
            OnsideError::DescriptionTooLong
        );
        require!(params.fee_bps <= MAX_FEE_BPS, OnsideError::FeeTooHigh);
        // close_ts is a unix-SECONDS betting deadline (vs the chain clock); settle_after_ts
        // is an oracle-MILLISECONDS floor (vs the proof ts). Different clocks — checked
        // independently, never against each other. The seconds-range guard also rejects a
        // value accidentally supplied in milliseconds (which would land far in the future).
        let now = Clock::get()?.unix_timestamp;
        require!(
            params.close_ts > now - 86_400 && params.close_ts < now + 366 * 86_400,
            OnsideError::InvalidSchedule
        );
        require!(params.settle_after_ts >= 0, OnsideError::InvalidSchedule);
        // op == 0 (none) requires a single stat; op != 0 requires a second stat.
        require!(params.op <= 2, OnsideError::InvalidConfig);
        if params.op == 0 {
            require!(params.stat_b_key == 0, OnsideError::InvalidConfig);
        } else {
            require!(params.stat_b_key != 0, OnsideError::InvalidConfig);
        }

        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.market_id = params.market_id;
        market.fixture_id = params.fixture_id;
        market.period = params.period;
        market.stat_a_key = params.stat_a_key;
        market.stat_b_key = params.stat_b_key;
        market.op = params.op;
        market.yes_predicate = params.yes_predicate;
        market.close_ts = params.close_ts;
        market.settle_after_ts = params.settle_after_ts;
        market.total_yes = 0;
        market.total_no = 0;
        market.outcome = Outcome::Unresolved;
        market.status = MarketStatus::Open;
        market.fee_bps = params.fee_bps;
        market.created_at = Clock::get()?.unix_timestamp;
        market.bump = ctx.bumps.market;
        market.description = params.description;

        emit!(MarketInitialized {
            market: market.key(),
            fixture_id: market.fixture_id,
            close_ts: market.close_ts,
        });
        Ok(())
    }

    /// Stake lamports on YES or NO. No counterparty required — funds join the pool.
    pub fn place_bet(ctx: Context<PlaceBet>, side: Side, amount: u64) -> Result<()> {
        require!(amount > 0, OnsideError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        {
            let market = &ctx.accounts.market;
            require!(
                market.status == MarketStatus::Open,
                OnsideError::MarketClosed
            );
            require!(now < market.close_ts, OnsideError::BettingClosed);
        }

        // Move SOL from the bettor into the market account (the pool vault).
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bettor.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            amount,
        )?;

        let position = &mut ctx.accounts.position;
        position.market = ctx.accounts.market.key();
        position.owner = ctx.accounts.bettor.key();
        position.bump = ctx.bumps.position;

        let market = &mut ctx.accounts.market;
        match side {
            Side::Yes => {
                position.yes_amount = position
                    .yes_amount
                    .checked_add(amount)
                    .ok_or(OnsideError::MathOverflow)?;
                market.total_yes = market
                    .total_yes
                    .checked_add(amount)
                    .ok_or(OnsideError::MathOverflow)?;
            }
            Side::No => {
                position.no_amount = position
                    .no_amount
                    .checked_add(amount)
                    .ok_or(OnsideError::MathOverflow)?;
                market.total_no = market
                    .total_no
                    .checked_add(amount)
                    .ok_or(OnsideError::MathOverflow)?;
            }
        }

        emit!(BetPlaced {
            market: market.key(),
            bettor: position.owner,
            side,
            amount,
        });
        Ok(())
    }

    /// Trustlessly settle the market by proving the result via TxLINE.
    /// Anyone may call this (permissionless). The CPI into `txoracle::validate_stat`
    /// aborts unless every supplied stat value is authentic against the on-chain
    /// Merkle root (verified on devnet — a tampered value is rejected). The winning
    /// side is then DERIVED from the proven values and the market's predicate, so the
    /// caller has no discretion over the outcome.
    pub fn resolve_market(
        ctx: Context<ResolveMarket>,
        ts: i64,
        fixture_summary: ScoresBatchSummary,
        fixture_proof: Vec<ProofNode>,
        main_tree_proof: Vec<ProofNode>,
        stat_a: StatTerm,
        stat_b: Option<StatTerm>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market = &ctx.accounts.market;
        require!(
            market.status == MarketStatus::Open,
            OnsideError::AlreadyResolved
        );
        require!(now >= market.close_ts, OnsideError::BettingStillOpen);
        // `ts` is the oracle batch timestamp (ms); settle_after_ts is stored in ms too.
        require!(ts >= market.settle_after_ts, OnsideError::TooEarlyToSettle);

        // Bind the supplied proof to THIS market's configured statistic. `period` uses
        // `>=` so a market configured to settle from a given game phase can be settled
        // with a proof from that phase or any later one — enabling settlement across the
        // real lifecycle of any fixture, not just one pinned snapshot.
        require!(
            stat_a.stat_to_prove.key == market.stat_a_key
                && stat_a.stat_to_prove.period >= market.period,
            OnsideError::StatMismatch
        );
        if market.stat_b_key != 0 {
            let b = stat_b.as_ref().ok_or(OnsideError::MissingStatB)?;
            require!(
                b.stat_to_prove.key == market.stat_b_key && b.stat_to_prove.period >= market.period,
                OnsideError::StatMismatch
            );
        } else {
            require!(stat_b.is_none(), OnsideError::UnexpectedStatB);
        }

        // Defense in depth: the roots account must be owned by the txoracle program.
        require!(
            ctx.accounts.daily_scores_merkle_roots.owner == &TXORACLE_PROGRAM_ID,
            OnsideError::BadRootsAccount
        );

        // Capture the claimed values, then have txoracle PROVE them. `validate_stat`
        // aborts the tx if any value/proof is forged, so after the CPI these values
        // are authenticated on-chain truth.
        let a_val = stat_a.stat_to_prove.value as i64;
        let b_val = stat_b.as_ref().map(|b| b.stat_to_prove.value as i64);

        let op = match market.op {
            1 => Some(BinaryExpression::Add),
            2 => Some(BinaryExpression::Subtract),
            _ => None,
        };
        let args = ValidateStatArgs {
            ts,
            fixture_summary,
            fixture_proof,
            main_tree_proof,
            predicate: market.yes_predicate.clone(), // required arg; outcome derived below
            stat_a,
            stat_b,
            op,
        };
        let mut data = VALIDATE_STAT_DISCM.to_vec();
        data.extend_from_slice(&args.try_to_vec()?);
        let ix = Instruction {
            program_id: TXORACLE_PROGRAM_ID,
            accounts: vec![AccountMeta::new_readonly(
                ctx.accounts.daily_scores_merkle_roots.key(),
                false,
            )],
            data,
        };
        invoke(
            &ix,
            &[
                ctx.accounts.daily_scores_merkle_roots.to_account_info(),
                ctx.accounts.tx_oracle_program.to_account_info(),
            ],
        )?;

        // Combine the now-proven values and derive the winner from the market predicate.
        let combined: i64 = match market.op {
            1 => a_val
                .checked_add(b_val.ok_or(OnsideError::MissingStatB)?)
                .ok_or(OnsideError::MathOverflow)?,
            2 => a_val
                .checked_sub(b_val.ok_or(OnsideError::MissingStatB)?)
                .ok_or(OnsideError::MathOverflow)?,
            _ => a_val,
        };
        let yes = eval_predicate(&market.yes_predicate, combined);

        let market = &mut ctx.accounts.market;
        market.outcome = if yes { Outcome::Yes } else { Outcome::No };
        market.status = MarketStatus::Resolved;
        emit!(MarketResolved {
            market: market.key(),
            outcome: market.outcome,
            ts,
        });
        Ok(())
    }

    /// Authority-only escape hatch: void a market (e.g. fixture abandoned) so all
    /// stakes can be refunded. Cannot be called once resolved.
    pub fn void_market(ctx: Context<AdminMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Open,
            OnsideError::AlreadyResolved
        );
        market.status = MarketStatus::Void;
        market.outcome = Outcome::Void;
        emit!(MarketVoided {
            market: market.key()
        });
        Ok(())
    }

    /// Authority-only emergency close. Stops new bets immediately while leaving the
    /// market open for normal, proof-backed resolution.
    pub fn close_market_early(ctx: Context<AdminMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.status == MarketStatus::Open,
            OnsideError::MarketClosed
        );
        market.close_ts = Clock::get()?.unix_timestamp;
        emit!(MarketClosedEarly {
            market: market.key(),
            close_ts: market.close_ts,
        });
        Ok(())
    }

    /// Claim parimutuel winnings (or a refund if the market was voided / had no
    /// winners). Pro-rata payout = stake * total_pool / winning_pool, less fee on profit.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(
            market.status == MarketStatus::Resolved || market.status == MarketStatus::Void,
            OnsideError::NotResolved
        );

        let pos = &ctx.accounts.position;
        let total_yes = market.total_yes as u128;
        let total_no = market.total_no as u128;
        let pool = total_yes + total_no;

        let payout: u64 = if market.status == MarketStatus::Void {
            // Refund both sides.
            (pos.yes_amount as u128 + pos.no_amount as u128) as u64
        } else {
            let (win_stake, winning_pool) = match market.outcome {
                Outcome::Yes => (pos.yes_amount as u128, total_yes),
                Outcome::No => (pos.no_amount as u128, total_no),
                _ => return err!(OnsideError::NotResolved),
            };
            if winning_pool == 0 {
                // Nobody backed the winning side: refund everyone their own stake.
                (pos.yes_amount as u128 + pos.no_amount as u128) as u64
            } else if win_stake == 0 {
                0
            } else {
                let gross = win_stake
                    .checked_mul(pool)
                    .ok_or(OnsideError::MathOverflow)?
                    / winning_pool;
                let profit = gross.saturating_sub(win_stake);
                let fee = profit
                    .checked_mul(market.fee_bps as u128)
                    .ok_or(OnsideError::MathOverflow)?
                    / 10_000u128;
                (gross - fee) as u64
            }
        };

        if payout > 0 {
            // Market is program-owned, so we can move its lamports directly. Defensive
            // invariant: never let the balance fall below the rent-exempt minimum — pooled
            // stakes sit on top of rent, so payouts must come only from the pool.
            let market_ai = ctx.accounts.market.to_account_info();
            let owner_ai = ctx.accounts.owner.to_account_info();
            let rent_min = Rent::get()?.minimum_balance(market_ai.data_len());
            let remaining = market_ai
                .lamports()
                .checked_sub(payout)
                .ok_or(OnsideError::InsufficientPool)?;
            require!(remaining >= rent_min, OnsideError::InsufficientPool);
            **market_ai.try_borrow_mut_lamports()? = remaining;
            **owner_ai.try_borrow_mut_lamports()? = owner_ai
                .lamports()
                .checked_add(payout)
                .ok_or(OnsideError::MathOverflow)?;
        }

        emit!(Claimed {
            market: ctx.accounts.market.key(),
            owner: ctx.accounts.owner.key(),
            payout,
        });
        // `position` is closed to `owner` (see Claim accounts), returning its rent.
        Ok(())
    }

    pub fn initialize_parlay_vault(ctx: Context<InitializeParlayVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit_parlay_liquidity(
        ctx: Context<DepositParlayLiquidity>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, OnsideError::ZeroAmount);
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// The authority may withdraw available vault lamports. This is intentionally
    /// custodial: open-ticket liabilities are not reserved on-chain.
    pub fn withdraw_parlay_liquidity(
        ctx: Context<WithdrawParlayLiquidity>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, OnsideError::ZeroAmount);
        move_program_lamports(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.authority.to_account_info(),
            amount,
        )
    }

    /// Creates one fixed-payout ticket. The vault authority co-signs the transaction,
    /// authorizing the quoted odds and payout.
    pub fn place_parlay<'info>(
        ctx: Context<'_, '_, 'info, 'info, PlaceParlay<'info>>,
        ticket_id: u64,
        stake: u64,
        odds_bps: u64,
        legs: Vec<ParlayLeg>,
    ) -> Result<()> {
        require!(stake > 0, OnsideError::ZeroAmount);
        require!(odds_bps >= 10_000, OnsideError::InvalidParlayOdds);
        require!(
            legs.len() >= 2 && legs.len() <= MAX_PARLAY_LEGS,
            OnsideError::InvalidLegCount
        );
        require!(
            ctx.remaining_accounts.len() == legs.len(),
            OnsideError::InvalidLegAccounts
        );

        let now = Clock::get()?.unix_timestamp;
        let mut fixture_id: Option<i64> = None;
        for (i, leg) in legs.iter().enumerate() {
            require!(leg.odds_bps >= 10_000, OnsideError::InvalidParlayOdds);
            let market: Account<Market> = Account::try_from(&ctx.remaining_accounts[i])?;
            require!(market.key() == leg.market, OnsideError::InvalidLegAccounts);
            require!(
                market.status == MarketStatus::Open && now < market.close_ts,
                OnsideError::BettingClosed
            );
            if let Some(fixture) = fixture_id {
                require!(market.fixture_id == fixture, OnsideError::MixedFixtures);
            } else {
                fixture_id = Some(market.fixture_id);
            }
            for previous in legs.iter().take(i) {
                require!(previous.market != leg.market, OnsideError::DuplicateLeg);
            }
        }

        let payout = (stake as u128)
            .checked_mul(odds_bps as u128)
            .ok_or(OnsideError::MathOverflow)?
            / 10_000u128;
        require!(payout <= u64::MAX as u128, OnsideError::MathOverflow);

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            stake,
        )?;

        let ticket = &mut ctx.accounts.ticket;
        ticket.vault = ctx.accounts.vault.key();
        ticket.owner = ctx.accounts.owner.key();
        ticket.ticket_id = ticket_id;
        ticket.fixture_id = fixture_id.unwrap();
        ticket.stake = stake;
        ticket.odds_bps = odds_bps;
        ticket.payout = payout as u64;
        ticket.legs = legs;
        ticket.status = ParlayStatus::Open;
        ticket.bump = ctx.bumps.ticket;
        ticket.created_at = now;
        Ok(())
    }

    /// Permissionless settlement after every referenced market has resolved or voided.
    pub fn settle_parlay<'info>(
        ctx: Context<'_, '_, 'info, 'info, SettleParlay<'info>>,
    ) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;
        require!(
            ticket.status == ParlayStatus::Open,
            OnsideError::ParlayAlreadySettled
        );
        require!(
            ctx.remaining_accounts.len() == ticket.legs.len(),
            OnsideError::InvalidLegAccounts
        );

        let mut active_legs = 0usize;
        let mut active_odds_bps: u128 = 10_000;
        for (i, leg) in ticket.legs.iter().enumerate() {
            let market: Account<Market> = Account::try_from(&ctx.remaining_accounts[i])?;
            require!(market.key() == leg.market, OnsideError::InvalidLegAccounts);
            match market.status {
                MarketStatus::Open => return err!(OnsideError::ParlayStillOpen),
                MarketStatus::Void => continue,
                MarketStatus::Resolved => {
                    active_legs += 1;
                    active_odds_bps = active_odds_bps
                        .checked_mul(leg.odds_bps as u128)
                        .ok_or(OnsideError::MathOverflow)?
                        / 10_000u128;
                    let won = matches!(
                        (leg.side, market.outcome),
                        (Side::Yes, Outcome::Yes) | (Side::No, Outcome::No)
                    );
                    if !won {
                        ticket.status = ParlayStatus::Lost;
                        return Ok(());
                    }
                }
            }
        }
        if active_legs == 0 {
            ticket.payout = ticket.stake;
        } else {
            let adjusted = (ticket.stake as u128)
                .checked_mul(active_odds_bps.min(ticket.odds_bps as u128))
                .ok_or(OnsideError::MathOverflow)?
                / 10_000u128;
            require!(adjusted <= u64::MAX as u128, OnsideError::MathOverflow);
            ticket.payout = adjusted as u64;
        }
        ticket.status = ParlayStatus::Won;
        Ok(())
    }

    pub fn claim_parlay(ctx: Context<ClaimParlay>) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;
        require!(
            ticket.status == ParlayStatus::Won,
            OnsideError::ParlayNotWon
        );
        move_program_lamports(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.owner.to_account_info(),
            ticket.payout,
        )?;
        ticket.status = ParlayStatus::Claimed;
        Ok(())
    }
}

fn move_program_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    let rent_min = Rent::get()?.minimum_balance(from.data_len());
    let remaining = from
        .lamports()
        .checked_sub(amount)
        .ok_or(OnsideError::InsufficientPool)?;
    require!(remaining >= rent_min, OnsideError::InsufficientPool);
    **from.try_borrow_mut_lamports()? = remaining;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(OnsideError::MathOverflow)?;
    Ok(())
}

/// Evaluate a market predicate against a (proven) integer value.
fn eval_predicate(pred: &TraderPredicate, value: i64) -> bool {
    let t = pred.threshold as i64;
    match pred.comparison {
        Comparison::GreaterThan => value > t,
        Comparison::LessThan => value < t,
        Comparison::EqualTo => value == t,
    }
}

/* ----------------------------- Accounts ----------------------------- */

#[derive(Accounts)]
#[instruction(params: InitMarketParams)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", authority.key().as_ref(), &params.market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = bettor,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: TxLINE `daily_scores_roots` PDA. Validated on-chain by `validate_stat`
    /// (InvalidPda / RootNotAvailable) and by the owner check in the handler.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
    /// CHECK: must be the txoracle program; constrained by address.
    #[account(address = TXORACLE_PROGRAM_ID)]
    pub tx_oracle_program: UncheckedAccount<'info>,
    pub resolver: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminMarket<'info> {
    #[account(mut, has_one = authority)]
    pub market: Account<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        close = owner,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == owner.key() @ OnsideError::WrongOwner,
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeParlayVault<'info> {
    #[account(init, payer = authority, space = 8 + ParlayVault::INIT_SPACE, seeds = [b"parlay_vault", authority.key().as_ref()], bump)]
    pub vault: Account<'info, ParlayVault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositParlayLiquidity<'info> {
    #[account(mut)]
    pub vault: Account<'info, ParlayVault>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawParlayLiquidity<'info> {
    #[account(mut, has_one = authority)]
    pub vault: Account<'info, ParlayVault>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(ticket_id: u64)]
pub struct PlaceParlay<'info> {
    #[account(mut, has_one = authority)]
    pub vault: Account<'info, ParlayVault>,
    pub authority: Signer<'info>,
    #[account(init, payer = owner, space = 8 + ParlayTicket::INIT_SPACE, seeds = [b"parlay_ticket", owner.key().as_ref(), &ticket_id.to_le_bytes()], bump)]
    pub ticket: Account<'info, ParlayTicket>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleParlay<'info> {
    #[account(mut)]
    pub ticket: Account<'info, ParlayTicket>,
}

#[derive(Accounts)]
pub struct ClaimParlay<'info> {
    #[account(mut, constraint = ticket.owner == owner.key() @ OnsideError::WrongOwner, constraint = ticket.vault == vault.key() @ OnsideError::WrongVault)]
    pub ticket: Account<'info, ParlayTicket>,
    #[account(mut)]
    pub vault: Account<'info, ParlayVault>,
    /// CHECK: constrained to the ticket owner; no signature is required so keepers can pay winners.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,
}

/* ------------------------------ State ------------------------------- */

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub authority: Pubkey,
    pub market_id: u64,
    pub fixture_id: i64,
    pub period: i32,
    pub stat_a_key: u32,
    pub stat_b_key: u32,
    pub op: u8, // 0 = none, 1 = add, 2 = subtract
    pub yes_predicate: TraderPredicate,
    pub close_ts: i64,
    pub settle_after_ts: i64,
    pub total_yes: u64,
    pub total_no: u64,
    pub outcome: Outcome,
    pub status: MarketStatus,
    pub fee_bps: u16,
    pub created_at: i64,
    pub bump: u8,
    #[max_len(MAX_DESCRIPTION_LEN)]
    pub description: String,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub yes_amount: u64,
    pub no_amount: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ParlayVault {
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ParlayTicket {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub ticket_id: u64,
    pub fixture_id: i64,
    pub stake: u64,
    pub odds_bps: u64,
    pub payout: u64,
    #[max_len(MAX_PARLAY_LEGS)]
    pub legs: Vec<ParlayLeg>,
    pub status: ParlayStatus,
    pub bump: u8,
    pub created_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct ParlayLeg {
    pub market: Pubkey,
    pub side: Side,
    pub odds_bps: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ParlayStatus {
    Open,
    Won,
    Lost,
    Claimed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    Unresolved,
    Yes,
    No,
    Void,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Open,
    Resolved,
    Void,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitMarketParams {
    pub market_id: u64,
    pub fixture_id: i64,
    pub period: i32,
    pub stat_a_key: u32,
    pub stat_b_key: u32,
    pub op: u8,
    pub yes_predicate: TraderPredicate,
    pub close_ts: i64,
    pub settle_after_ts: i64,
    pub fee_bps: u16,
    pub description: String,
}

/* ------------- TxLINE `validate_stat` mirror types (CPI) ------------- */
/* Field layouts must match txoracle IDL v1.5.2 byte-for-byte. */

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

/// Argument tuple for `txoracle::validate_stat`, serialized after the discriminator.
#[derive(AnchorSerialize)]
struct ValidateStatArgs {
    ts: i64,
    fixture_summary: ScoresBatchSummary,
    fixture_proof: Vec<ProofNode>,
    main_tree_proof: Vec<ProofNode>,
    predicate: TraderPredicate,
    stat_a: StatTerm,
    stat_b: Option<StatTerm>,
    op: Option<BinaryExpression>,
}

/* ------------------------------ Events ------------------------------ */

#[event]
pub struct MarketInitialized {
    pub market: Pubkey,
    pub fixture_id: i64,
    pub close_ts: i64,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub side: Side,
    pub amount: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub outcome: Outcome,
    pub ts: i64,
}

#[event]
pub struct MarketVoided {
    pub market: Pubkey,
}

#[event]
pub struct MarketClosedEarly {
    pub market: Pubkey,
    pub close_ts: i64,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub payout: u64,
}

/* ------------------------------ Errors ------------------------------ */

#[error_code]
pub enum OnsideError {
    #[msg("Description exceeds maximum length")]
    DescriptionTooLong,
    #[msg("Fee exceeds maximum allowed")]
    FeeTooHigh,
    #[msg("Invalid market schedule (close/settle timestamps)")]
    InvalidSchedule,
    #[msg("Invalid market configuration")]
    InvalidConfig,
    #[msg("Bet amount must be greater than zero")]
    ZeroAmount,
    #[msg("Market is not open")]
    MarketClosed,
    #[msg("Betting window has closed")]
    BettingClosed,
    #[msg("Betting is still open")]
    BettingStillOpen,
    #[msg("Market already resolved or voided")]
    AlreadyResolved,
    #[msg("Settlement proof predates the allowed settlement time")]
    TooEarlyToSettle,
    #[msg("Proof statistic does not match this market")]
    StatMismatch,
    #[msg("Second statistic required but not provided")]
    MissingStatB,
    #[msg("Unexpected second statistic provided")]
    UnexpectedStatB,
    #[msg("Parlay must contain between 2 and 8 legs")]
    InvalidLegCount,
    #[msg("Invalid or incorrectly ordered parlay market accounts")]
    InvalidLegAccounts,
    #[msg("Parlay legs must belong to one fixture")]
    MixedFixtures,
    #[msg("A market can only appear once in a parlay")]
    DuplicateLeg,
    #[msg("Invalid parlay odds")]
    InvalidParlayOdds,
    #[msg("Parlay still has unresolved legs")]
    ParlayStillOpen,
    #[msg("Parlay has already settled")]
    ParlayAlreadySettled,
    #[msg("Parlay is not a winning ticket")]
    ParlayNotWon,
    #[msg("Ticket belongs to another vault")]
    WrongVault,
    #[msg("Scores roots account is not owned by the txoracle program")]
    BadRootsAccount,
    #[msg("Market is not resolved")]
    NotResolved,
    #[msg("Position owner mismatch")]
    WrongOwner,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Insufficient pool balance for payout")]
    InsufficientPool,
}
