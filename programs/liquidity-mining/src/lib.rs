use anchor_lang::prelude::*;

declare_id!("6AA73D9hmpkQdrXdWZRFQoUJa7gN13N85EcBptqy8K3V");

#[program]
pub mod liquidity_mining {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
