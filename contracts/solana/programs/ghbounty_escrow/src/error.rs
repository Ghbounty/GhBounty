use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Bounty amount must be greater than zero")]
    ZeroAmount,
    #[msg("URL exceeds maximum length")]
    UrlTooLong,
    #[msg("Bounty is not in the Open state")]
    BountyNotOpen,
    #[msg("Only the bounty creator can perform this action")]
    UnauthorizedCreator,
    #[msg("Submission does not belong to this bounty")]
    SubmissionMismatch,
    #[msg("Score must be between 1 and 10")]
    ScoreOutOfRange,
    #[msg("Score has already been set on this submission")]
    ScoreAlreadySet,
    #[msg("Only the designated scorer can set scores on this bounty")]
    UnauthorizedScorer,
    #[msg("Lamport arithmetic overflow")]
    LamportOverflow,
    #[msg("Stake amount below minimum")]
    StakeTooSmall,
    #[msg("Slash amount exceeds remaining stake")]
    SlashExceedsStake,
    #[msg("Stake is still within lock period")]
    StakeStillLocked,
    #[msg("Stake is not in the Active state")]
    StakeNotActive,
    #[msg("Caller is not the configured stake authority")]
    UnauthorizedStakeAuthority,
}
