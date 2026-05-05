/**
 * GHB-176 — tests for the frontend gas-station client.
 *
 * Strategy: build real `TransactionInstruction`s, hand them to
 * `submitSponsored` with stub deps (signTransaction, getAccessToken,
 * connection.getLatestBlockhash, fetch). Assert wire shape going to
 * the server + the result/error returned to the caller. No real
 * network, no Privy, no Solana RPC.
 */

import { describe, expect, test, vi } from "vitest";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";

import {
  formatGasStationError,
  GasStationClientError,
  submitSponsored,
  type SignTransactionFn,
} from "@/lib/gas-station-client";

const RECENT_BLOCKHASH = "FwRYtTPRk5N4wUeP87rTw9kQVSwigB6kbikGzzeCMrW5";

function makeIx(payer: PublicKey): TransactionInstruction {
  // Any well-formed ix works — the client doesn't inspect program/data.
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  });
}

function makeConnection(): Connection {
  return {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: RECENT_BLOCKHASH,
      lastValidBlockHeight: 1_000_000,
    }),
  } as unknown as Connection;
}

function makePrivyStubs(): {
  wallet: ConnectedStandardSolanaWallet;
  signTransaction: SignTransactionFn;
  getAccessToken: () => Promise<string | null>;
} {
  // Privy returns the same bytes — for our test surface we just echo
  // them back; the server signs with the gas station, not with the
  // user's slot, so we don't need a real signature here.
  return {
    wallet: {
      address: Keypair.generate().publicKey.toBase58(),
    } as unknown as ConnectedStandardSolanaWallet,
    signTransaction: vi.fn(async ({ transaction }) => ({
      signedTransaction: transaction,
    })),
    getAccessToken: vi.fn().mockResolvedValue("eyJ.fake.token"),
  };
}

function makeFetchOk(txHash: string): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ txHash }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

function makeFetchError(
  status: number,
  body: { error?: string; reason?: string } = {},
): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

const GAS_STATION = Keypair.generate().publicKey;

// ── happy path ───────────────────────────────────────────────────────

