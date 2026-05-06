use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use ghbounty_escrow::state::{StakeDeposit, StakeStatus};
use ghbounty_escrow::constants::{MIN_STAKE_LAMPORTS, STAKE_DEPOSIT_SEED};
use litesvm::LiteSVM;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::{v0, VersionedMessage};
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_system_interface::program::ID as SYSTEM_PROGRAM_ID;
use solana_transaction::versioned::VersionedTransaction;

const PROGRAM_ID: Pubkey = ghbounty_escrow::ID;
const PROGRAM_SO: &[u8] = include_bytes!("../../../target/deploy/ghbounty_escrow.so");

fn setup() -> LiteSVM {
    let mut svm = LiteSVM::new();
    svm.add_program(PROGRAM_ID, PROGRAM_SO).unwrap();
    svm
}

fn funded(svm: &mut LiteSVM, lamports: u64) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), lamports).unwrap();
    kp
}

fn stake_pda(owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[STAKE_DEPOSIT_SEED, owner.as_ref()],
        &PROGRAM_ID,
    )
}

fn init_stake_ix(owner: &Pubkey, amount: u64) -> Instruction {
    let (pda, _bump) = stake_pda(owner);
    let accounts = ghbounty_escrow::accounts::InitStakeDeposit {
        owner: *owner,
        stake: pda,
        system_program: SYSTEM_PROGRAM_ID,
    }
    .to_account_metas(None);
    let data = ghbounty_escrow::instruction::InitStakeDeposit { amount }.data();
    Instruction { program_id: PROGRAM_ID, accounts, data }
}

fn send(svm: &mut LiteSVM, payer: &Keypair, ix: Instruction)
    -> Result<(), litesvm::types::FailedTransactionMetadata>
{
    let blockhash = svm.latest_blockhash();
    let msg = v0::Message::try_compile(&payer.pubkey(), &[ix], &[], blockhash).unwrap();
    let tx = VersionedTransaction::try_new(VersionedMessage::V0(msg), &[payer]).unwrap();
    svm.send_transaction(tx).map(|_| ())
}

#[test]
fn init_stake_deposit_happy_path() {
    let mut svm = setup();
    let owner = funded(&mut svm, 1_000_000_000); // 1 SOL

    send(&mut svm, &owner, init_stake_ix(&owner.pubkey(), MIN_STAKE_LAMPORTS))
        .expect("init_stake_deposit should succeed");

    let (pda, _) = stake_pda(&owner.pubkey());
    let acct = svm.get_account(&pda).expect("stake PDA should exist");
    let stake = StakeDeposit::try_deserialize(&mut acct.data.as_slice()).unwrap();

    assert_eq!(stake.owner, owner.pubkey());
    assert_eq!(stake.amount, MIN_STAKE_LAMPORTS);
    assert_eq!(stake.status, StakeStatus::Active);
    assert!(stake.locked_until > 0);
}

#[test]
fn init_stake_deposit_rejects_below_minimum() {
    let mut svm = setup();
    let owner = funded(&mut svm, 1_000_000_000);

    let too_small = MIN_STAKE_LAMPORTS - 1;
    let err = send(&mut svm, &owner, init_stake_ix(&owner.pubkey(), too_small))
        .expect_err("should reject below minimum");
    let logs = err.meta.logs.join("\n");
    assert!(
        logs.contains("StakeTooSmall"),
        "expected StakeTooSmall in logs, got:\n{}",
        logs
    );
}
