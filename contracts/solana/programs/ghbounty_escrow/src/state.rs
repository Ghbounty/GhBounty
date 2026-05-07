use anchor_lang::prelude::*;

use crate::constants::MAX_URL_LEN;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum BountyState {
    Open,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum SubmissionState {
    Pending,
    Scored,
    Winner,
}

#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub creator: Pubkey,
    pub scorer: Pubkey,
    pub bounty_id: u64,
    pub mint: Pubkey,
    pub amount: u64,
    pub state: BountyState,
    pub submission_count: u32,
    pub winner: Option<Pubkey>,
    #[max_len(MAX_URL_LEN)]
    pub github_issue_url: String,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Submission {
    pub bounty: Pubkey,
    pub solver: Pubkey,
    pub submission_index: u32,
    #[max_len(MAX_URL_LEN)]
    pub pr_url: String,
    pub opus_report_hash: [u8; 32],
    pub score: Option<u8>,
    pub state: SubmissionState,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum StakeStatus {
    Active,
    Frozen,
    Slashed,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct StakeDeposit {
    /// Owner / depositor wallet — refund destination.
    pub owner: Pubkey,
    /// Lamports currently held in the PDA (decremented on partial slash).
    pub amount: u64,
    pub status: StakeStatus,
    /// Unix seconds at which `refund_stake_deposit` becomes valid.
    pub locked_until: i64,
    /// Unix seconds when the deposit was created.
    pub created_at: i64,
    pub bump: u8,
}
