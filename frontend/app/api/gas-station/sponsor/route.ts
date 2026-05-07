/**
 * GHB-175 — `POST /api/gas-station/sponsor`.
 *
 * Thin wrapper around `lib/gas-station-route-core.ts`. Lifts the
 * Authorization header + JSON body, builds production deps (Privy
 * JWKS, Solana singleton, balance lookup), and returns whatever the
 * core decides.
 *
 * See `gas-station-route-core.ts` for the full status/auth contract.
 */

import { NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";

import {
  handleSponsorRequest,
  type SponsorRouteLogEntry,
} from "@/lib/gas-station-route-core";
import { getSolanaSingleton } from "@/lib/gas-station-singleton";

export const runtime = "nodejs";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const PRIVY_JWKS_URL = PRIVY_APP_ID
  ? new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`)
  : null;
// `createRemoteJWKSet` caches per HTTP cache headers, so the actual
// fetch happens at most once per Privy key-rotation window.
const privyJWKS = PRIVY_JWKS_URL ? createRemoteJWKSet(PRIVY_JWKS_URL) : null;

function structuredLog(entry: SponsorRouteLogEntry): void {
  // Single JSON line — easy to grep across Vercel logs and to feed
  // into a log aggregator later. Aligns with `[gas-station]` lines
  // emitted by SolanaGasStation itself.
  // eslint-disable-next-line no-console
  console.log(`[gas-station-route] ${JSON.stringify(entry)}`);
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
    // Body parse error → bad request. We log this manually because
    // the core handler expects parsed JSON.
    structuredLog({
      privyDid: null,
      status: 400,
      outcome: "bad_request",
      reason: "Invalid JSON body",
      durationMs: 0,
    });
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let singleton: ReturnType<typeof getSolanaSingleton>;
  try {
    singleton = getSolanaSingleton();
  } catch (err) {
    structuredLog({
      privyDid: null,
      status: 500,
      outcome: "internal_error",
      reason: `singleton init failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: 0,
    });
    return NextResponse.json(
      { error: "gas station unavailable" },
      { status: 500 },
    );
  }

  const result = await handleSponsorRequest(
    {
      authorization: req.headers.get("authorization"),
      mcpServiceToken: req.headers.get("x-mcp-service-token"),
      body,
    },
    {
      privyAppId: PRIVY_APP_ID,
      verifyKey: privyJWKS,
      gasStation: singleton.station,
      getBalanceLamports: () =>
        singleton.connection.getBalance(singleton.publicKey, "confirmed"),
      minReserveLamports: singleton.minReserveLamports,
      log: structuredLog,
    },
  );

  return NextResponse.json(result.body, { status: result.status });
}
