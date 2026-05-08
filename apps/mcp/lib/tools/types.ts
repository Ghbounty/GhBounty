// Shared types for tool handlers.

export interface AgentAccount {
  id: string;
  role: "dev" | "company";
  status: "pending_oauth" | "pending_stake" | "active" | "suspended" | "revoked";
  wallet_pubkey: string;
  github_handle: string | null;
}

export type AuthResult =
  | { ok: true; agent: AgentAccount; apiKeyId: string }
  | { ok: false; error: { code: "Unauthorized" | "Forbidden"; message: string } };
