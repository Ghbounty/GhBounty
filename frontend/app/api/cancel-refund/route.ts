/**
 * `POST /api/cancel-refund`.
 *
 * Thin wrapper around `lib/cancel-refund-route-core.ts`. See the core
 * for the full status/auth contract. Production deps:
 *   - Privy JWKS (same Privy app id as the gas-station route)
 *   - Treasury keypair + RPC connection (lazy singleton)
 *   - Service-role Supabase client (bypasses RLS for the audit insert)
 */

import { NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";

import {
  handleCancelRefundRequest,
  type CancelRefundLogEntry,
} from "@/lib/cancel-refund-route-core";
import { getCancelRefundSingleton } from "@/lib/cancel-refund-singleton";
import { getServiceRoleClient } from "@/utils/supabase/service-role";

export const runtime = "nodejs";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const PRIVY_JWKS_URL = PRIVY_APP_ID
  ? new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`)
  : null;
const privyJWKS = PRIVY_JWKS_URL ? createRemoteJWKSet(PRIVY_JWKS_URL) : null;

function structuredLog(entry: CancelRefundLogEntry): void {
  // eslint-disable-next-line no-console
  console.log(`[cancel-refund-route] ${JSON.stringify(entry)}`);
}

export async function POST(req: Request) {
  if (!PRIVY_APP_ID || !privyJWKS) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_PRIVY_APP_ID is not configured" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    structuredLog({
      privyDid: null,
      bountyPda: null,
      status: 400,
      outcome: "bad_request",
      reason: "Invalid JSON body",
      durationMs: 0,
    });
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let singleton: ReturnType<typeof getCancelRefundSingleton>;
  try {
    singleton = getCancelRefundSingleton();
  } catch (err) {
    structuredLog({
      privyDid: null,
      bountyPda: null,
      status: 500,
      outcome: "internal_error",
      reason: `singleton init failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: 0,
    });
    return NextResponse.json(
      { error: "refund unavailable" },
      { status: 500 },
    );
  }

  let supabase: ReturnType<typeof getServiceRoleClient>;
  try {
    supabase = getServiceRoleClient();
  } catch (err) {
    structuredLog({
      privyDid: null,
      bountyPda: null,
      status: 500,
      outcome: "internal_error",
      reason: `supabase init failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: 0,
    });
    return NextResponse.json(
      { error: "refund unavailable" },
      { status: 500 },
    );
  }

  const result = await handleCancelRefundRequest(
    {
      authorization: req.headers.get("authorization"),
      body,
    },
    {
      privyAppId: PRIVY_APP_ID,
      verifyKey: privyJWKS,
      supabase,
      treasuryKeypair: singleton.treasuryKeypair,
      connection: singleton.connection,
      log: structuredLog,
    },
  );

  return NextResponse.json(result.body, { status: result.status });
}
