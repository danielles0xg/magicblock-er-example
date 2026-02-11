import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { ErStateAccount } from "../target/types/er_state_account";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("er-state-account", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/",
      },
    ),
    anchor.Wallet.local(),
  );
  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );
  console.log(`Current SOL Public Key: ${anchor.Wallet.local().publicKey}`);

  before(async function () {
    const balance = await provider.connection.getBalance(
      anchor.Wallet.local().publicKey,
    );
    console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
  });

  const program = anchor.workspace.erStateAccount as Program<ErStateAccount>;

  // ER-connected program instance for sending txs through the Ephemeral Rollup
  const ephemeralProgram = new Program<ErStateAccount>(
    program.idl as ErStateAccount,
    providerEphemeralRollup,
  );

  const userAccount = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), anchor.Wallet.local().publicKey.toBuffer()],
    program.programId,
  )[0];

  it("Is initialized!", async () => {
    try {
      const tx = await program.methods
        .initialize()
        .accountsPartial({
          user: anchor.Wallet.local().publicKey,
          userAccount: userAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log("User Account initialized: ", tx);
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        console.log("User Account already exists, skipping init");
      } else {
        throw e;
      }
    }
  });

  it("Update State!", async () => {
    try {
      const tx = await program.methods
        .update(new anchor.BN(42))
        .accountsPartial({
          user: anchor.Wallet.local().publicKey,
          userAccount: userAccount,
        })
        .rpc();
      console.log("\nUser Account State Updated: ", tx);
    } catch (e: any) {
      if (e.message?.includes("AccountOwnedByWrongProgram")) {
        console.log("\nUser Account is delegated, skipping base-layer update");
      } else {
        throw e;
      }
    }
  });

  it("Delegate to Ephemeral Rollup!", async () => {
    // Check if already delegated
    const baseInfo = await provider.connection.getAccountInfo(userAccount);
    if (
      baseInfo &&
      baseInfo.owner.toBase58() === "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
    ) {
      console.log("\nUser Account already delegated, skipping");
      return;
    }

    const tx = await program.methods
      .delegate()
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        validator: new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd"),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true });

    console.log("\nUser Account Delegated to Ephemeral Rollup: ", tx);

    // Wait for ER to pick up the delegation
    console.log("Waiting for ER to process delegation (~10s)...");
    await sleep(10000);
  });

  it("Update State with VRF and Commit to Base Layer!", async () => {
    // Wait for ER to be ready
    console.log("Waiting for ER to be ready (~5s)...");
    await sleep(5000);

    // Build the tx using program (for IDL resolution of all VRF accounts)
    // All VRF accounts (oracleQueue, programIdentity, vrfProgram, slotHashes)
    // are auto-resolved by Anchor from the IDL address constraints
    let tx = await program.methods
      .updateCommit(new anchor.BN(43))
      .accountsPartial({
        user: providerEphemeralRollup.wallet.publicKey,
        userAccount: userAccount,
      })
      .transaction();

    // Sign and send through the ER provider
    tx.feePayer = providerEphemeralRollup.wallet.publicKey;
    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });

    console.log("\nVRF Request + Commit sent: ", txHash);

    // Wait for the VRF oracle to process the request and call back
    console.log("Waiting for VRF oracle callback (~10s)...");
    await sleep(10000);

    // Fetch account to check if callback updated the data with randomness
    try {
      const account = await ephemeralProgram.account.userAccount.fetch(
        userAccount,
        "processed",
      );
      console.log(
        "User account data after VRF callback: ",
        account.data.toString(),
      );
    } catch {
      console.log("Could not fetch from ER (account may have been committed)");
      try {
        const account = await program.account.userAccount.fetch(
          userAccount,
          "processed",
        );
        console.log(
          "User account data (base layer): ",
          account.data.toString(),
        );
      } catch {
        console.log("Account not yet available on base layer either");
      }
    }
  });

  it("Commit and undelegate from Ephemeral Rollup!", async () => {
    const info = await providerEphemeralRollup.connection.getAccountInfo(
      userAccount,
    );

    console.log("User Account Info: ", info);
    console.log("User account", userAccount.toBase58());

    let tx = await program.methods
      .undelegate()
      .accounts({
        user: providerEphemeralRollup.wallet.publicKey,
      })
      .transaction();

    tx.feePayer = providerEphemeralRollup.wallet.publicKey;

    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: true,
    });

    console.log("\nUser Account Undelegated: ", txHash);

    // Wait for base layer to process the undelegation
    console.log("Waiting for base layer to finalize (~10s)...");
    await sleep(10000);
  });

  it("Update State!", async () => {
    const tx = await program.methods
      .update(new anchor.BN(45))
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
      })
      .rpc();

    console.log("\nUser Account State Updated: ", tx);
  });

  it("Close Account!", async () => {
    const tx = await program.methods
      .close()
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("\nUser Account Closed: ", tx);
  });
});
