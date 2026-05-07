import { describe, it, expect } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.LOCAL_DB_URL;

describe.skipIf(!DB_URL)("RLS — MCP agent tables", () => {
  it("anon role cannot insert into agent_accounts", async () => {
    const sql = postgres(DB_URL!);
    try {
      await sql`SET LOCAL ROLE anon`;
      await expect(
        sql`INSERT INTO agent_accounts (wallet_pubkey, role) VALUES ('test', 'dev')`
      ).rejects.toThrow(/permission denied|policy/i);
    } finally {
      await sql.end();
    }
  });

  it("service role CAN insert into agent_accounts", async () => {
    const sql = postgres(DB_URL!);
    try {
      const [row] = await sql`
        INSERT INTO agent_accounts (wallet_pubkey, role)
        VALUES ('TestPubkey1234567890', 'dev')
        RETURNING id, status
      `;
      expect(row.status).toBe("pending_oauth");
      await sql`DELETE FROM agent_accounts WHERE wallet_pubkey = 'TestPubkey1234567890'`;
    } finally {
      await sql.end();
    }
  });
});
