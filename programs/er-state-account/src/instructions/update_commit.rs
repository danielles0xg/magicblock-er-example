use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

use crate::state::UserAccount;

#[commit]
#[vrf]
#[derive(Accounts)]
pub struct UpdateCommit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    /// CHECK: The oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

impl<'info> UpdateCommit<'info> {
    pub fn update_commit(&mut self, new_data: u64) -> Result<()> {
        // Convert u64 to [u8; 32] for caller_seed
        let mut caller_seed = [0u8; 32];
        caller_seed[..8].copy_from_slice(&new_data.to_le_bytes());

        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: self.user.key(),
            oracle_queue: self.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: crate::instruction::CallbackUpdateCommit::DISCRIMINATOR.to_vec(),
            caller_seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: self.user_account.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });

        self.invoke_signed_vrf(&self.user.to_account_info(), &ix)?;

        // Commit the account back to base layer
        commit_accounts(
            &self.user.to_account_info(),
            vec![&self.user_account.to_account_info()],
            &self.magic_context,
            &self.magic_program,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CallbackUpdateCommit<'info> {
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
}

impl<'info> CallbackUpdateCommit<'info> {
    pub fn callback_update_commit(&mut self, randomness: [u8; 32]) -> Result<()> {
        let random_value = ephemeral_vrf_sdk::rnd::random_u64(&randomness);
        msg!("Consuming random number: {:?}", random_value);
        self.user_account.data = random_value;
        Ok(())
    }
}
