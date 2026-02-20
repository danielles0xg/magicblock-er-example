#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

mod state;
mod instructions;

use instructions::*;

declare_id!("3QUFRXjCC79kypTQ99pk6RqhWdQEctGhHaLHtw474NB4");

// #[ephemeral] gives us ER delegation/commit magic from magicblock sdk
#[ephemeral]
#[program]
pub mod er_state_account {

    use super::*;

    // base layer stuff
    pub fn initialize(ctx: Context<InitUser>) -> Result<()> {
        ctx.accounts.initialize(&ctx.bumps)?;
        Ok(())
    }

    pub fn update(ctx: Context<UpdateUser>, new_data: u64) -> Result<()> {
        ctx.accounts.update(new_data)?;
        Ok(())
    }

    // VRF flow -- runs inside the ER, requests randomness then commits back
    pub fn update_commit(ctx: Context<UpdateCommit>, new_data: u64) -> Result<()> {
        ctx.accounts.update_commit(new_data)?;
        Ok(())
    }

    // oracle calls this back w/ the random bytes
    pub fn callback_update_commit(ctx: Context<CallbackUpdateCommit>, randomness: [u8; 32]) -> Result<()> {
        ctx.accounts.callback_update_commit(randomness)?;
        Ok(())
    }

    // ER delegation -- hand off account to magicblock rollup
    pub fn delegate(ctx: Context<Delegate>) -> Result<()> {
        ctx.accounts.delegate()?;
        Ok(())
    }

    // push state back to base layer and take account back
    pub fn undelegate(ctx: Context<Undelegate>) -> Result<()> {
        ctx.accounts.undelegate()?;
        Ok(())
    }

    pub fn close(ctx: Context<CloseUser>) -> Result<()> {
        ctx.accounts.close()?;
        Ok(())
    }

    // tuktuk stuff -- cranker calls this, no signer needed
    pub fn scheduled_update(ctx: Context<ScheduledUpdate>) -> Result<()> {
        ctx.accounts.scheduled_update()?;
        Ok(())
    }

    // user calls this to queue a task on tuktuk
    pub fn schedule(ctx: Context<Schedule>, task_id: u16) -> Result<()> {
        ctx.accounts.schedule(task_id, ctx.bumps)?;
        Ok(())
    }
}
