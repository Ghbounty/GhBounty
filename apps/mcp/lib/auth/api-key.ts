// API key generation + verification. Format: `ghbk_live_<32 hex chars>`.
//
// Storage:
// - Plaintext is shown to the agent ONCE (response of create_account.complete).
// - bcrypt hash + first 12 chars (prefix) are stored in api_keys table.
// - Lookup is by prefix (indexed); bcrypt verifies on match.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PREFIX = "ghbk_live_";
const SECRET_HEX_LEN = 32; // 16 bytes → 32 hex chars
const PREFIX_HEX_LEN = 12; // first 12 chars of the hex part used as table lookup index
const BCRYPT_ROUNDS = 12;

export interface MintedKey {
  /** Full plaintext key. Show to the agent ONCE; never store. */
  plaintext: string;
  /** First 12 hex chars (prefixed). Indexed in DB for O(1) lookup. */
  prefix: string;
  /** bcrypt hash. Store this in `api_keys.key_hash`. */
  hash: string;
}

export function mintApiKey(): MintedKey {
  const secret = randomBytes(SECRET_HEX_LEN / 2).toString("hex");
  const plaintext = `${PREFIX}${secret}`;
  const prefix = `${PREFIX}${secret.slice(0, PREFIX_HEX_LEN)}`;
  const hash = bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);
  return { plaintext, prefix, hash };
}

export function extractPrefix(plaintext: string): string {
  if (!plaintext.startsWith(PREFIX)) {
    throw new Error("Invalid API key format");
  }
  return plaintext.slice(0, PREFIX.length + PREFIX_HEX_LEN);
}

export function verifyApiKey(plaintext: string, hash: string): boolean {
  return bcrypt.compareSync(plaintext, hash);
}
