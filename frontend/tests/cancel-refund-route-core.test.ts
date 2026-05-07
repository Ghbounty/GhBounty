import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  generateKeyPair,
  SignJWT,
  type FlattenedJWSInput,
  type JWSHeaderParameters,
  type JWTVerifyGetKey,
  type ResolvedKey,
} from "jose";
import { Connection, Keypair } from "@solana/web3.js";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  handleCancelRefundRequest,
  PRIVY_ISSUER,
  type CancelRefundDeps,
  type CancelRefundLogEntry,
} from "@/lib/cancel-refund-route-core";
import type { Database } from "@/lib/db.types";

/**
 * Mirrors the gas-station route tests' approach: ephemeral ES256 keypair
 * for Privy JWTs, in-memory fakes for Supabase + Solana connection.
 *
 * Coverage matrix:
 *   - 200 happy refund (lamports computed + audit row inserted)
 *   - 200 idempotent (existing audit row → returns prior tx)
 *   - 200 nothing-to-refund (cap fully used, or legacy bounty)
 *   - 400 bad body
 *   - 401 missing/invalid token
 *   - 403 caller is not the bounty creator
 *   - 404 bounty not found (already deleted)
 */

const PRIVY_APP_ID = "cm_test_refund_app";
const FIXED_NOW_S = Math.floor(Date.now() / 1000);

interface TestKeys {
  privateKey: CryptoKey;
  resolver: JWTVerifyGetKey;
}

async function makeKeys(): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const resolver: JWTVerifyGetKey = async (
    _h: JWSHeaderParameters,
    _i: FlattenedJWSInput,
  ): Promise<ResolvedKey["key"]> =>
    publicKey as unknown as ResolvedKey["key"];
  return { privateKey, resolver };
}

async function signToken(opts: {
  privateKey: CryptoKey;
  sub?: string;
}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "kid" })
    .setIssuer(PRIVY_ISSUER)
    .setSubject(opts.sub ?? "did:privy:owner")
    .setAudience(PRIVY_APP_ID)
    .setIssuedAt(FIXED_NOW_S)
    .setExpirationTime(FIXED_NOW_S + 600)
    .sign(opts.privateKey);
}

interface FakeRoutes {
  treasury_refunds_existing?: { tx_hash: string; lamports: string } | null;
  treasury_refunds_insertError?: { message: string } | null;
  issues?: {
    id: string;
    creator: string;
    review_eligible_count: number | null;
  } | null;
  bounty_meta?: {
    max_submissions: number | null;
    review_fee_lamports_per_review: string | null;
    created_by_user_id: string | null;
  } | null;
}

interface InsertCall {
  table: string;
  row: unknown;
}

function makeFakeSupabase(routes: FakeRoutes): {
  client: SupabaseClient<Database>;
  inserts: InsertCall[];
} {
  const inserts: InsertCall[] = [];
  const client = {
    from: (table: string) => {
      // Build a chainable thenable that ignores intermediate filter
      // calls and resolves on `.maybeSingle()` / `.insert()`.
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.select = passthrough;
      chain.eq = passthrough;
      chain.not = passthrough;
      chain.maybeSingle = async () => {
        switch (table) {
          case "treasury_refunds":
            return { data: routes.treasury_refunds_existing ?? null, error: null };
          case "issues":
            return { data: routes.issues ?? null, error: null };
          case "bounty_meta":
            return { data: routes.bounty_meta ?? null, error: null };
        }
        return { data: null, error: null };
      };
      chain.insert = async (row: unknown) => {
        inserts.push({ table, row });
        if (table === "treasury_refunds" && routes.treasury_refunds_insertError) {
          return { error: routes.treasury_refunds_insertError };
        }
        return { error: null };
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, inserts };
}

function makeFakeConnection(opts?: {
  signature?: string;
  confirmErr?: unknown;
  sendThrows?: Error;
}): Connection {
  const signature = opts?.signature ?? "fake-sig-" + Math.random().toString(36).slice(2, 10);
  return {
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: "FwRYtTPRk5N4wUeP87rTw9kQVSwigB6kbikGzzeCMrW5",
      lastValidBlockHeight: 1000,
    })),
    sendRawTransaction: vi.fn(async () => {
      if (opts?.sendThrows) throw opts.sendThrows;
      return signature;
    }),
    confirmTransaction: vi.fn(async () => ({
      value: { err: opts?.confirmErr ?? null },
    })),
  } as unknown as Connection;
}

interface OverrideOpts {
  resolver: JWTVerifyGetKey;
  routes?: FakeRoutes;
  connection?: Connection;
  treasuryKeypair?: Keypair;
}

