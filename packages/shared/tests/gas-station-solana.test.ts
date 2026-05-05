import { describe, expect, test, vi } from "vitest";
import {
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  SolanaGasStation,
  type SolanaRpcSubmitter,
  type SponsorLogEntry,
} from "../src/gas-station/solana.js";
import { ESCROW_PROGRAM_ID } from "../src/gas-station/solana-validator.js";
import { GasStationError } from "../src/gas-station/types.js";

/**
 * GHB-174 — SolanaGasStation tests.
 *
 * Three paths must be covered (per the ticket's acceptance criteria):
 *   - happy path        → tx flows through validate → sign → send → confirm
 *   - validator-reject  → bad tx never touches the RPC
 *   - rpc-error         → submit/confirm failures bubble as GasStationError("rpc_error")
 *
 * The RPC is a `vi.fn()` stub; we never hit a network. The validator
 * is the real one (already covered by GHB-173 tests) so this file
 * focuses purely on wiring.
 */

const RECENT_BLOCKHASH = "FwRYtTPRk5N4wUeP87rTw9kQVSwigB6kbikGzzeCMrW5";

/**
 * Build a minimal valid `submit_solution` tx with the gas-station as
 * sole signer. Real flows will have the user as a second signer too,
 * but the validator only checks shape so 1 signer is enough to
 * exercise the gas-station's signing / submission path.
 */
function buildSubmitSolutionTx(feePayer: Keypair): string {
  const ix = new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [{ pubkey: feePayer.publicKey, isSigner: true, isWritable: true }],
    data: Buffer.from("cbe99dbf4625cd00", "hex"), // submit_solution
  });
  const msg = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: RECENT_BLOCKHASH,
    instructions: [ix],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

