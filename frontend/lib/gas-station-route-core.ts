/**
 * GHB-175 — pure handler for `POST /api/gas-station/sponsor`.
 *
 * All logic lives here so tests can drive it without spinning up a
 * Next.js server, real Privy JWKS, or a real RPC. The route file at
 * `app/api/gas-station/sponsor/route.ts` is a thin adapter that:
 *   - reads env vars and the Authorization header
 *   - lazy-builds the `SolanaGasStation` singleton
 *   - delegates to `handleSponsorRequest` here
 *
 * Status mapping (per the GHB-175 acceptance criteria):
 *   200 — sponsored, returns { txHash }
 *   400 — body malformed (missing fields / bad shape)
 *   401 — Privy access token missing or invalid
 *   422 — gas station validator rejected the tx (returns reason)
 *   500 — RPC error or unexpected failure
 *   503 — gas-station wallet balance below the configured reserve
 *
 * Every request emits one structured log line with `privyDid` (so
 * ops can trace abuse attempts back to the authenticated user) plus
 * the outcome and tx metadata.
 */

import { jwtVerify } from "jose";
import type { JWTPayload, JWTVerifyGetKey } from "jose";

import {
  GasStationError,
  type GasStation,
  type SponsorRequest,
} from "@ghbounty/shared";
import { isSupportedChain } from "@ghbounty/shared";

export const PRIVY_ISSUER = "privy.io";

export type SponsorOutcome =
  | "ok"
  | "auth_failed"
  | "bad_request"
  | "validator_rejected"
  | "rpc_error"
  | "insufficient_reserve"
  | "internal_error";

export interface SponsorRouteLogEntry {
  /** Privy DID (`sub` claim) when the token verified. Null otherwise. */
  privyDid: string | null;
  status: number;
  outcome: SponsorOutcome;
  /** Free-form detail. Always set for non-`ok` outcomes. */
  reason?: string;
  /** Solana signature on success. */
  txHash?: string;
  /** End-to-end wall-clock duration (ms). */
  durationMs: number;
}

export interface SponsorRouteDeps {
  /** Privy app id; matched against the JWT `aud` claim. */
  privyAppId: string;
  /**
   * Verifying key/getter for `jose.jwtVerify`. In production this is
   * `createRemoteJWKSet(...)`; tests pass a local resolver.
   */
  verifyKey: JWTVerifyGetKey | CryptoKey | Uint8Array;
  /** The pre-built gas station singleton. */
  gasStation: GasStation;
  /**
   * Lookup the current gas-station wallet balance in lamports. Called
   * before each sponsor attempt — keeps the reserve check honest even
   * across long-running processes.
   */
  getBalanceLamports(): Promise<number>;
  /**
   * Below this many lamports, refuse to sponsor and return 503. Set
   * conservatively so ops sees the alert before the wallet truly
   * empties out.
   */
  minReserveLamports: number;
  /** Structured logger. One call per request, regardless of outcome. */
  log: (entry: SponsorRouteLogEntry) => void;
}

export interface SponsorRouteRequest {
  /** Raw `Authorization` header value, e.g. `"Bearer eyJ..."`. */
  authorization: string | null;
  /**
   * Parsed JSON body. Untyped on purpose: validation lives in this
   * file so the route doesn't have to defend against shape errors.
   */
  body: unknown;
}

export interface SponsorRouteResponse {
  status: number;
  body: { txHash?: string; error?: string; reason?: string };
}

/**
 * Strip `"Bearer "` prefix and return the raw token. Returns null if
 * the header is missing or malformed (case-insensitive scheme match).
 */
export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  // RFC 6750: `Authorization: Bearer <token>`. Allow case-insensitive
  // scheme to match common client behaviour.
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  const token = match[1]!.trim();
  return token.length > 0 ? token : null;
}

/**
 * Coerce an arbitrary parsed JSON value into a `SponsorRequest` or
 * return a structured error message. Keeps the route's 400 path
 * descriptive (the frontend surfaces these to dev consoles).
 */
export function parseSponsorBody(
  body: unknown,
):
  | { ok: true; value: SponsorRequest }
  | { ok: false; reason: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.chainId !== "string") {
    return { ok: false, reason: "missing or non-string chainId" };
  }
  if (!isSupportedChain(b.chainId)) {
    return { ok: false, reason: `unsupported chainId: ${b.chainId}` };
  }
  const payload = b.payload;
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "missing payload object" };
  }
  const p = payload as Record<string, unknown>;
  if (p.kind !== "solana") {
    return { ok: false, reason: `unsupported payload.kind: ${String(p.kind)}` };
  }
  if (
    typeof p.partiallySignedTxB64 !== "string" ||
    p.partiallySignedTxB64.length === 0
  ) {
    return {
      ok: false,
      reason: "missing or empty payload.partiallySignedTxB64",
    };
  }
  return {
    ok: true,
    value: {
      chainId: b.chainId,
      payload: {
        kind: "solana",
        partiallySignedTxB64: p.partiallySignedTxB64,
      },
    },
  };
}