function makeDeps(o: OverrideOpts): {
  deps: CancelRefundDeps;
  logs: CancelRefundLogEntry[];
  inserts: InsertCall[];
  connection: Connection;
} {
  const logs: CancelRefundLogEntry[] = [];
  const { client, inserts } = makeFakeSupabase(o.routes ?? {});
  const connection = o.connection ?? makeFakeConnection();
  const deps: CancelRefundDeps = {
    privyAppId: PRIVY_APP_ID,
    verifyKey: o.resolver,
    supabase: client,
    treasuryKeypair: o.treasuryKeypair ?? Keypair.generate(),
    connection,
    log: (e) => logs.push(e),
  };
  return { deps, logs, inserts, connection };
}

const VALID_PDA = "FwRYtTPRk5N4wUeP87rTw9kQVSwigB6kbikGzzeCMrW5";

let keys: TestKeys;

beforeEach(async () => {
  keys = await makeKeys();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 200 happy path ────────────────────────────────────────────────────

describe("handleCancelRefundRequest — happy path", () => {
  test("computes (cap-used) × per_review and returns tx hash", async () => {
    const owner = "did:privy:owner_xyz";
    const creator = Keypair.generate().publicKey.toBase58();
    const token = await signToken({ privateKey: keys.privateKey, sub: owner });
    const { deps, logs, inserts, connection } = makeDeps({
      resolver: keys.resolver,
      connection: makeFakeConnection({ signature: "refund-sig-1" }),
      routes: {
        treasury_refunds_existing: null,
        issues: { id: "issue-1", creator, review_eligible_count: 3 },
        bounty_meta: {
          max_submissions: 10,
          // 1_000_000 lamports per review
          review_fee_lamports_per_review: "1000000",
          created_by_user_id: owner,
        },
      },
    });

    const r = await handleCancelRefundRequest(
      {
        authorization: `Bearer ${token}`,
        body: { bountyPda: VALID_PDA },
      },
      deps,
    );

    expect(r.status).toBe(200);
    // (10 - 3) × 1_000_000 = 7_000_000 lamports
    expect(r.body.refundLamports).toBe(7_000_000);
    expect(r.body.refundTxHash).toBe("refund-sig-1");
    expect(connection.sendRawTransaction).toHaveBeenCalledOnce();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.table).toBe("treasury_refunds");
    const row = inserts[0]!.row as Record<string, unknown>;
    expect(row.bounty_pda).toBe(VALID_PDA);
    expect(row.kind).toBe("cancel_refund");
    expect(row.lamports).toBe("7000000");
    expect(row.recipient_pubkey).toBe(creator);
    expect(row.tx_hash).toBe("refund-sig-1");
    expect(logs[0]?.outcome).toBe("ok_refunded");
  });
});

// ── 200 idempotent ────────────────────────────────────────────────────

describe("handleCancelRefundRequest — idempotency", () => {
  test("existing audit row → returns prior tx hash, no transfer fired", async () => {
    const token = await signToken({ privateKey: keys.privateKey });
    const { deps, logs, inserts, connection } = makeDeps({
      resolver: keys.resolver,
      routes: {
        treasury_refunds_existing: {
          tx_hash: "prior-refund-sig",
          lamports: "5000000",
        },
      },
    });

    const r = await handleCancelRefundRequest(
      { authorization: `Bearer ${token}`, body: { bountyPda: VALID_PDA } },
      deps,
    );

    expect(r.status).toBe(200);
    expect(r.body.refundTxHash).toBe("prior-refund-sig");
    expect(r.body.refundLamports).toBe(5_000_000);
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(logs[0]?.outcome).toBe("ok_already_refunded");
  });
});

// ── 200 nothing-to-refund ─────────────────────────────────────────────

describe("handleCancelRefundRequest — nothing to refund", () => {
  test("cap fully used → 200 with refundLamports=0, no transfer", async () => {
    const owner = "did:privy:owner";
    const token = await signToken({ privateKey: keys.privateKey, sub: owner });
    const { deps, logs, connection } = makeDeps({
      resolver: keys.resolver,
      routes: {
        issues: {
          id: "i",
          creator: Keypair.generate().publicKey.toBase58(),
          review_eligible_count: 10,
        },
        bounty_meta: {
          max_submissions: 10,
          review_fee_lamports_per_review: "1000000",
          created_by_user_id: owner,
        },
      },
    });

    const r = await handleCancelRefundRequest(
      { authorization: `Bearer ${token}`, body: { bountyPda: VALID_PDA } },
      deps,
    );

    expect(r.status).toBe(200);
    expect(r.body.refundLamports).toBe(0);
    expect(r.body.refundTxHash).toBeNull();
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
    expect(logs[0]?.outcome).toBe("ok_nothing_to_refund");
  });

  test("legacy bounty (no fee on file) → 200 with refundLamports=0", async () => {
    const owner = "did:privy:legacy";
    const token = await signToken({ privateKey: keys.privateKey, sub: owner });
    const { deps, logs, connection } = makeDeps({
      resolver: keys.resolver,
      routes: {
        issues: {
          id: "i",
          creator: Keypair.generate().publicKey.toBase58(),
          review_eligible_count: 0,
        },
        bounty_meta: {
          max_submissions: null, // no cap → no fee
          review_fee_lamports_per_review: null,
          created_by_user_id: owner,
        },
      },
    });

    const r = await handleCancelRefundRequest(
      { authorization: `Bearer ${token}`, body: { bountyPda: VALID_PDA } },
      deps,
    );

    expect(r.status).toBe(200);
    expect(r.body.refundLamports).toBe(0);
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
    expect(logs[0]?.outcome).toBe("ok_nothing_to_refund");
  });
});

// ── 400 bad body ──────────────────────────────────────────────────────

describe("handleCancelRefundRequest — bad body", () => {
  test("missing bountyPda → 400", async () => {
    const token = await signToken({ privateKey: keys.privateKey });
    const { deps } = makeDeps({ resolver: keys.resolver });
    const r = await handleCancelRefundRequest(
      { authorization: `Bearer ${token}`, body: {} },
      deps,
    );
    expect(r.status).toBe(400);
  });

  test("invalid base58 pubkey → 400", async () => {
    const token = await signToken({ privateKey: keys.privateKey });
    const { deps } = makeDeps({ resolver: keys.resolver });
    const r = await handleCancelRefundRequest(
      {
        authorization: `Bearer ${token}`,
        body: { bountyPda: "0x1234" },
      },
      deps,
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("base58");
  });
});

// ── 401 auth ──────────────────────────────────────────────────────────

describe("handleCancelRefundRequest — auth failures", () => {
  test("missing Authorization header → 401", async () => {
    const { deps } = makeDeps({ resolver: keys.resolver });
    const r = await handleCancelRefundRequest(
      { authorization: null, body: { bountyPda: VALID_PDA } },
      deps,
    );
    expect(r.status).toBe(401);
  });

  test("garbage token → 401", async () => {
    const { deps } = makeDeps({ resolver: keys.resolver });
    const r = await handleCancelRefundRequest(
      {
        authorization: "Bearer not-a-jwt",
        body: { bountyPda: VALID_PDA },
      },
      deps,
    );
    expect(r.status).toBe(401);
  });
});

// ── 403 not owner ─────────────────────────────────────────────────────

describe("handleCancelRefundRequest — wrong owner", () => {
  test("caller's DID doesn't match bounty creator → 403", async () => {
    const token = await signToken({
      privateKey: keys.privateKey,
      sub: "did:privy:imposter",
    });
    const { deps, logs, connection } = makeDeps({
      resolver: keys.resolver,
      routes: {
        issues: {
          id: "i",
          creator: Keypair.generate().publicKey.toBase58(),
          review_eligible_count: 0,
        },
        bounty_meta: {
          max_submissions: 10,
          review_fee_lamports_per_review: "1000000",
          created_by_user_id: "did:privy:real_owner",
        },
      },
    });

    const r = await handleCancelRefundRequest(
      { authorization: `Bearer ${token}`, body: { bountyPda: VALID_PDA } },
      deps,
    );

    expect(r.status).toBe(403);
    expect(connection.sendRawTransaction).not.toHaveBeenCalled();
    expect(logs[0]?.outcome).toBe("not_owner");
  });
});

// ── 404 not found ─────────────────────────────────────────────────────

describe("handleCancelRefundRequest — bounty not found", () => {
  test("issues lookup returns null → 404", async () => {
    const token = await signToken({ privateKey: keys.privateKey });
    const { deps } = makeDeps({
      resolver: keys.resolver,
      routes: { issues: null },
    });
    const r = await handleCancelRefundRequest(
      { authorization: `Bearer ${token}`, body: { bountyPda: VALID_PDA } },
      deps,
    );
    expect(r.status).toBe(404);
  });

  test("bounty_meta missing for issue → 404", async () => {
    const token = await signToken({ privateKey: keys.privateKey });
    const { deps } = makeDeps({
      resolver: keys.resolver,
      routes: {
        issues: {
          id: "i",
          creator: Keypair.generate().publicKey.toBase58(),
          review_eligible_count: 0,
        },
        bounty_meta: null,
      },
    });
    const r = await handleCancelRefundRequest(
      { authorization: `Bearer ${token}`, body: { bountyPda: VALID_PDA } },
      deps,
    );
    expect(r.status).toBe(404);
  });
});