describe("submitSponsored — happy path", () => {
  test("builds VersionedTx with feePayer=gas station, partial-signs, POSTs, returns txHash", async () => {
    const userPk = Keypair.generate().publicKey;
    const ix = makeIx(userPk);
    const { wallet, signTransaction, getAccessToken } = makePrivyStubs();
    const fetchImpl = makeFetchOk("real-sig-abc");

    const result = await submitSponsored({
      ix,
      wallet,
      signTransaction,
      getAccessToken,
      connection: makeConnection(),
      gasStationPubkey: GAS_STATION,
      chainId: "solana-devnet",
      fetchImpl,
    });

    expect(result.txHash).toBe("real-sig-abc");

    // Privy was asked to sign — check the tx that went in had fee payer = gas station.
    const signCall = (signTransaction as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { transaction: Uint8Array };
    const sentTx = VersionedTransaction.deserialize(signCall.transaction);
    expect(sentTx.message.staticAccountKeys[0]!.equals(GAS_STATION)).toBe(true);

    // Fetch was called once with the right URL + method + body shape.
    const fetchMock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/gas-station/sponsor");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer eyJ.fake.token");
    const body = JSON.parse(init.body as string) as {
      chainId: string;
      payload: { kind: string; partiallySignedTxB64: string };
    };
    expect(body.chainId).toBe("solana-devnet");
    expect(body.payload.kind).toBe("solana");
    expect(body.payload.partiallySignedTxB64.length).toBeGreaterThan(0);

    // The b64 in the body decodes back to the same bytes Privy returned.
    const decoded = Uint8Array.from(
      atob(body.payload.partiallySignedTxB64),
      (c) => c.charCodeAt(0),
    );
    expect(decoded.length).toBe(signCall.transaction.length);
  });

  test("forwards solana-mainnet chainId when configured", async () => {
    const userPk = Keypair.generate().publicKey;
    const ix = makeIx(userPk);
    const { wallet, signTransaction, getAccessToken } = makePrivyStubs();
    const fetchImpl = makeFetchOk("sig-x");

    await submitSponsored({
      ix,
      wallet,
      signTransaction,
      getAccessToken,
      connection: makeConnection(),
      gasStationPubkey: GAS_STATION,
      chainId: "solana-mainnet",
      privyChain: "solana:mainnet",
      fetchImpl,
    });

    const signCall = (signTransaction as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { chain?: string };
    expect(signCall.chain).toBe("solana:mainnet");

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![1];
    const body = JSON.parse(init.body as string) as { chainId: string };
    expect(body.chainId).toBe("solana-mainnet");
  });
});

// ── error paths ──────────────────────────────────────────────────────

describe("submitSponsored — error paths", () => {
  test("missing pubkey override AND env → 500 GasStationClientError", async () => {
    const ix = makeIx(Keypair.generate().publicKey);
    const { wallet, signTransaction, getAccessToken } = makePrivyStubs();

    let caught: GasStationClientError | undefined;
    try {
      await submitSponsored({
        ix,
        wallet,
        signTransaction,
        getAccessToken,
        connection: makeConnection(),
        // no gasStationPubkey — env not set in test runner either
      });
    } catch (e) {
      caught = e as GasStationClientError;
    }
    expect(caught).toBeInstanceOf(GasStationClientError);
    expect(caught?.status).toBe(500);
    expect(caught?.message).toContain("not configured");
  });

  test("getAccessToken returns null → 401 GasStationClientError", async () => {
    const ix = makeIx(Keypair.generate().publicKey);
    const { wallet, signTransaction } = makePrivyStubs();
    const fetchImpl = makeFetchOk("never-reached");

    let caught: GasStationClientError | undefined;
    try {
      await submitSponsored({
        ix,
        wallet,
        signTransaction,
        getAccessToken: async () => null,
        connection: makeConnection(),
        gasStationPubkey: GAS_STATION,
        fetchImpl,
      });
    } catch (e) {
      caught = e as GasStationClientError;
    }
    expect(caught?.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("503 from server → status 503 with 'insufficient_reserve' reason", async () => {
    const ix = makeIx(Keypair.generate().publicKey);
    const { wallet, signTransaction, getAccessToken } = makePrivyStubs();
    const fetchImpl = makeFetchError(503, {
      error: "gas station temporarily unavailable",
      reason: "insufficient_reserve",
    });

    let caught: GasStationClientError | undefined;
    try {
      await submitSponsored({
        ix,
        wallet,
        signTransaction,
        getAccessToken,
        connection: makeConnection(),
        gasStationPubkey: GAS_STATION,
        fetchImpl,
      });
    } catch (e) {
      caught = e as GasStationClientError;
    }
    expect(caught?.status).toBe(503);
    expect(caught?.reason).toBe("insufficient_reserve");
  });

  test("422 from server → status 422 with reason in error", async () => {
    const ix = makeIx(Keypair.generate().publicKey);
    const { wallet, signTransaction, getAccessToken } = makePrivyStubs();
    const fetchImpl = makeFetchError(422, {
      error: "tx rejected by gas station",
      reason: "wrong_fee_payer: fee payer ABC is not the gas-station pubkey",
    });

    let caught: GasStationClientError | undefined;
    try {
      await submitSponsored({
        ix,
        wallet,
        signTransaction,
        getAccessToken,
        connection: makeConnection(),
        gasStationPubkey: GAS_STATION,
        fetchImpl,
      });
    } catch (e) {
      caught = e as GasStationClientError;
    }
    expect(caught?.status).toBe(422);
    expect(caught?.reason).toContain("wrong_fee_payer");
  });

  test("200 with missing txHash → 500 client error", async () => {
    const ix = makeIx(Keypair.generate().publicKey);
    const { wallet, signTransaction, getAccessToken } = makePrivyStubs();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch;

    let caught: GasStationClientError | undefined;
    try {
      await submitSponsored({
        ix,
        wallet,
        signTransaction,
        getAccessToken,
        connection: makeConnection(),
        gasStationPubkey: GAS_STATION,
        fetchImpl,
      });
    } catch (e) {
      caught = e as GasStationClientError;
    }
    expect(caught?.status).toBe(500);
    expect(caught?.message).toContain("missing txHash");
  });

  test("non-JSON error body → still throws with HTTP status", async () => {
    const ix = makeIx(Keypair.generate().publicKey);
    const { wallet, signTransaction, getAccessToken } = makePrivyStubs();
    const fetchImpl = vi.fn(async () =>
      new Response("<html>proxy error</html>", { status: 502 }),
    ) as unknown as typeof fetch;

    let caught: GasStationClientError | undefined;
    try {
      await submitSponsored({
        ix,
        wallet,
        signTransaction,
        getAccessToken,
        connection: makeConnection(),
        gasStationPubkey: GAS_STATION,
        fetchImpl,
      });
    } catch (e) {
      caught = e as GasStationClientError;
    }
    expect(caught?.status).toBe(502);
    expect(caught?.message).toContain("HTTP 502");
  });
});

// ── formatGasStationError ────────────────────────────────────────────

describe("formatGasStationError", () => {
  test("503 → user-visible 'temporarily unavailable'", () => {
    const err = new GasStationClientError(503, "insufficient_reserve", "x");
    expect(formatGasStationError(err)).toMatch(/temporarily unavailable/i);
  });
  test("422 with reason → includes the reason", () => {
    const err = new GasStationClientError(422, "wrong_fee_payer: ...", "x");
    expect(formatGasStationError(err)).toContain("wrong_fee_payer");
  });
  test("422 without reason → generic rejection", () => {
    const err = new GasStationClientError(422, null, "x");
    expect(formatGasStationError(err)).toMatch(/rejected by gas station/i);
  });
  test("401 → 'sign in again'", () => {
    const err = new GasStationClientError(401, null, "x");
    expect(formatGasStationError(err)).toMatch(/sign in again/i);
  });
  test("500 → generic 'gas station error'", () => {
    const err = new GasStationClientError(500, null, "internal");
    expect(formatGasStationError(err)).toMatch(/gas station error/i);
  });
  test("non-GasStationClientError → message passthrough", () => {
    expect(formatGasStationError(new Error("boom"))).toBe("boom");
    expect(formatGasStationError("just a string")).toBe("just a string");
  });
});
