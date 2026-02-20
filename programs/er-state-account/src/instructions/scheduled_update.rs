// cranker calls this -- NO signer needed, thats the whole point
// tuktuk crankers are random bots, they cant sign as the user
// PDA seeds use the stored pubkey (user_account.user) instead of a signer to verify

use anchor_lang::prelude::*;
use crate::state::UserAccount;

#[derive(Accounts)]
pub struct ScheduledUpdate<'info> {
    // uses stored user pubkey for PDA check, not a signer
    #[account(
        mut,
        seeds = [b"user", user_account.user.as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
}

impl<'info> ScheduledUpdate<'info> {
    pub fn scheduled_update(&mut self) -> Result<()> {
        self.user_account.data += 1;
        msg!(
            "TukTuk cranker updated data to: {}",
            self.user_account.data
        );
        Ok(())
    }
}
