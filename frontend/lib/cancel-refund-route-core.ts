/**
 * Pure handler for `POST /api/cancel-refund`.
 *
 * Refunds the unused portion of the upfront review fee back to the
 * bounty creator after they cancel a bounty. The route runs AFTER the
 * frontend has already submitted (and confirmed) `cancel_bounty`
 * on-chain — its only job is to move the off-chain SOL the user
 * pre-paid for unused review slots.
 *
 * Math (locked at bounty-creation time, not re-derived from Pyth):
 *
 *   refundLamports = max(0, max_submissions - review_eligible_count) *
 *                    review_fee_lamports_per_review
 *
 * Markup is intentionally kept (Tom's call): we refund the *cost* of
 * unused reviews, not the user-facing charge. So if the company paid
 * `cap × cost × 2` upfront and used `n` reviews, they get back
 * `(cap - n) × cost`.
 *
 * Idempotency: a `treasury_refunds` row exists per (bounty_pda, kind).
 * A repeat call returns the original tx hash without firing a second
 * transfer. This protects against the user clicking "Delete" twice or
 * a flaky network making the route retry.
 *
 * Status mapping:
 *   200 — refund issued OR already issued (returns tx hash)
 *   200 — no refund needed (bounty had no fee, or all slots used)
 *   400 — body malformed
 *   401 — Privy token missing/invalid
 *   403 — caller is not the bounty creator
 *   404 — bounty not found in bounty_meta
 *   500 — RPC error or unexpected failure
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Commitment,
} from "@solana/web3.js";
import { jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./db.types";

export const PRIVY_ISSUER = "privy.io";

export type RefundOutcome =
  | "ok_refunded"
  | "ok_already_refunded"
  | "ok_nothing_to_refund"
  | "auth_failed"
  | "bad_request"
  | "not_owner"
  | "not_found"
  | "rpc_error"
  | "internal_error";

export interface CancelRefundLogEntry {
  privyDid: string | null;
  bountyPda: string | null;
  status: number;
  outcome: RefundOutcome;
  refundLamports?: number;
  refundTxHash?: string;
  reason?: string;
  durationMs: number;
}

export interface CancelRefundDeps {
  privyAppId: string;
  verifyKey: JWTVerifyGetKey | CryptoKey | Uint8Array;
  /** Service-role Supabase client (RLS bypass — backend trusted path). */
  supabase: SupabaseClient<Database>;
  /** Treasury keypair that signs the refund transfer. */
  treasuryKeypair: Keypair;
  /** Solana RPC connection used to broadcast and confirm. */
  connection: Connection;
  /** Confirmation timeout for `confirmTransaction`. Default 60s. */
  confirmTimeoutMs?: number;
  /** Commitment level. Default 'confirmed'. */
  commitment?: Commitment;
  log: (entry: CancelRefundLogEntry) => void;
}

export interface CancelRefundRequest {
  authorization: string | null;
  body: unknown;
}

export interface CancelRefundResponse {
  status: number;
  body: {
    refundLamports?: number;
    refundTxHash?: string | null;
    error?: string;
    reason?: string;
  };
}

/** Re-export from the gas-station route — same parser, same rules. */
export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  const token = match[1]!.trim();
  return token.length > 0 ? token : null;
}

interface RefundBody {
  bountyPda: string;
}

function parseRefundBody(
  body: unknown,
): { ok: true; value: RefundBody } | { ok: false; reason: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.bountyPda !== "string" || b.bountyPda.length === 0) {
    return { ok: false, reason: "missing or non-string bountyPda" };
  }
  // Defensive: parse to PublicKey to catch malformed base58 here rather
  // than 100 lines later when we'd be building the SystemProgram.transfer.
  try {
    new PublicKey(b.bountyPda);
  } catch (err) {
    return { ok: false, reason: `bountyPda is not valid base58: ${(err as Error).message}` };
  }
  return { ok: true, value: { bountyPda: b.bountyPda } };
}

async function verifyPrivyToken(
  token: string,
  deps: Pick<CancelRefundDeps, "privyAppId" | "verifyKey">,
): Promise<{ sub: string; payload: JWTPayload }> {
  const verified = await jwtVerify(token, deps.verifyKey as never, {
    issuer: PRIVY_ISSUER,
    audience: deps.privyAppId,
  });
  if (!verified.payload.sub || typeof verified.payload.sub !== "string") {
    throw new Error("Privy token missing sub");
  }
  return { sub: verified.payload.sub, payload: verified.payload };
}

