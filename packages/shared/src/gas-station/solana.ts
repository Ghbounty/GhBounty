/**
 * GHB-174 — SolanaGasStation: concrete `GasStation` impl for Solana.
 *
 * Pipeline (per request):
 *   1. Decode the base64 VersionedTransaction.
 *   2. Run `validateSolanaSponsorTx` — every shape we sponsor must
 *      pass every guard. Reject codes are bubbled up as
 *      `GasStationError("validator_rejected", "<code>: <reason>")`.
 *   3. Add the gas-station's signature at slot 0 (fee payer).
 *      `VersionedTransaction.sign([keypair])` fills only matching
 *      slots, leaving the user's existing partial signatures intact.
 *   4. Submit via the injected `SolanaRpcSubmitter` and wait for
 *      confirmation. Any RPC failure → `GasStationError("rpc_error")`.
 *   5. Return `{ txHash, durationMs }` on success.
 *
 * Why a `SolanaRpcSubmitter` interface instead of a `Connection`:
 * `@solana/web3.js`'s `Connection` is a giant class with overloaded
 * methods that are awkward to stub in unit tests. The submitter
 * abstraction is two methods — easy to fake with `vi.fn()` and easy
 * to wire to a real `Connection` in GHB-175.
 *
 * Logging is one structured JSON line per sponsor attempt (ok or
 * not). Every line carries `chainId / discriminator / lamports /
 * durationMs / outcome` so we can plug it into a log aggregator
 * later without touching this file.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  Connection,
  Keypair,
  VersionedTransaction,
  type Commitment,
} from "@solana/web3.js";

import type { ChainId } from "../chains.js";
import {
  GasStation,
  GasStationError,
  SponsorRequest,
  SponsorResult,
} from "./types.js";
import { validateSolanaSponsorTx } from "./solana-validator.js";

/**
 * Minimal RPC surface SolanaGasStation needs. A real `Connection`
 * from `@solana/web3.js` satisfies this structurally; tests pass a
 * stub object with `vi.fn()` for both methods.
 */
export interface SolanaRpcSubmitter {
  /**
   * Submit a fully-signed serialized tx. Resolves to the signature
   * (base58) on success. Throws on RPC error / preflight failure.
   */
  send(rawTx: Uint8Array): Promise<string>;
  /**
   * Wait for the tx to reach `confirmed`. Implementations should
   * enforce `timeoutMs` and throw on timeout or on tx error.
   */
  confirm(signature: string, timeoutMs: number): Promise<void>;
}

/**
 * One log line per sponsor attempt — written via the injected `log`
 * fn (defaults to `console.log` of a JSON line). Stable shape so
 * downstream tooling can parse it.
 */
export interface SponsorLogEntry {
  chainId: ChainId;
  /** Hex of the matched escrow ix discriminator, or null if validator rejected. */
  discriminator: string | null;
  /** Estimated fee in lamports, or null if validator rejected. */
  lamports: number | null;
  durationMs: number;
  outcome: "ok" | "validator_rejected" | "rpc_error";
  /** Present on non-ok outcomes. */
  reason?: string;
}

export interface SolanaGasStationDeps {
  chainId: ChainId;
  /** Loaded via `loadGasStationKeypair()` in production. */
  keypair: Keypair;
  /** Injected RPC submitter. GHB-175 wires this to a real `Connection`. */
  rpc: SolanaRpcSubmitter;
  /** Confirmation timeout in ms. Default 60_000 (60s). */
  confirmTimeoutMs?: number;
  /** Override the validator's fee cap. Default = `MAX_FEE_LAMPORTS`. */
  maxFeeLamports?: number;
  /** Logger override. Default writes one JSON line to stdout. */
  log?: (entry: SponsorLogEntry) => void;
}

export class SolanaGasStation implements GasStation {
  readonly chainId: ChainId;
  private readonly keypair: Keypair;
  private readonly rpc: SolanaRpcSubmitter;
  private readonly confirmTimeoutMs: number;
  private readonly maxFeeLamports: number | undefined;
  private readonly log: (entry: SponsorLogEntry) => void;

  constructor(deps: SolanaGasStationDeps) {
    if (deps.chainId !== "solana-devnet" && deps.chainId !== "solana-mainnet") {
      // Belt-and-suspenders: the type system already prevents this at
      // compile time, but constructor sites that cast (e.g. tests)
      // get a clear runtime error.
      throw new Error(
        `SolanaGasStation requires a Solana chainId, got: ${String(deps.chainId)}`,
      );
    }
    this.chainId = deps.chainId;
    this.keypair = deps.keypair;
    this.rpc = deps.rpc;
    this.confirmTimeoutMs = deps.confirmTimeoutMs ?? 60_000;
    this.maxFeeLamports = deps.maxFeeLamports;
    this.log = deps.log ?? defaultLog;
  }