function makeRpc(
  overrides: Partial<SolanaRpcSubmitter> = {},
): SolanaRpcSubmitter {
  return {
    send: vi.fn().mockResolvedValue("mock-sig-default"),
    confirm: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── happy path ───────────────────────────────────────────────────────

describe("SolanaGasStation — happy path", () => {
  test("validates, signs, submits, confirms, and returns txHash", async () => {
    const gasStation = Keypair.generate();
    const rpc = makeRpc({
      send: vi.fn().mockResolvedValue("real-sig-abc"),
    });
    const logs: SponsorLogEntry[] = [];
    const station = new SolanaGasStation({
      chainId: "solana-devnet",
      keypair: gasStation,
      rpc,
      log: (e) => logs.push(e),
    });
    const txB64 = buildSubmitSolutionTx(gasStation);

    const result = await station.sponsor({
      chainId: "solana-devnet",
      payload: { kind: "solana", partiallySignedTxB64: txB64 },
    });

    expect(result.txHash).toBe("real-sig-abc");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(rpc.send).toHaveBeenCalledOnce();
    expect(rpc.confirm).toHaveBeenCalledOnce();
    // Submitted-tx slot 0 must be a real signature, not the empty
    // 64-byte zero buffer that `compileToV0Message` leaves there.
    const sentRaw = (rpc.send as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Uint8Array;
    const sentTx = VersionedTransaction.deserialize(sentRaw);
    expect(Array.from(sentTx.signatures[0]!).every((b) => b === 0)).toBe(false);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      chainId: "solana-devnet",
      discriminator: "cbe99dbf4625cd00",
      lamports: 5_000,
      outcome: "ok",
    });
    expect(logs[0]?.reason).toBeUndefined();
  });

  test("respects custom confirmTimeoutMs", async () => {
    const gasStation = Keypair.generate();
    const rpc = makeRpc({ send: vi.fn().mockResolvedValue("sig-1") });
    const station = new SolanaGasStation({
      chainId: "solana-devnet",
      keypair: gasStation,
      rpc,
      confirmTimeoutMs: 12_345,
    });
    await station.sponsor({
      chainId: "solana-devnet",
      payload: {
        kind: "solana",
        partiallySignedTxB64: buildSubmitSolutionTx(gasStation),
      },
    });
    expect(rpc.confirm).toHaveBeenCalledWith("sig-1", 12_345);
  });
});

// ── validator-reject path ────────────────────────────────────────────

describe("SolanaGasStation — validator-reject path", () => {
  test("garbage tx → GasStationError(validator_rejected), RPC never called", async () => {
    const gasStation = Keypair.generate();
    const rpc = makeRpc();
    const station = new SolanaGasStation({
      chainId: "solana-devnet",
      keypair: gasStation,
      rpc,
    });

    let caught: unknown;
    try {
      await station.sponsor({
        chainId: "solana-devnet",
        payload: {
          kind: "solana",
          partiallySignedTxB64: "not-real-base64!!!",
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GasStationError);
    expect((caught as GasStationError).code).toBe("validator_rejected");
    expect((caught as GasStationError).message).toContain("tx_decode_failed");
    expect(rpc.send).not.toHaveBeenCalled();
    expect(rpc.confirm).not.toHaveBeenCalled();
  });

  test("wrong fee payer → validator_rejected with the underlying code", async () => {
    const gasStation = Keypair.generate();
    const otherUser = Keypair.generate();
    const rpc = makeRpc();
    const logs: SponsorLogEntry[] = [];
    const station = new SolanaGasStation({
      chainId: "solana-devnet",
      keypair: gasStation,
      rpc,
      log: (e) => logs.push(e),
    });

    let caught: GasStationError | undefined;
    try {
      await station.sponsor({
        chainId: "solana-devnet",
        payload: {
          kind: "solana",
          partiallySignedTxB64: buildSubmitSolutionTx(otherUser),
        },
      });
    } catch (err) {
      caught = err as GasStationError;
    }

    expect(caught?.code).toBe("validator_rejected");
    expect(caught?.message).toContain("wrong_fee_payer");
    expect(rpc.send).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({
      outcome: "validator_rejected",
      discriminator: null,
      lamports: null,
    });
    expect(logs[0]?.reason).toContain("wrong_fee_payer");
  });
});

// ── RPC-error path ───────────────────────────────────────────────────

describe("SolanaGasStation — RPC-error path", () => {
  test("send throws → GasStationError(rpc_error)", async () => {
    const gasStation = Keypair.generate();
    const rpc = makeRpc({
      send: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    const logs: SponsorLogEntry[] = [];
    const station = new SolanaGasStation({
      chainId: "solana-devnet",
      keypair: gasStation,
      rpc,
      log: (e) => logs.push(e),
    });

    let caught: GasStationError | undefined;
    try {
      await station.sponsor({
        chainId: "solana-devnet",
        payload: {
          kind: "solana",
          partiallySignedTxB64: buildSubmitSolutionTx(gasStation),
        },
      });
    } catch (err) {
      caught = err as GasStationError;
    }

    expect(caught?.code).toBe("rpc_error");
    expect(caught?.message).toContain("connection refused");
    expect(rpc.confirm).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({
      outcome: "rpc_error",
      discriminator: "cbe99dbf4625cd00",
      lamports: 5_000,
    });
    expect(logs[0]?.reason).toContain("connection refused");
  });

  test("confirm throws → GasStationError(rpc_error) and we still log lamports", async () => {
    const gasStation = Keypair.generate();
    const rpc = makeRpc({
      send: vi.fn().mockResolvedValue("sig-x"),
      confirm: vi.fn().mockRejectedValue(new Error("confirmation timeout")),
    });
    const logs: SponsorLogEntry[] = [];
    const station = new SolanaGasStation({
      chainId: "solana-devnet",
      keypair: gasStation,
      rpc,
      log: (e) => logs.push(e),
    });

    let caught: GasStationError | undefined;
    try {
      await station.sponsor({
        chainId: "solana-devnet",
        payload: {
          kind: "solana",
          partiallySignedTxB64: buildSubmitSolutionTx(gasStation),
        },
      });
    } catch (err) {
      caught = err as GasStationError;
    }

    expect(caught?.code).toBe("rpc_error");
    expect(caught?.message).toContain("confirmation timeout");
    expect(logs[0]?.outcome).toBe("rpc_error");
    expect(logs[0]?.lamports).toBe(5_000);
  });
});

// ── chainId / payload mismatch ───────────────────────────────────────

describe("SolanaGasStation — request mismatch guards", () => {
  test("chainId mismatch → unsupported_chain", async () => {
    const station = new SolanaGasStation({
      chainId: "solana-devnet",
      keypair: Keypair.generate(),
      rpc: makeRpc(),
    });

    let caught: GasStationError | undefined;
    try {
      await station.sponsor({
        chainId: "solana-mainnet",
        payload: { kind: "solana", partiallySignedTxB64: "..." },
      });
    } catch (err) {
      caught = err as GasStationError;
    }

    expect(caught?.code).toBe("unsupported_chain");
  });
});
