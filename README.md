
# Task 4 - Accelerated Builders

Challenge: implement VRF in example repo to update the user state data
task 1: implement outside the ER
task 2: implement inside the ER

## Test

1. Initialize a user account PDA, update its data on base layer, then delegate it to MagicBlock's Ephemeral Rollup
2. Inside the ER, request VRF randomness via `update_commit` -- the oracle calls back with a random u64 written to `user_account.data`, then commits back to base layer
3. Undelegate the account back to base layer and confirm normal updates work again
-  Schedule a `scheduled_update` task on TukTuk a cranker picks it up and increments `data` by 1 with no signer required

## challenge 

- took time to understand I had to update to US validator address to get faster response