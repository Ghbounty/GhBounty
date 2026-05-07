use anchor_lang::prelude::*;

#[constant]
pub const BOUNTY_SEED: &[u8] = b"bounty";

#[constant]
pub const SUBMISSION_SEED: &[u8] = b"submission";

pub const MAX_URL_LEN: usize = 200;
pub const MIN_SCORE: u8 = 1;
pub const MAX_SCORE: u8 = 10;

#[constant]
pub const STAKE_DEPOSIT_SEED: &[u8] = b"stake_deposit";

/// Hardcoded authority for slash + refund. Generated keypair lives in
/// `contracts/solana/keys/stake-authority-dev.json` for dev. For mainnet,
/// rotate alongside GAS_STATION (see GHB-179).
pub const STAKE_AUTHORITY_PUBKEY: Pubkey = pubkey!("4qXQzpZ95nVHoMSZXQtNYjwVD4vkJffHLm1928GRTEq2");

/// 0.035 SOL ≈ $3 at SOL ≈ $86.72 (May 2026). Hardcoded; redeploy to change.
pub const MIN_STAKE_LAMPORTS: u64 = 35_000_000;

/// 14-day refund lock.
pub const STAKE_LOCK_SECONDS: i64 = 14 * 24 * 60 * 60;
