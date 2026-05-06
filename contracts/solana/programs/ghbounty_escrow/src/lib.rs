pub mod constants;
pub mod error;
pub mod state;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

use crate::constants::{
    BOUNTY_SEED, MAX_SCORE, MAX_URL_LEN, MIN_SCORE, MIN_STAKE_LAMPORTS, STAKE_AUTHORITY_PUBKEY,
    STAKE_DEPOSIT_SEED, STAKE_LOCK_SECONDS, SUBMISSION_SEED,
};
use crate::error::EscrowError;
use crate::state::{Bounty, BountyState, StakeDeposit, StakeStatus, Submission, SubmissionState};

declare_id!("CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg");

#[program]
pub mod ghbounty_escrow {
    use super::*;

    pub fn create_bounty(
        ctx: Context<CreateBounty>,
        bounty_id: u64,
        amount: u64,
        scorer: Pubkey,
        github_issue_url: String,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(
            github_issue_url.len() <= MAX_URL_LEN,
            EscrowError::UrlTooLong
        );

        let ix = system_instruction::transfer(
            &ctx.accounts.creator.key(),
            &ctx.accounts.bounty.key(),
            amount,
        );
        invoke(
            &ix,
            &[
                ctx.accounts.creator.to_account_info(),
                ctx.accounts.bounty.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let bounty = &mut ctx.accounts.bounty;
        bounty.creator = ctx.accounts.creator.key();
        bounty.scorer = scorer;
        bounty.bounty_id = bounty_id;
        bounty.mint = Pubkey::default();
        bounty.amount = amount;
        bounty.state = BountyState::Open;
        bounty.submission_count = 0;
        bounty.winner = None;
        bounty.github_issue_url = github_issue_url;
        bounty.created_at = Clock::get()?.unix_timestamp;
        bounty.bump = ctx.bumps.bounty;

        Ok(())
    }

    pub fn submit_solution(
        ctx: Context<SubmitSolution>,
        pr_url: String,
        opus_report_hash: [u8; 32],
    ) -> Result<()> {
        require!(pr_url.len() <= MAX_URL_LEN, EscrowError::UrlTooLong);

        let bounty = &mut ctx.accounts.bounty;
        let submission = &mut ctx.accounts.submission;

        submission.bounty = bounty.key();
        submission.solver = ctx.accounts.solver.key();
        submission.submission_index = bounty.submission_count;
        submission.pr_url = pr_url;
        submission.opus_report_hash = opus_report_hash;
        submission.score = None;
        submission.state = SubmissionState::Pending;
        submission.created_at = Clock::get()?.unix_timestamp;
        submission.bump = ctx.bumps.submission;

        bounty.submission_count = bounty
            .submission_count
            .checked_add(1)
            .expect("submission_count overflow");

        Ok(())
    }

    pub fn resolve_bounty(ctx: Context<ResolveBounty>) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        let submission = &mut ctx.accounts.winning_submission;
        let winner = &ctx.accounts.winner;

        require_keys_eq!(
            winner.key(),
            submission.solver,
            EscrowError::SubmissionMismatch
        );

        transfer_lamports(
            &bounty.to_account_info(),
            &winner.to_account_info(),
            bounty.amount,
        )?;

        bounty.state = BountyState::Resolved;
        bounty.winner = Some(submission.solver);
        submission.state = SubmissionState::Winner;

        Ok(())
    }

    pub fn cancel_bounty(ctx: Context<CancelBounty>) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        let creator = &ctx.accounts.creator;

        transfer_lamports(
            &bounty.to_account_info(),
            &creator.to_account_info(),
            bounty.amount,
        )?;

        bounty.state = BountyState::Cancelled;

        Ok(())
    }

    pub fn set_score(ctx: Context<SetScore>, score: u8) -> Result<()> {
        require!(
            (MIN_SCORE..=MAX_SCORE).contains(&score),
            EscrowError::ScoreOutOfRange
        );
        let submission = &mut ctx.accounts.submission;
        require!(submission.score.is_none(), EscrowError::ScoreAlreadySet);

        submission.score = Some(score);
        submission.state = SubmissionState::Scored;

        Ok(())
    }

