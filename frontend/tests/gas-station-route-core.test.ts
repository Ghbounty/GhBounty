/**
 * GHB-175 — tests for `lib/gas-station-route-core.ts`.
 *
 * Strategy mirrors `tests/privy-bridge-core.test.ts`:
 *   - generate ephemeral ES256 keypairs locally
 *   - sign Privy-shaped JWTs with the private key
 *   - hand the public key to the handler via `verifyKey`
 *   - stub the gas station + balance lookup with `vi.fn()`
 *
 * Every status branch (200, 400, 401, 422, 500, 503) gets a dedicated
 * test so a regression in any one path shows up as a focused failure.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  generateKeyPair,
  SignJWT,
  type FlattenedJWSInput,
  type JWSHeaderParameters,
  type JWTVerifyGetKey,
  type ResolvedKey,
} from "jose";

import {
  GasStationError,
  type GasStation,
  type SponsorRequest,
  type SponsorResult,
} from "@ghbounty/shared";

import {
  handleSponsorRequest,
  parseBearerToken,
  parseSponsorBody,
  PRIVY_ISSUER,
  type SponsorRouteDeps,
  type SponsorRouteLogEntry,
} from "@/lib/gas-station-route-core";

const PRIVY_APP_ID = "cm_test_app_id";
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

interface SignOpts {
  sub?: string;
  audience?: string | string[];
  issuer?: string;
  iat?: number;
  exp?: number;
  privateKey: CryptoKey;
}

async function signPrivyToken(opts: SignOpts): Promise<string> {
  const iat = opts.iat ?? FIXED_NOW_S;
  const exp = opts.exp ?? iat + 600;
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "test-kid" })
    .setIssuer(opts.issuer ?? PRIVY_ISSUER)
    .setSubject(opts.sub ?? "did:privy:test_user")
    .setAudience(opts.audience ?? PRIVY_APP_ID)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(opts.privateKey);
}

function makeStation(
  result: SponsorResult | Error,
): GasStation {
  return {
    chainId: "solana-devnet",
    sponsor: vi.fn(async (_req: SponsorRequest) => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

interface TestDepsOverrides {
  resolver?: JWTVerifyGetKey;
  station?: GasStation;
  balance?: number | (() => Promise<number>);
  minReserve?: number;
  privyAppId?: string;
}

function makeDeps(o: TestDepsOverrides & { resolver: JWTVerifyGetKey }): {
  deps: SponsorRouteDeps;
  logs: SponsorRouteLogEntry[];
} {
  const logs: SponsorRouteLogEntry[] = [];
  let balanceFn: () => Promise<number>;
  if (typeof o.balance === "function") {
    balanceFn = o.balance;
  } else {
    const v = o.balance ?? 1_000_000;
    balanceFn = async () => v;
  }
  const deps: SponsorRouteDeps = {
    privyAppId: o.privyAppId ?? PRIVY_APP_ID,
    verifyKey: o.resolver,
    gasStation:
      o.station ??
      makeStation({ txHash: "default-sig", durationMs: 100 }),
    getBalanceLamports: balanceFn,
    minReserveLamports: o.minReserve ?? 50_000,
    log: (e) => logs.push(e),
  };
  return { deps, logs };
}

const VALID_BODY = {
  chainId: "solana-devnet",
  payload: {
    kind: "solana",
    partiallySignedTxB64: "AAAA",
  },
};

// ── pure helpers ─────────────────────────────────────────────────────

describe("parseBearerToken", () => {
  test("returns the token from a well-formed header", () => {
    expect(parseBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });
  test("is case-insensitive on the scheme", () => {
    expect(parseBearerToken("bearer xyz")).toBe("xyz");
    expect(parseBearerToken("BEARER xyz")).toBe("xyz");
  });
  test("trims surrounding whitespace", () => {
    expect(parseBearerToken("  Bearer   abc  ")).toBe("abc");
  });
  test("returns null on null/empty/garbage", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
    expect(parseBearerToken("Basic abc")).toBeNull();
    expect(parseBearerToken("Bearer ")).toBeNull();
    expect(parseBearerToken("just-a-token")).toBeNull();
  });
});

describe("parseSponsorBody", () => {
  test("accepts a valid solana request", () => {
    const r = parseSponsorBody(VALID_BODY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.chainId).toBe("solana-devnet");
      expect(r.value.payload.kind).toBe("solana");
    }
  });
  test("rejects non-object body", () => {
    expect(parseSponsorBody(null).ok).toBe(false);
    expect(parseSponsorBody("string").ok).toBe(false);
    expect(parseSponsorBody(123).ok).toBe(false);
  });
  test("rejects unsupported chainId", () => {
    const r = parseSponsorBody({ ...VALID_BODY, chainId: "ethereum" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("unsupported chainId");
  });
  test("rejects missing payload", () => {
    const r = parseSponsorBody({ chainId: "solana-devnet" });
    expect(r.ok).toBe(false);
  });
  test("rejects payload with wrong kind", () => {
    const r = parseSponsorBody({
      chainId: "solana-devnet",
      payload: { kind: "evm", partiallySignedTxB64: "x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("kind");
  });
  test("rejects empty partiallySignedTxB64", () => {
    const r = parseSponsorBody({
      chainId: "solana-devnet",
      payload: { kind: "solana", partiallySignedTxB64: "" },
    });
    expect(r.ok).toBe(false);
  });
});

// ── handler: 200 path ────────────────────────────────────────────────

describe("handleSponsorRequest — 200 ok", () => {
  let resolver: JWTVerifyGetKey;
  let privateKey: CryptoKey;

  beforeEach(async () => {
    const k = await makeKeys();
    resolver = k.resolver;
    privateKey = k.privateKey;
  });

  test("authenticates, sponsors, returns txHash, and logs once", async () => {
    const token = await signPrivyToken({ privateKey });
    const station = makeStation({ txHash: "sig-happy", durationMs: 42 });
    const { deps, logs } = makeDeps({ resolver, station });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe("sig-happy");
    expect(station.sponsor).toHaveBeenCalledOnce();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      privyDid: "did:privy:test_user",
      status: 200,
      outcome: "ok",
      txHash: "sig-happy",
    });
  });
});

// ── handler: 401 paths ───────────────────────────────────────────────

describe("handleSponsorRequest — 401 auth failures", () => {
  test("missing Authorization header → 401", async () => {
    const { resolver } = await makeKeys();
    const { deps, logs } = makeDeps({ resolver });

    const res = await handleSponsorRequest(
      { authorization: null, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(401);
    expect(logs[0]?.outcome).toBe("auth_failed");
    expect(logs[0]?.privyDid).toBeNull();
  });

  test("malformed Authorization header → 401", async () => {
    const { resolver } = await makeKeys();
    const { deps, logs } = makeDeps({ resolver });

    const res = await handleSponsorRequest(
      { authorization: "Basic xyz", mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(401);
    expect(logs[0]?.outcome).toBe("auth_failed");
  });

  test("token signed with foreign keypair → 401", async () => {
    const { resolver } = await makeKeys();
    const { privateKey: foreignKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey: foreignKey });
    const { deps, logs } = makeDeps({ resolver });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(401);
    expect(logs[0]?.outcome).toBe("auth_failed");
    expect(logs[0]?.privyDid).toBeNull();
  });

  test("token with wrong audience → 401", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({
      privateKey,
      audience: "different-app-id",
    });
    const { deps } = makeDeps({ resolver });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );
    expect(res.status).toBe(401);
  });

  test("expired token → 401", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({
      privateKey,
      iat: FIXED_NOW_S - 7200,
      exp: FIXED_NOW_S - 3600,
    });
    const { deps } = makeDeps({ resolver });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );
    expect(res.status).toBe(401);
  });
});

// ── handler: 400 paths ───────────────────────────────────────────────

describe("handleSponsorRequest — 400 bad request", () => {
  test("body shape invalid → 400 with reason", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey });
    const { deps, logs } = makeDeps({ resolver });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: { chainId: "solana-devnet" } },
      deps,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("payload");
    expect(logs[0]).toMatchObject({
      outcome: "bad_request",
      privyDid: "did:privy:test_user",
    });
  });

  test("non-object body → 400", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey });
    const { deps } = makeDeps({ resolver });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: null },
      deps,
    );

    expect(res.status).toBe(400);
  });
});

// ── handler: 422 paths ───────────────────────────────────────────────

describe("handleSponsorRequest — 422 validator rejected", () => {
  test("GasStationError(validator_rejected) → 422 with reason in body", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey });
    const station = makeStation(
      new GasStationError(
        "validator_rejected",
        "wrong_fee_payer: fee payer ABC is not the gas-station pubkey",
      ),
    );
    const { deps, logs } = makeDeps({ resolver, station });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("tx rejected by gas station");
    expect(res.body.reason).toContain("wrong_fee_payer");
    expect(logs[0]?.outcome).toBe("validator_rejected");
  });
});

// ── handler: 503 reserve ─────────────────────────────────────────────

describe("handleSponsorRequest — 503 insufficient reserve", () => {
  test("balance below reserve → 503 and gas station NOT called", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey });
    const station = makeStation({ txHash: "should-not-be-called", durationMs: 0 });
    const { deps, logs } = makeDeps({
      resolver,
      station,
      balance: 10_000,
      minReserve: 50_000,
    });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(503);
    expect(res.body.reason).toBe("insufficient_reserve");
    expect(station.sponsor).not.toHaveBeenCalled();
    expect(logs[0]?.outcome).toBe("insufficient_reserve");
    expect(logs[0]?.reason).toContain("10000");
  });

  test("balance exactly at reserve → 503 (strict <)", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey });
    const station = makeStation({ txHash: "ok", durationMs: 0 });
    const { deps } = makeDeps({
      resolver,
      station,
      balance: 50_000,
      minReserve: 50_001,
    });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(503);
  });

  test("balance lookup throws → 500 (not 503 — distinct failure mode)", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey });
    const { deps, logs } = makeDeps({
      resolver,
      balance: async () => {
        throw new Error("rpc unreachable");
      },
    });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(500);
    expect(logs[0]?.outcome).toBe("internal_error");
    expect(logs[0]?.reason).toContain("rpc unreachable");
  });
});

// ── handler: 500 paths ───────────────────────────────────────────────

describe("handleSponsorRequest — 500 errors", () => {
  test("GasStationError(rpc_error) → 500 with generic message", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey });
    const station = makeStation(
      new GasStationError("rpc_error", "connection refused"),
    );
    const { deps, logs } = makeDeps({ resolver, station });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("gas station error");
    // rpc_error reason is forwarded (on-chain errors are public anyway,
    // and the cancel flow uses it to detect "already settled" reverts).
    expect(res.body.reason).toContain("connection refused");
    expect(logs[0]?.outcome).toBe("rpc_error");
    expect(logs[0]?.reason).toContain("connection refused");
  });

  test("unexpected non-GasStationError → 500", async () => {
    const { resolver, privateKey } = await makeKeys();
    const token = await signPrivyToken({ privateKey });
    const station = makeStation(new Error("boom"));
    const { deps, logs } = makeDeps({ resolver, station });

    const res = await handleSponsorRequest(
      { authorization: `Bearer ${token}`, mcpServiceToken: null, body: VALID_BODY },
      deps,
    );

    expect(res.status).toBe(500);
    expect(logs[0]?.outcome).toBe("internal_error");
    expect(logs[0]?.reason).toContain("boom");
  });
});

// ── handler: MCP service-token auth ─────────────────────────────────

describe("handleSponsorRequest — MCP x-mcp-service-token auth", () => {
  const SERVICE_TOKEN = "super-secret-token-abc123";

  beforeEach(() => {
    process.env.GAS_STATION_SERVICE_TOKEN = SERVICE_TOKEN;
  });

  afterEach(() => {
    delete process.env.GAS_STATION_SERVICE_TOKEN;
  });

  test("valid x-mcp-service-token bypasses Privy and sponsors successfully", async () => {
    const { resolver } = await makeKeys();
    const station = makeStation({ txHash: "mcp-sig", durationMs: 10 });
    const { deps, logs } = makeDeps({ resolver, station });

    const res = await handleSponsorRequest(
      {
        authorization: null, // no Privy token — MCP never sends one
        mcpServiceToken: SERVICE_TOKEN,
        body: VALID_BODY,
      },
      deps,
    );

    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe("mcp-sig");
    expect(station.sponsor).toHaveBeenCalledOnce();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      privyDid: "mcp-service",
      status: 200,
      outcome: "ok",
      txHash: "mcp-sig",
    });
  });

  test("mismatched x-mcp-service-token → 401 with reason", async () => {
    const { resolver } = await makeKeys();
    const station = makeStation({ txHash: "should-not-be-called", durationMs: 0 });
    const { deps, logs } = makeDeps({ resolver, station });

    const res = await handleSponsorRequest(
      {
        authorization: null,
        mcpServiceToken: "wrong-token",
        body: VALID_BODY,
      },
      deps,
    );

    expect(res.status).toBe(401);
    expect(res.body.reason).toContain("invalid MCP service token");
    expect(station.sponsor).not.toHaveBeenCalled();
    expect(logs[0]?.outcome).toBe("auth_failed");
    expect(logs[0]?.privyDid).toBeNull();
  });

  test("x-mcp-service-token present but GAS_STATION_SERVICE_TOKEN env not set → 401", async () => {
    delete process.env.GAS_STATION_SERVICE_TOKEN; // override beforeEach
    const { resolver } = await makeKeys();
    const station = makeStation({ txHash: "should-not-be-called", durationMs: 0 });
    const { deps, logs } = makeDeps({ resolver, station });

    const res = await handleSponsorRequest(
      {
        authorization: null,
        mcpServiceToken: SERVICE_TOKEN,
        body: VALID_BODY,
      },
      deps,
    );

    expect(res.status).toBe(401);
    expect(res.body.reason).toContain("server not configured");
    expect(station.sponsor).not.toHaveBeenCalled();
    expect(logs[0]?.outcome).toBe("auth_failed");
    expect(logs[0]?.privyDid).toBeNull();
  });

  test("no x-mcp-service-token header → falls through to Privy (existing path unchanged)", async () => {
    // With env set but no MCP header, normal Privy auth must still work.
    const { resolver, privateKey } = await makeKeys();
    const station = makeStation({ txHash: "privy-sig", durationMs: 5 });
    const { deps, logs } = makeDeps({ resolver, station });
    const token = await signPrivyToken({ privateKey });

    const res = await handleSponsorRequest(
      {
        authorization: `Bearer ${token}`,
        mcpServiceToken: null,
        body: VALID_BODY,
      },
      deps,
    );

    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe("privy-sig");
    expect(logs[0]).toMatchObject({
      privyDid: "did:privy:test_user",
      status: 200,
      outcome: "ok",
    });
  });
});