/**
 * Verify a Privy access token and return its `sub` (DID). Throws on
 * any verification failure — caller maps to 401.
 */
export async function verifyPrivyToken(
  token: string,
  deps: Pick<SponsorRouteDeps, "privyAppId" | "verifyKey">,
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

/**
 * The full request handler. Pure: takes the raw authorization header
 * + parsed body + injected deps, returns a status + body. Always
 * logs exactly once before returning.
 */
export async function handleSponsorRequest(
  req: SponsorRouteRequest,
  deps: SponsorRouteDeps,
): Promise<SponsorRouteResponse> {
  const start = Date.now();

  // 1. Auth.
  const token = parseBearerToken(req.authorization);
  if (!token) {
    deps.log({
      privyDid: null,
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
      status: 401,
      outcome: "auth_failed",
      reason,
      durationMs: Date.now() - start,
    });
    return { status: 401, body: { error: "Privy token verification failed" } };
  }

  // 2. Body.
  const parsed = parseSponsorBody(req.body);
  if (!parsed.ok) {
    deps.log({
      privyDid,
      status: 400,
      outcome: "bad_request",
      reason: parsed.reason,
      durationMs: Date.now() - start,
    });
    return { status: 400, body: { error: parsed.reason } };
  }

  // 3. Reserve check. Done AFTER auth so unauthenticated probes can't
  //    enumerate wallet state, but BEFORE we touch the gas station so
  //    we never partially-sign a tx we won't pay for.
  let balance: number;
  try {
    balance = await deps.getBalanceLamports();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log({
      privyDid,
      status: 500,
      outcome: "internal_error",
      reason: `balance lookup failed: ${reason}`,
      durationMs: Date.now() - start,
    });
    return { status: 500, body: { error: "internal error" } };
  }
  if (balance < deps.minReserveLamports) {
    const reason = `wallet balance ${balance} below reserve ${deps.minReserveLamports}`;
    deps.log({
      privyDid,
      status: 503,
      outcome: "insufficient_reserve",
      reason,
      durationMs: Date.now() - start,
    });
    return {
      status: 503,
      body: {
        error: "gas station temporarily unavailable",
        reason: "insufficient_reserve",
      },
    };
  }

  // 4. Sponsor.
  try {
    const result = await deps.gasStation.sponsor(parsed.value);
    deps.log({
      privyDid,
      status: 200,
      outcome: "ok",
      txHash: result.txHash,
      durationMs: Date.now() - start,
    });
    return { status: 200, body: { txHash: result.txHash } };
  } catch (err) {
    if (err instanceof GasStationError) {
      const status = mapGasStationCodeToStatus(err.code);
      const outcome =
        err.code === "validator_rejected"
          ? "validator_rejected"
          : err.code === "rpc_error"
            ? "rpc_error"
            : "internal_error";
      deps.log({
        privyDid,
        status,
        outcome,
        reason: `${err.code}: ${err.message}`,
        durationMs: Date.now() - start,
      });
      // For validator_rejected we surface the reason — the frontend
      // shows it to the user so they can fix their tx. For everything
      // else we keep the response generic to avoid leaking internals.
      if (err.code === "validator_rejected") {
        return {
          status,
          body: { error: "tx rejected by gas station", reason: err.message },
        };
      }
      return { status, body: { error: "gas station error" } };
    }
    const reason = err instanceof Error ? err.message : String(err);
    deps.log({
      privyDid,
      status: 500,
      outcome: "internal_error",
      reason,
      durationMs: Date.now() - start,
    });
    return { status: 500, body: { error: "internal error" } };
  }
}

function mapGasStationCodeToStatus(code: GasStationError["code"]): number {
  switch (code) {
    case "validator_rejected":
      return 422;
    case "insufficient_reserve":
      // Strictly redundant with the explicit reserve check above
      // (we only call sponsor when balance >= reserve), but if a
      // future impl raises this code mid-sponsor we still return 503.
      return 503;
    case "rpc_error":
      return 500;
    case "not_implemented":
    case "unsupported_chain":
      return 500;
    default: {
      // Exhaustiveness — adding a code in shared/ without handling
      // it here is a compile error.
      const _exhaustive: never = code;
      void _exhaustive;
      return 500;
    }
  }
}
