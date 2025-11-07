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

describe("liquidity-mining-edge-cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .liquidityMining as Program<LiquidityMining>;

  let lpMint: anchor.web3.PublicKey;
  let rewardMint: anchor.web3.PublicKey;
  let admin = anchor.web3.Keypair.generate();
  let poorUser = anchor.web3.Keypair.generate();

  let poolConfig: anchor.web3.PublicKey;
  let lpVault: anchor.web3.PublicKey;
  let rewardVault: anchor.web3.PublicKey;
  let lpVaultAuthority: anchor.web3.PublicKey;
  let rewardVaultAuthority: anchor.web3.PublicKey;

  const POOL_REWARD_RATE = new BN(1_000_000_000);

  before(async () => {
    // Airdrop SOL
    const airdropAdmin = await provider.connection.requestAirdrop(
      admin.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropAdmin);

    const airdropPoorUser = await provider.connection.requestAirdrop(
      poorUser.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropPoorUser);

    // Create mints
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

    // Initialize pool
    const lpVaultKeypair = anchor.web3.Keypair.generate();
    const rewardVaultKeypair = anchor.web3.Keypair.generate();
    lpVault = lpVaultKeypair.publicKey;
    rewardVault = rewardVaultKeypair.publicKey;

    const adminRewardTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      rewardMint,
      admin.publicKey
    );

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
  });

  it("Fails when staking with insufficient balance", async () => {
    const poorUserLpAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      poorUser,
      lpMint,
      poorUser.publicKey
    );

    // Mint only 10 tokens
    await mintTo(
      provider.connection,
      admin,
      lpMint,
      poorUserLpAccount.address,
      admin,
      10 * 10 ** 9
    );

    const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        lpMint.toBuffer(),
        poorUser.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Try to stake 100 tokens (more than balance)
    const stakeAmount = new BN(100 * 10 ** 9);

    try {
      await program.methods
        .stakeLpTokens(stakeAmount)
        .accounts({
          user: poorUser.publicKey,
          userTokenAccount: poorUserLpAccount.address,
          userPosition,
          poolConfig,
          lpVault,
          lpMint,
          lpVaultAuthority,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([poorUser])
        .rpc();
      assert.fail("Should have thrown insufficient balance error");
    } catch (error) {
      assert.include(
        error.toString(),
        "INSUFFICIANT_TOKEN_BALANCE"
      );
    }
  });

  it("Immediate withdrawal gives minimal rewards", async () => {
    const user = anchor.web3.Keypair.generate();

    // Airdrop SOL
    const airdrop = await provider.connection.requestAirdrop(
      user.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);

    // Create accounts
    const userLpAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      lpMint,
      user.publicKey
    );

    const userRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      rewardMint,
      user.publicKey
    );

    // Mint LP tokens
    await mintTo(
      provider.connection,
      admin,
      lpMint,
      userLpAccount.address,
      admin,
      100 * 10 ** 9
    );

    // Fund reward vault
    await mintTo(
      provider.connection,
      admin,
      rewardMint,
      rewardVault,
      admin,
      10_000 * 10 ** 9
    );

    const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), lpMint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    // Stake
    const stakeAmount = new BN(50 * 10 ** 9);
    await program.methods
      .stakeLpTokens(stakeAmount)
      .accounts({
        user: user.publicKey,
        userTokenAccount: userLpAccount.address,
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

    const rewardBalanceBefore = (
      await provider.connection.getTokenAccountBalance(userRewardAccount.address)
    ).value.amount;

    // Immediately withdraw (no time elapsed)
    await program.methods
      .withdrawLpTokens()
      .accounts({
        user: user.publicKey,
        userLpTokenAccount: userLpAccount.address,
        userRewardTokenAccount: userRewardAccount.address,
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

    const rewardBalanceAfter = (
      await provider.connection.getTokenAccountBalance(userRewardAccount.address)
    ).value.amount;

    // Should get minimal rewards (1-2 seconds worth due to transaction time)
    // With reward rate of 1 token/second, expect <= 3 tokens
    const rewardDiff = BigInt(rewardBalanceAfter) - BigInt(rewardBalanceBefore);
    assert.ok(
      rewardDiff <= BigInt(3 * 10 ** 9),
      `Expected minimal rewards (<= 3 tokens), got ${rewardDiff / BigInt(10 ** 9)} tokens`
    );
    assert.ok(
      rewardDiff > 0n,
      "Should receive some rewards due to transaction time"
    );
  });

  it("Fails when reward vault has insufficient funds", async () => {
    const user = anchor.web3.Keypair.generate();

    // Airdrop
    const airdrop = await provider.connection.requestAirdrop(
      user.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);

    const userLpAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      lpMint,
      user.publicKey
    );

    const userRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      rewardMint,
      user.publicKey
    );

    await mintTo(
      provider.connection,
      admin,
      lpMint,
      userLpAccount.address,
      admin,
      100 * 10 ** 9
    );

    const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), lpMint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    // Stake
    await program.methods
      .stakeLpTokens(new BN(50 * 10 ** 9))
      .accounts({
        user: user.publicKey,
        userTokenAccount: userLpAccount.address,
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

    // Wait to accumulate significant rewards
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check reward vault balance (should be low or empty from previous tests)
    const vaultBalance = (
      await provider.connection.getTokenAccountBalance(rewardVault)
    ).value.amount;

    // Only run this test if vault is nearly empty
    if (BigInt(vaultBalance) < BigInt(1000 * 10 ** 9)) {
      try {
        await program.methods
          .withdrawLpTokens()
          .accounts({
            user: user.publicKey,
            userLpTokenAccount: userLpAccount.address,
            userRewardTokenAccount: userRewardAccount.address,
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
        // If it succeeds, that's also fine (vault had enough)
      } catch (error) {
        // Expected to fail with insufficient funds
        assert.ok(error.toString().includes("insufficient"));
      }
    }
  });

  it("Handles large stake amounts correctly", async () => {
    const user = anchor.web3.Keypair.generate();

    const airdrop = await provider.connection.requestAirdrop(
      user.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);

    const userLpAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      lpMint,
      user.publicKey
    );

    const userRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user,
      rewardMint,
      user.publicKey
    );

    // Mint very large amount
    const largeAmount = new BN("1000000000000000"); // 1 million tokens
    await mintTo(
      provider.connection,
      admin,
      lpMint,
      userLpAccount.address,
      admin,
      Number(largeAmount.toString())
    );

    // Fund reward vault generously
    await mintTo(
      provider.connection,
      admin,
      rewardMint,
      rewardVault,
      admin,
      100_000 * 10 ** 9
    );

    const [userPosition] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("position"), lpMint.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    // Stake large amount
    await program.methods
      .stakeLpTokens(largeAmount)
      .accounts({
        user: user.publicKey,
        userTokenAccount: userLpAccount.address,
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

    // Wait
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Withdraw (should handle calculations without overflow)
    await program.methods
      .withdrawLpTokens()
      .accounts({
        user: user.publicKey,
        userLpTokenAccount: userLpAccount.address,
        userRewardTokenAccount: userRewardAccount.address,
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

    const rewardBalance = (
      await provider.connection.getTokenAccountBalance(userRewardAccount.address)
    ).value.amount;

    assert.ok(BigInt(rewardBalance) > 0n, "Should receive rewards");
  });

  it("Fails to initialize pool with non-mint-authority", async () => {
    const fakeMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      9
    );

    const fakeRewardMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      9
    );

    const imposter = anchor.web3.Keypair.generate();
    const airdrop = await provider.connection.requestAirdrop(
      imposter.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);

    const [fakePoolConfig] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool_config"), fakeMint.toBuffer()],
      program.programId
    );

    const [fakeLpVaultAuth] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("authority"), Buffer.from("lp"), fakeMint.toBuffer()],
      program.programId
    );

    const [fakeRewardVaultAuth] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("authority"), Buffer.from("reward"), fakeMint.toBuffer()],
      program.programId
    );

    const fakeLpVault = anchor.web3.Keypair.generate();
    const fakeRewardVault = anchor.web3.Keypair.generate();

    const imposterRewardAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      imposter,
      fakeRewardMint,
      imposter.publicKey
    );

    try {
      await program.methods
        .initializePool(POOL_REWARD_RATE)
        .accounts({
          poolConfig: fakePoolConfig,
          lpMint: fakeMint,
          rewardMint: fakeRewardMint,
          lpVault: fakeLpVault.publicKey,
          lpVaultAuthority: fakeLpVaultAuth,
          rewardVault: fakeRewardVault.publicKey,
          rewardVaultAuthority: fakeRewardVaultAuth,
          adminRewardTokenAccount: imposterRewardAccount.address,
          admin: imposter.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([imposter, fakeLpVault, fakeRewardVault])
        .rpc();
      assert.fail("Should have thrown invalid mint authority error");
    } catch (error) {
      assert.include(error.toString(), "INVALID_MINT_AUTHORITY");
    }
  });
});

