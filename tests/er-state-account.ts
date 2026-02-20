import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { ErStateAccount } from "../target/types/er_state_account";
// TukTuk SDK imports for scheduling tasks
import {
  init as initTuktuk,
  taskKey,
  taskQueueAuthorityKey,
} from "@helium/tuktuk-sdk";
import { assert } from "chai";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/// US (devnet-us.magicblock.app): MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd

describe("er-state-account", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);


  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-us.magicblock.app/",
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
        validator: new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd"), // US TESTNET VALIDATOR
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

  // ==========================================================================
  // TUKTUK SCHEDULING TEST
  // ==========================================================================
  //
  // This test demonstrates the on-chain scheduling flow:
  //
  // 1. Initialize the user account (if not already done - handled above)
  // 2. Call `schedule()` to queue a `scheduled_update` task on TukTuk
  // 3. Verify the task was submitted (tx succeeds)
  //
  // NOTE: The actual execution by a cranker happens asynchronously.
  // On devnet, crankers may take a few seconds to pick up and execute
  // the task. To verify execution, check the account data after waiting.
  //
  // PREREQUISITES:
  // - A TukTuk task queue must exist (created via TukTuk CLI)
  // - Your wallet's queue_authority PDA must be registered on the queue
  //   (done via `addQueueAuthorityV0` in the cron.ts script)
  // ==========================================================================
  it("Schedule a TukTuk task to update state!", async () => {
    // The TukTuk task queue address.
    // This queue must already exist on devnet (created with TukTuk CLI).
    // Replace with your own queue address if different.
    const taskQueue = new PublicKey(
      "CMreFdKxT5oeZhiX8nWTGz9PtXM1AMYTh6dGR2UzdtrA",
    );

    // Initialize the TukTuk SDK to get the program interface
    const tuktukProgram = await initTuktuk(provider);

    // Derive our program's queue_authority PDA.
    // Seeds: ["queue_authority"] - same as in the Rust schedule.rs.
    // This PDA is our program's "identity" when interacting with TukTuk.
    const queueAuthority = PublicKey.findProgramAddressSync(
      [Buffer.from("queue_authority")],
      program.programId,
    )[0];

    // Derive the task queue authority PDA from TukTuk's perspective.
    // This verifies our program's queue_authority is registered on the queue.
    const taskQueueAuthority = taskQueueAuthorityKey(
      taskQueue,
      queueAuthority,
    )[0];

    // Unique task ID (u16). Each task in a queue must have a unique ID.
    // Increment this for each new task you schedule.
    const taskID = 1;

    // Derive the task account PDA where TukTuk will store the task.
    // Seeds: [task_queue, task_id] - derived by TukTuk internally.
    const task = taskKey(taskQueue, taskID)[0];

    console.log("\n--- TukTuk Scheduling Test ---");
    console.log("Task Queue:", taskQueue.toBase58());
    console.log("Queue Authority PDA:", queueAuthority.toBase58());
    console.log("Task Queue Authority:", taskQueueAuthority.toBase58());
    console.log("Task Account:", task.toBase58());
    console.log("Task ID:", taskID);

    // Submit the schedule instruction.
    // This makes a CPI from our program to TukTuk to queue the task.
    const tx = await program.methods
      .schedule(taskID)
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        taskQueue: taskQueue,
        taskQueueAuthority: taskQueueAuthority,
        task: task,
        queueAuthority: queueAuthority,
        systemProgram: anchor.web3.SystemProgram.programId,
        tuktukProgram: tuktukProgram.programId,
      })
      .rpc({ skipPreflight: true });

    console.log("\nTask scheduled on TukTuk! Tx:", tx);

    // Verify the TukTuk program ID is correct
    assert(
      tuktukProgram.programId.equals(
        new PublicKey("tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA"),
      ),
      "TukTuk program ID should match",
    );

    console.log(
      "\nThe cranker will now pick up and execute the scheduled_update instruction.",
    );
    console.log(
      "After execution, user_account.data will be incremented by 1.",
    );
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
