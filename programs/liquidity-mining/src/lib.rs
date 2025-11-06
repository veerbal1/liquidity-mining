use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

declare_id!("6AA73D9hmpkQdrXdWZRFQoUJa7gN13N85EcBptqy8K3V");

#[program]
pub mod liquidity_mining {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct UserStakePosition {
    pub amount_staked: u64,
    pub staked_at: i64,
    pub last_claimed: i64,
    pub is_closed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PoolConfig {
    pub admin: Pubkey,
    pub total_staked: u64,
    pub rewards_distributed: u64,
    pub lp_token_mint: Pubkey,
    pub bump: u8,
}

impl PoolConfig {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

// Instruction's Accounts
#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(init, seeds=[b"pool_config", lp_mint.key().as_ref()], bump, payer = admin, space = PoolConfig::LEN)]
    pub pool_config: Account<'info, PoolConfig>,

    pub lp_mint: Account<'info, Mint>,
    pub reward_mint: Account<'info, Mint>,

    #[account(init, token::mint = lp_mint, token::authority = lp_vault_authority, payer = admin)]
    pub lp_vault: Account<'info, TokenAccount>,
    /// CHECKED LP Vault Authority
    #[account(seeds=[b"authority", b"lp", lp_mint.key().as_ref()], bump)]
    pub lp_vault_authority: UncheckedAccount<'info>,


    #[account(init, token::mint = reward_mint, token::authority = reward_vault_authority, payer = admin)]
    pub reward_vault: Account<'info, TokenAccount>,
    /// CHECKED LP Vault Authority
    #[account(seeds=[b"authority", b"reward", lp_mint.key().as_ref()], bump)]
    pub reward_vault_authority: UncheckedAccount<'info>,

    #[account(token::mint = reward_mint, token::authority = admin)]
    pub admin_reward_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
