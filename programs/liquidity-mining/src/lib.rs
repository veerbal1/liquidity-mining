use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[error_code]
pub enum ErrorCode {
    #[msg("Only Liquidity Token Mint Authority can create token pool config.")]
    INVALID_MINT_AUTHORITY,

    #[msg("Insufficient balance")]
    INSUFFICIANT_TOKEN_BALANCE,

    #[msg("Position Already Active")]
    ALREADY_ACTIVE_POSITION
}

declare_id!("6AA73D9hmpkQdrXdWZRFQoUJa7gN13N85EcBptqy8K3V");

#[program]
pub mod liquidity_mining {
    use anchor_spl::token::{self, Transfer};

    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        let lp_token_mint = &ctx.accounts.lp_mint;
        let lp_token_mint_authority = lp_token_mint.mint_authority;
        let caller = COption::Some(ctx.accounts.admin.key());

        require!(
            lp_token_mint_authority == caller,
            ErrorCode::INVALID_MINT_AUTHORITY
        );

        let config_account = &mut ctx.accounts.pool_config;
        config_account.admin = ctx.accounts.admin.key();
        config_account.lp_token_mint = ctx.accounts.lp_mint.key();
        config_account.reward_token_mint = ctx.accounts.reward_mint.key();

        config_account.total_staked = 0;
        config_account.rewards_distributed = 0;

        config_account.bump = ctx.bumps.pool_config;
        config_account.lp_token_authority_bump = ctx.bumps.lp_vault_authority;
        config_account.reward_token_authority_bump = ctx.bumps.reward_vault_authority;

        Ok(())
    }

    pub fn stake_lp_tokens(ctx: Context<Stake_LP_Tokens>, amount: u64) -> Result<()> {
        let user_token_account = &ctx.accounts.user_token_account;
        let user_position = &mut ctx.accounts.user_position;

        require!(user_position.amount_staked == 0, ErrorCode::ALREADY_ACTIVE_POSITION);

        require!(
            user_token_account.amount >= amount,
            ErrorCode::INSUFFICIANT_TOKEN_BALANCE
        );

        let ctx_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.lp_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        let ctx_token_program = ctx.accounts.token_program.to_account_info();

        let cpi_ctx = CpiContext::new(ctx_token_program, ctx_accounts);

        token::transfer(cpi_ctx, amount)?;

        let current_time = Clock::get()?.unix_timestamp;

        user_position.staked_at = current_time;
        user_position.last_claimed = current_time;

        user_position.amount_staked = amount;
        user_position.bump = ctx.bumps.user_position;

        let pool_config = &mut ctx.accounts.pool_config;
        pool_config.total_staked += amount;

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct UserStakePosition {
    pub amount_staked: u64,
    pub staked_at: i64,
    pub last_claimed: i64,
    pub bump: u8,
}

impl UserStakePosition {
    pub const LEN: usize = 8 + Self::INIT_SPACE;
}

#[account]
#[derive(InitSpace)]
pub struct PoolConfig {
    pub admin: Pubkey,
    pub total_staked: u64,
    pub rewards_distributed: u64,
    pub lp_token_mint: Pubkey,
    pub reward_token_mint: Pubkey,

    pub bump: u8,
    pub lp_token_authority_bump: u8,
    pub reward_token_authority_bump: u8,
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

#[derive(Accounts)]
pub struct Stake_LP_Tokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut, token::mint = pool_config.lp_token_mint, token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(init_if_needed, seeds=[b"position", pool_config.lp_token_mint.as_ref(), user.key().as_ref()], bump, payer = user, space = UserStakePosition::LEN)]
    pub user_position: Account<'info, UserStakePosition>,

    #[account(mut, seeds=[b"pool_config", lp_mint.key().as_ref()], bump = pool_config.bump)]
    pub pool_config: Account<'info, PoolConfig>,

    #[account(mut, token::mint = pool_config.lp_token_mint, token::authority = lp_vault_authority)]
    pub lp_vault: Account<'info, TokenAccount>,
    pub lp_mint: Account<'info, Mint>,
    /// CHECKED LP Vault Authority
    #[account(seeds=[b"authority", b"lp", pool_config.lp_token_mint.as_ref()], bump = pool_config.lp_token_authority_bump)]
    pub lp_vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}
