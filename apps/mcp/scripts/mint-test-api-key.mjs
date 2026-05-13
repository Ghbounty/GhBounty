#!/usr/bin/env node
// Mints a test api_key for devnet smoke testing.
// Usage: node apps/mcp/scripts/mint-test-api-key.mjs <wallet_pubkey>
//
// Prints the plaintext key (copy it, you only see it once) and the SQL
// statements to insert the agent_account + api_key into Supabase.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PREFIX = "ghbk_live_";
const SECRET_HEX_LEN = 32;
const PREFIX_HEX_LEN = 12;
const BCRYPT_ROUNDS = 12;

const wallet = process.argv[2];
if (!wallet) {
  console.error("Usage: node mint-test-api-key.mjs <wallet_pubkey>");
  process.exit(1);
}

const secret = randomBytes(SECRET_HEX_LEN / 2).toString("hex");
const plaintext = `${PREFIX}${secret}`;
const prefix = `${PREFIX}${secret.slice(0, PREFIX_HEX_LEN)}`;
const hash = bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);

console.log("=========================================");
console.log("API key plaintext (COPY NOW — shown once):");
console.log("");
console.log("  " + plaintext);
console.log("");
console.log("=========================================");
console.log("");
console.log("SQL to run in Supabase SQL Editor:");
console.log("");
console.log("-- Step 1: create the agent_account");
console.log("INSERT INTO agent_accounts (role, wallet_pubkey, status)");
console.log(`VALUES ('dev', '${wallet}', 'active')`);
console.log("RETURNING id;");
console.log("");
console.log("-- Step 2: paste the id from step 1 into the agent_account_id below");
console.log("INSERT INTO api_keys (agent_account_id, key_hash, key_prefix)");
console.log(`VALUES ('<PASTE_AGENT_ID_HERE>', '${hash}', '${prefix}');`);
console.log("");
console.log("=========================================");
