// hands off the account to magicblock ER
// #[delegate] macro adds the delegation CPI helpers
// `del` on user_account marks it as delegatable

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::state::UserAccount;

#[delegate]
#[derive(Accounts)]
pub struct Delegate<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        del, // marks this account for delegation
        seeds = [b"user", user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    /// CHECK: ER validator node address
    pub validator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> Delegate<'info> {
    pub fn delegate(&mut self) -> Result<()> {
        let pda_seeds: &[&[u8]] = &[
            b"user",
            self.user.key.as_ref(),
        ];

        self.delegate_user_account(
            &self.user,
            pda_seeds,
            DelegateConfig {
                validator: Some(self.validator.key()),
                ..DelegateConfig::default()
            }
        )?;

        Ok(())
    }
}
