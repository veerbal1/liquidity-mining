import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { LiquidityMining } from "../target/types/liquidity_mining";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("liquidity-mining", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .liquidityMining as Program<LiquidityMining>;

  // Test accounts
  let lpMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let admin = anchor.web3.Keypair.generate();
  let user = anchor.web3.Keypair.generate();

  let poolConfig: anchor.web3.PublicKey;
  let lpVault: anchor.web3.PublicKey;
  let rewardVault: anchor.web3.PublicKey;
  let lpVaultAuthority: anchor.web3.PublicKey;
  let rewardVaultAuthority: anchor.web3.PublicKey;

  let adminRewardTokenAccount: any;
  let userLpTokenAccount: any;
  let userRewardTokenAccount: any;
  let userPosition: anchor.web3.PublicKey;

  const POOL_REWARD_RATE = new BN(1_000_000_000); // 1 token per second (scaled by 1e9)

  before(async () => {
    // Airdrop SOL to admin and user
    const airdropAdmin = await provider.connection.requestAirdrop(
      admin.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropAdmin);

    const airdropUser = await provider.connection.requestAirdrop(
      user.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropUser);

    // Create LP and Reward mints
    lpMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      9
    );

    rewardMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      9
    );

    // Create token accounts
    adminRewardTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      rewardMint,
      admin.publicKey
    );

    userLpTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      lpMint,
      user.publicKey
    );

    userRewardTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      rewardMint,
      user.publicKey
    );

    // Mint tokens
    await mintTo(
      provider.connection,
      admin,
      lpMint,
      userLpTokenAccount.address,
      admin,
      1000 * 10 ** 9 // 1000 LP tokens
    );

    await mintTo(
      provider.connection,
      admin,
      rewardMint,
      adminRewardTokenAccount.address,
      admin,
      10_000 * 10 ** 9 // 10,000 reward tokens
    );

    // Derive PDAs
    [poolConfig] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_config"), lpMint.toBuffer()],
      program.programId
    );

    [lpVaultAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("authority"), Buffer.from("lp"), lpMint.toBuffer()],
      program.programId
    );

    [rewardVaultAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("authority"), Buffer.from("reward"), lpMint.toBuffer()],
      program.programId
    );

    [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        lpMint.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );
  });

  it("Initializes the liquidity pool", async () => {
    const lpVaultKeypair = anchor.web3.Keypair.generate();
    const rewardVaultKeypair = anchor.web3.Keypair.generate();

    lpVault = lpVaultKeypair.publicKey;
    rewardVault = rewardVaultKeypair.publicKey;

    await program.methods
      .initializePool(POOL_REWARD_RATE)
      .accounts({
        poolConfig,
        lpMint,
        rewardMint,
        lpVault,
        lpVaultAuthority,
        rewardVault,
        rewardVaultAuthority,
        adminRewardTokenAccount: adminRewardTokenAccount.address,
        admin: admin.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin, lpVaultKeypair, rewardVaultKeypair])
      .rpc();

    // Verify pool config
    const poolConfigAccount = await program.account.poolConfig.fetch(
      poolConfig
    );
    assert.equal(
      poolConfigAccount.admin.toString(),
      admin.publicKey.toString()
    );
    assert.equal(
      poolConfigAccount.lpTokenMint.toString(),
      lpMint.toString()
    );
    assert.equal(
      poolConfigAccount.rewardTokenMint.toString(),
      rewardMint.toString()
    );
    assert.equal(poolConfigAccount.totalStaked.toNumber(), 0);
    assert.equal(poolConfigAccount.rewardsDistributed.toNumber(), 0);
    assert.equal(
      poolConfigAccount.poolRewardRate.toString(),
      POOL_REWARD_RATE.toString()
    );
  });

  it("Stakes LP tokens", async () => {
    const stakeAmount = new BN(100 * 10 ** 9); // 100 LP tokens

    await program.methods
      .stakeLpTokens(stakeAmount)
      .accounts({
        user: user.publicKey,
        userTokenAccount: userLpTokenAccount.address,
        userPosition,
        poolConfig,
        lpVault,
        lpMint,
        lpVaultAuthority,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify user position
    const userPositionAccount =
      await program.account.userStakePosition.fetch(userPosition);
    assert.equal(
      userPositionAccount.amountStaked.toString(),
      stakeAmount.toString()
    );
    assert.ok(userPositionAccount.stakedAt.toNumber() > 0);
    assert.ok(userPositionAccount.lastClaimed.toNumber() > 0);

    // Verify pool config updated
    const poolConfigAccount = await program.account.poolConfig.fetch(
      poolConfig
    );
    assert.equal(
      poolConfigAccount.totalStaked.toString(),
      stakeAmount.toString()
    );
  });

  it("Cannot stake when already has active position", async () => {
    const stakeAmount = new BN(50 * 10 ** 9);

    try {
      await program.methods
        .stakeLpTokens(stakeAmount)
        .accounts({
          user: user.publicKey,
          userTokenAccount: userLpTokenAccount.address,
          userPosition,
          poolConfig,
          lpVault,
          lpMint,
          lpVaultAuthority,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (error) {
      assert.include(error.toString(), "ALREADY_ACTIVE_POSITION");
    }
  });

  it("Withdraws LP tokens and claims rewards", async () => {
    // Wait a few seconds to accumulate rewards
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const userLpBalanceBefore = (
      await provider.connection.getTokenAccountBalance(
        userLpTokenAccount.address
      )
    ).value.amount;
    const userRewardBalanceBefore = (
      await provider.connection.getTokenAccountBalance(
        userRewardTokenAccount.address
      )
    ).value.amount;

    // Transfer some reward tokens to the reward vault first
    await mintTo(
      provider.connection,
      admin,
      rewardMint,
      rewardVault,
      admin,
      10_000 * 10 ** 9
    );

    await program.methods
      .withdrawLpTokens()
      .accounts({
        user: user.publicKey,
        userLpTokenAccount: userLpTokenAccount.address,
        userRewardTokenAccount: userRewardTokenAccount.address,
        userPosition,
        poolConfig,
        lpVault,
        rewardVault,
        lpMint,
        rewardMint,
        lpVaultAuthority,
        rewardVaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify LP tokens returned
    const userLpBalanceAfter = (
      await provider.connection.getTokenAccountBalance(
        userLpTokenAccount.address
      )
    ).value.amount;
    assert.ok(
      BigInt(userLpBalanceAfter) > BigInt(userLpBalanceBefore),
      "LP tokens should be returned"
    );

    // Verify rewards received
    const userRewardBalanceAfter = (
      await provider.connection.getTokenAccountBalance(
        userRewardTokenAccount.address
      )
    ).value.amount;
    assert.ok(
      BigInt(userRewardBalanceAfter) > BigInt(userRewardBalanceBefore),
      "Rewards should be claimed"
    );

    // Verify user position reset
    const userPositionAccount =
      await program.account.userStakePosition.fetch(userPosition);
    assert.equal(userPositionAccount.amountStaked.toNumber(), 0);

    // Verify pool config updated
    const poolConfigAccount = await program.account.poolConfig.fetch(
      poolConfig
    );
    assert.equal(poolConfigAccount.totalStaked.toNumber(), 0);
    assert.ok(poolConfigAccount.rewardsDistributed.toNumber() > 0);
  });

  it("Cannot withdraw when no active position", async () => {
    try {
      await program.methods
        .withdrawLpTokens()
        .accounts({
          user: user.publicKey,
          userLpTokenAccount: userLpTokenAccount.address,
          userRewardTokenAccount: userRewardTokenAccount.address,
          userPosition,
          poolConfig,
          lpVault,
          rewardVault,
          lpMint,
          rewardMint,
          lpVaultAuthority,
          rewardVaultAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (error) {
      assert.include(error.toString(), "NO_ACTIVE_POSITION");
    }
  });

  it("Multiple users can stake and withdraw", async () => {
    const user2 = anchor.web3.Keypair.generate();

    // Airdrop SOL
    const airdrop = await provider.connection.requestAirdrop(
      user2.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);

    // Create token accounts for user2
    const user2LpTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user2,
      lpMint,
      user2.publicKey
    );

    const user2RewardTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user2,
      rewardMint,
      user2.publicKey
    );

    // Mint LP tokens to user2
    await mintTo(
      provider.connection,
      admin,
      lpMint,
      user2LpTokenAccount.address,
      admin,
      500 * 10 ** 9
    );

    // User2 stakes
    const [user2Position] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        lpMint.toBuffer(),
        user2.publicKey.toBuffer(),
      ],
      program.programId
    );

    const stakeAmount = new BN(200 * 10 ** 9);
    await program.methods
      .stakeLpTokens(stakeAmount)
      .accounts({
        user: user2.publicKey,
        userTokenAccount: user2LpTokenAccount.address,
        userPosition: user2Position,
        poolConfig,
        lpVault,
        lpMint,
        lpVaultAuthority,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    // Verify pool has user2's stake
    const poolConfigAccount = await program.account.poolConfig.fetch(
      poolConfig
    );
    assert.equal(
      poolConfigAccount.totalStaked.toString(),
      stakeAmount.toString()
    );

    // Wait and withdraw
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await program.methods
      .withdrawLpTokens()
      .accounts({
        user: user2.publicKey,
        userLpTokenAccount: user2LpTokenAccount.address,
        userRewardTokenAccount: user2RewardTokenAccount.address,
        userPosition: user2Position,
        poolConfig,
        lpVault,
        rewardVault,
        lpMint,
        rewardMint,
        lpVaultAuthority,
        rewardVaultAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    // Verify user2 received rewards
    const user2RewardBalance = (
      await provider.connection.getTokenAccountBalance(
        user2RewardTokenAccount.address
      )
    ).value.amount;
    assert.ok(
      BigInt(user2RewardBalance) > 0n,
      "User2 should receive rewards"
    );
  });
});
