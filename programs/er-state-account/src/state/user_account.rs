use anchor_lang::prelude::*;

#[account]
pub struct UserAccount {
    pub user: Pubkey, // who owns this
    pub data: u64,    // gets updated by VRF callback or tuktuk cranker
    pub bump: u8,
}

impl Space for UserAccount {
    const INIT_SPACE: usize = 32 + 8 + 1 + 8; // + 8 discriminator
}