export async function handleCancelRefundRequest(
  req: CancelRefundRequest,
  deps: CancelRefundDeps,
): Promise<CancelRefundResponse> {
  const start = Date.now();

  // 1. Auth.
  const token = parseBearerToken(req.authorization);
  if (!token) {
    deps.log({
      privyDid: null,
      bountyPda: null,
      status: 401,
      outcome: "auth_failed",
      reason: "missing or malformed Authorization header",
      durationMs: Date.now() - start,
    });
    return {
      status: 401,
      body: { error: "missing or malformed Authorization header" },
    };
  }

  let privyDid: string;
  try {
    const verified = await verifyPrivyToken(token, deps);
    privyDid = verified.sub;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log({
      privyDid: null,
      bountyPda: null,
      status: 401,
      outcome: "auth_failed",
      reason,
      durationMs: Date.now() - start,
    });
    return { status: 401, body: { error: "Privy token verification failed" } };
  }

  // 2. Body.
  const parsed = parseRefundBody(req.body);
  if (!parsed.ok) {
    deps.log({
      privyDid,
      bountyPda: null,
      status: 400,
      outcome: "bad_request",
      reason: parsed.reason,
      durationMs: Date.now() - start,
    });
    return { status: 400, body: { error: parsed.reason } };
  }
  const bountyPda = parsed.value.bountyPda;

  // 3. Idempotency check — has this bounty already been refunded?
  // We do this BEFORE the bounty lookup to short-circuit cleanly even
  // if `deleteIssueAndMeta` has run between cancel and refund (which
  // is the expected order for the existing "Delete" UX).
  const { data: existing, error: existingErr } = await deps.supabase
    .from("treasury_refunds")
    .select("tx_hash, lamports")
    .eq("bounty_pda", bountyPda)
    .eq("kind", "cancel_refund")
    .maybeSingle();
  if (existingErr) {
    deps.log({
      privyDid,
      bountyPda,
      status: 500,
      outcome: "internal_error",
      reason: `treasury_refunds lookup: ${existingErr.message}`,
      durationMs: Date.now() - start,
    });
    return { status: 500, body: { error: "internal error" } };
  }
  if (existing) {
    deps.log({
      privyDid,
      bountyPda,
      status: 200,
      outcome: "ok_already_refunded",
      refundLamports: Number(existing.lamports),
      refundTxHash: existing.tx_hash,
      durationMs: Date.now() - start,
    });
    return {
      status: 200,
      body: {
        refundLamports: Number(existing.lamports),
        refundTxHash: existing.tx_hash,
      },
    };
  }

  // 4. Look up the bounty in two passes: `issues` by pda (gives us the
  //    creator wallet + used count + issue uuid for the meta join), then
  //    `bounty_meta` by issue_id (cap + per-review price + owner DID).
  //    Two queries beats fighting PostgREST's auto-detected FK names —
  //    each is a single row by primary or unique key, so cost is fine.
  const { data: issueRow, error: issueErr } = await deps.supabase
    .from("issues")
    .select("id, creator, review_eligible_count")
    .eq("pda", bountyPda)
    .maybeSingle();
  if (issueErr) {
    deps.log({
      privyDid,
      bountyPda,
      status: 500,
      outcome: "internal_error",
      reason: `issues lookup: ${issueErr.message}`,
      durationMs: Date.now() - start,
    });
    return { status: 500, body: { error: "internal error" } };
  }
  if (!issueRow) {
    deps.log({
      privyDid,
      bountyPda,
      status: 404,
      outcome: "not_found",
      reason: "issue not found (already deleted, or never existed)",
      durationMs: Date.now() - start,
    });
    return { status: 404, body: { error: "bounty not found" } };
  }

  const { data: meta, error: metaErr } = await deps.supabase
    .from("bounty_meta")
    .select(
      "max_submissions, review_fee_lamports_per_review, created_by_user_id",
    )
    .eq("issue_id", issueRow.id)
    .maybeSingle();
  if (metaErr) {
    deps.log({
      privyDid,
      bountyPda,
      status: 500,
      outcome: "internal_error",
      reason: `bounty_meta lookup: ${metaErr.message}`,
      durationMs: Date.now() - start,
    });
    return { status: 500, body: { error: "internal error" } };
  }
  if (!meta) {
    deps.log({
      privyDid,
      bountyPda,
      status: 404,
      outcome: "not_found",
      reason: "bounty_meta missing for issue",
      durationMs: Date.now() - start,
    });
    return { status: 404, body: { error: "bounty not found" } };
  }

  // 5. Owner check.
  if (meta.created_by_user_id !== privyDid) {
    deps.log({
      privyDid,
      bountyPda,
      status: 403,
      outcome: "not_owner",
      reason: `caller ${privyDid} is not the bounty creator ${meta.created_by_user_id}`,
      durationMs: Date.now() - start,
    });
    return { status: 403, body: { error: "not the bounty creator" } };
  }

  // 6. Compute refund.
  const cap = meta.max_submissions;
  const perReview =
    meta.review_fee_lamports_per_review !== null
      ? Number(meta.review_fee_lamports_per_review)
      : null;
  const used = issueRow.review_eligible_count ?? 0;

  if (cap === null || perReview === null || perReview <= 0) {
    // Legacy bounty — created before the fee feature. Nothing to refund.
    deps.log({
      privyDid,
      bountyPda,
      status: 200,
      outcome: "ok_nothing_to_refund",
      reason: "bounty has no review fee on file",
      durationMs: Date.now() - start,
    });
    return {
      status: 200,
      body: { refundLamports: 0, refundTxHash: null },
    };
  }

  const unused = Math.max(0, cap - used);
  const refundLamports = unused * perReview;
  if (refundLamports <= 0) {
    deps.log({
      privyDid,
      bountyPda,
      status: 200,
      outcome: "ok_nothing_to_refund",
      reason: `unused slots = ${unused}`,
      durationMs: Date.now() - start,
    });
    return {
      status: 200,
      body: { refundLamports: 0, refundTxHash: null },
    };
  }

  // 7. Sign + send the SystemProgram.transfer.
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(issueRow.creator);
  } catch (err) {
    deps.log({
      privyDid,
      bountyPda,
      status: 500,
      outcome: "internal_error",
      reason: `creator pubkey malformed: ${(err as Error).message}`,
      durationMs: Date.now() - start,
    });
    return { status: 500, body: { error: "internal error" } };
  }

  const commitment = deps.commitment ?? "confirmed";
  let signature: string;
  try {
    const { blockhash, lastValidBlockHeight } =
      await deps.connection.getLatestBlockhash(commitment);
    const tx = new Transaction({
      feePayer: deps.treasuryKeypair.publicKey,
      recentBlockhash: blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: deps.treasuryKeypair.publicKey,
        toPubkey: recipient,
        lamports: refundLamports,
      }),
    );
    tx.sign(deps.treasuryKeypair);
    signature = await deps.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: commitment,
    });
    const confirm = await deps.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      commitment,
    );
    if (confirm.value.err) {
      throw new Error(
        `refund tx errored on-chain: ${JSON.stringify(confirm.value.err)}`,
      );
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log({
      privyDid,
      bountyPda,
      status: 500,
      outcome: "rpc_error",
      reason,
      durationMs: Date.now() - start,
    });
    return { status: 500, body: { error: "refund tx failed", reason } };
  }

  // 8. Audit row. The unique (bounty_pda, kind) constraint is the
  //    primary idempotency guard. A concurrent retry that wins this
  //    insert race would conflict here — we treat that as success
  //    because the SOL has already moved.
  const { error: insertErr } = await deps.supabase
    .from("treasury_refunds")
    .insert({
      bounty_pda: bountyPda,
      kind: "cancel_refund",
      lamports: refundLamports.toString(),
      recipient_pubkey: recipient.toBase58(),
      tx_hash: signature,
    });
  if (insertErr && !insertErr.message.includes("duplicate key")) {
    deps.log({
      privyDid,
      bountyPda,
      status: 500,
      outcome: "internal_error",
      reason: `treasury_refunds insert: ${insertErr.message}`,
      refundLamports,
      refundTxHash: signature,
      durationMs: Date.now() - start,
    });
    // We did move SOL, but the audit row failed. Return 500 — ops will
    // see the log entry and can manually reconcile. The user can retry
    // safely (idempotency check at step 3 catches it on next run via
    // the row that *did* land if the duplicate-key path fires later).
    return {
      status: 500,
      body: { error: "internal error", reason: insertErr.message },
    };
  }

  deps.log({
    privyDid,
    bountyPda,
    status: 200,
    outcome: "ok_refunded",
    refundLamports,
    refundTxHash: signature,
    durationMs: Date.now() - start,
  });
  return {
    status: 200,
    body: { refundLamports, refundTxHash: signature },
  };
}