  async sponsor(req: SponsorRequest): Promise<SponsorResult> {
    const start = Date.now();

    // Mismatch guards. The router (GHB-175) is responsible for
    // dispatching by chainId, but we double-check defensively — a
    // misrouted request should fail loud, not be silently sponsored.
    if (req.chainId !== this.chainId) {
      throw new GasStationError(
        "unsupported_chain",
        `SolanaGasStation chainId=${this.chainId} got request chainId=${req.chainId}`,
      );
    }
    if (req.payload.kind !== "solana") {
      throw new GasStationError(
        "validator_rejected",
        `payload.kind=${(req.payload as { kind: string }).kind} is not 'solana'`,
      );
    }

    // 1 + 2: decode and validate.
    const validation = validateSolanaSponsorTx(req.payload.partiallySignedTxB64, {
      expectedFeePayer: this.keypair.publicKey,
      ...(this.maxFeeLamports !== undefined && {
        maxFeeLamports: this.maxFeeLamports,
      }),
    });
    if (!validation.ok) {
      const reason = `${validation.code}: ${validation.reason}`;
      this.log({
        chainId: this.chainId,
        discriminator: null,
        lamports: null,
        durationMs: Date.now() - start,
        outcome: "validator_rejected",
        reason,
      });
      throw new GasStationError("validator_rejected", reason);
    }

    // 3: deserialize again and sign. The validator returns by-value
    // and doesn't expose the parsed tx — re-decoding costs <1ms and
    // keeps the validator's API clean (returning a tx would tempt
    // callers to mutate the validated object before signing).
    const tx = VersionedTransaction.deserialize(
      Buffer.from(req.payload.partiallySignedTxB64, "base64"),
    );
    tx.sign([this.keypair]);

    // 4: submit + confirm. Failures here are RPC-level (network,
    // preflight, expired blockhash, etc.) — never silent.
    let signature: string;
    try {
      signature = await this.rpc.send(tx.serialize());
      await this.rpc.confirm(signature, this.confirmTimeoutMs);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log({
        chainId: this.chainId,
        discriminator: validation.discriminatorHex,
        lamports: validation.estimatedFeeLamports,
        durationMs: Date.now() - start,
        outcome: "rpc_error",
        reason,
      });
      throw new GasStationError("rpc_error", reason);
    }

    const durationMs = Date.now() - start;
    this.log({
      chainId: this.chainId,
      discriminator: validation.discriminatorHex,
      lamports: validation.estimatedFeeLamports,
      durationMs,
      outcome: "ok",
    });

    return { txHash: signature, durationMs };
  }
}

function defaultLog(entry: SponsorLogEntry): void {
  // One JSON line — easy to grep, easy to feed to a log aggregator,
  // and zero extra deps. We can swap to pino later without touching
  // any consumer.
  // eslint-disable-next-line no-console
  console.log(`[gas-station] ${JSON.stringify(entry)}`);
}

/**
 * Build a `SolanaRpcSubmitter` backed by a real `Connection`. Used by:
 *   - The Next.js api route (GHB-175) at module-init time.
 *   - The devnet smoke script in `packages/shared/scripts/`.
 *
 * Two-pronged confirmation timeout: web3.js' built-in
 * expiry-by-blockheight, raced with a setTimeout to cap wall-clock
 * waits when the RPC stalls (the built-in can hang past `timeoutMs`
 * if blocks keep arriving but the leader doesn't include the tx).
 *
 * `commitment` defaults to `confirmed` — safe latency/finality
 * trade-off for sponsor flows. Pass `finalized` if you ever need
 * stronger guarantees (will roughly double the wall-clock cost).
 */
export function makeConnectionRpcSubmitter(
  connection: Connection,
  commitment: Commitment = "confirmed",
): SolanaRpcSubmitter {
  return {
    async send(rawTx) {
      return connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: commitment,
      });
    },
    async confirm(signature, timeoutMs) {
      const latest = await connection.getLatestBlockhash(commitment);
      const result = await Promise.race([
        connection.confirmTransaction(
          {
            signature,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          commitment,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(new Error(`confirmation timeout after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);
      if (result.value.err) {
        throw new Error(
          `tx errored on-chain: ${JSON.stringify(result.value.err)}`,
        );
      }
    },
  };
}

/**
 * Load the gas-station keypair from one of:
 *   1. `GAS_STATION_KEYPAIR_JSON` — raw JSON array of bytes (cloud-friendly:
 *      Vercel/Railway/Fly env-var-as-secret). Wins if set.
 *   2. `GAS_STATION_KEYPAIR_PATH` — file path on disk. `~` is expanded.
 *
 * Mirrors `loadScorerKeypair` in `relayer/src/config.ts`. The two keys
 * are deliberately distinct: blowing one doesn't blow the other.
 */
export function loadGasStationKeypair(): Keypair {
  const inlineJson = process.env.GAS_STATION_KEYPAIR_JSON?.trim();
  if (inlineJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(inlineJson);
    } catch (err) {
      throw new Error(
        `GAS_STATION_KEYPAIR_JSON is not valid JSON: ${(err as Error).message}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== "number")) {
      throw new Error(
        "GAS_STATION_KEYPAIR_JSON must be a JSON array of numbers (64 bytes)",
      );
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  }
  const keypairPath = process.env.GAS_STATION_KEYPAIR_PATH?.trim();
  if (!keypairPath) {
    throw new Error(
      "Missing gas-station keypair: set GAS_STATION_KEYPAIR_JSON or GAS_STATION_KEYPAIR_PATH",
    );
  }
  // Match the scorer loader's `~` handling — `fs.readFileSync` does
  // not expand it and a literal-tilde path silently ENOENTs.
  const expandedPath = keypairPath.startsWith("~")
    ? path.join(os.homedir(), keypairPath.slice(1))
    : keypairPath;
  const raw = JSON.parse(fs.readFileSync(expandedPath, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