    pub fn init_stake_deposit(
        ctx: Context<InitStakeDeposit>,
        amount: u64,
    ) -> Result<()> {
        require!(amount >= MIN_STAKE_LAMPORTS, EscrowError::StakeTooSmall);

        let stake = &mut ctx.accounts.stake;
        stake.owner = ctx.accounts.owner.key();
        stake.amount = amount;
        stake.status = StakeStatus::Active;
        stake.created_at = Clock::get()?.unix_timestamp;
        stake.locked_until = stake.created_at + STAKE_LOCK_SECONDS;
        stake.bump = ctx.bumps.stake;

        // Transfer lamports from owner to the stake PDA.
        invoke(
            &system_instruction::transfer(
                &ctx.accounts.owner.key(),
                &stake.key(),
                amount,
            ),
            &[
                ctx.accounts.owner.to_account_info(),
                stake.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        Ok(())
    }

    pub fn slash_stake_deposit(
        ctx: Context<SlashStakeDeposit>,
        amount: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            STAKE_AUTHORITY_PUBKEY,
            EscrowError::UnauthorizedStakeAuthority
        );

        let stake = &mut ctx.accounts.stake;
        require!(
            matches!(stake.status, StakeStatus::Active | StakeStatus::Frozen),
            EscrowError::StakeNotActive
        );
        require!(amount <= stake.amount, EscrowError::SlashExceedsStake);

        // Transfer lamports out of the PDA. PDAs can be debited directly
        // (no CPI to system program) by mutating their lamport balance.
        let stake_info = stake.to_account_info();
        let treasury_info = ctx.accounts.treasury.to_account_info();
        **stake_info.try_borrow_mut_lamports()? = stake_info
            .lamports()
            .checked_sub(amount)
            .ok_or(EscrowError::LamportOverflow)?;
        **treasury_info.try_borrow_mut_lamports()? = treasury_info
            .lamports()
            .checked_add(amount)
            .ok_or(EscrowError::LamportOverflow)?;

        stake.amount = stake.amount.checked_sub(amount).unwrap();
        if stake.amount == 0 {
            stake.status = StakeStatus::Slashed;
        }

        Ok(())
    }
}

fn transfer_lamports(
    from: &AccountInfo,
    to: &AccountInfo,
    amount: u64,
) -> Result<()> {
    let from_balance = from.lamports();
    let to_balance = to.lamports();
    **from.try_borrow_mut_lamports()? = from_balance
        .checked_sub(amount)
        .ok_or(EscrowError::LamportOverflow)?;
    **to.try_borrow_mut_lamports()? = to_balance
        .checked_add(amount)
        .ok_or(EscrowError::LamportOverflow)?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(bounty_id: u64)]
pub struct CreateBounty<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Bounty::INIT_SPACE,
        seeds = [BOUNTY_SEED, creator.key().as_ref(), &bounty_id.to_le_bytes()],
        bump,
    )]
    pub bounty: Account<'info, Bounty>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitSolution<'info> {
    #[account(mut)]
    pub solver: Signer<'info>,

    #[account(
        mut,
        constraint = bounty.state == BountyState::Open @ EscrowError::BountyNotOpen,
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(
        init,
        payer = solver,
        space = 8 + Submission::INIT_SPACE,
        seeds = [
            SUBMISSION_SEED,
            bounty.key().as_ref(),
            &bounty.submission_count.to_le_bytes(),
        ],
        bump,
    )]
    pub submission: Account<'info, Submission>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveBounty<'info> {
    #[account(
        constraint = creator.key() == bounty.creator @ EscrowError::UnauthorizedCreator,
    )]
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = bounty.state == BountyState::Open @ EscrowError::BountyNotOpen,
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(
        mut,
        constraint = winning_submission.bounty == bounty.key() @ EscrowError::SubmissionMismatch,
    )]
    pub winning_submission: Account<'info, Submission>,

    /// CHECK: validated against submission.solver in handler.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelBounty<'info> {
    #[account(
        mut,
        constraint = creator.key() == bounty.creator @ EscrowError::UnauthorizedCreator,
    )]
    pub creator: Signer<'info>,

    #[account(
        mut,
        constraint = bounty.state == BountyState::Open @ EscrowError::BountyNotOpen,
    )]
    pub bounty: Account<'info, Bounty>,
}

#[derive(Accounts)]
pub struct SetScore<'info> {
    #[account(
        constraint = scorer.key() == bounty.scorer @ EscrowError::UnauthorizedScorer,
    )]
    pub scorer: Signer<'info>,

    #[account(
        constraint = bounty.state == BountyState::Open @ EscrowError::BountyNotOpen,
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(
        mut,
        constraint = submission.bounty == bounty.key() @ EscrowError::SubmissionMismatch,
    )]
    pub submission: Account<'info, Submission>,
}

#[derive(Accounts)]
pub struct InitStakeDeposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + StakeDeposit::INIT_SPACE,
        seeds = [STAKE_DEPOSIT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub stake: Account<'info, StakeDeposit>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashStakeDeposit<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STAKE_DEPOSIT_SEED, stake.owner.as_ref()],
        bump = stake.bump,
    )]
    pub stake: Account<'info, StakeDeposit>,

    /// CHECK: lamports destination for slashed funds. Constrained off-chain
    /// (the relayer always uses the GhBounty slash treasury account).
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
}
