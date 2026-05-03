/**
 * Thin wrapper around `genlayer-js` for the relayer's BountyJudge
 * second-opinion flow.
 *
 * Why a wrapper:
 *   - The SDK's `writeContract` returns a tx hash but doesn't poll to
 *     a decided state. We poll here so the submission handler gets a
 *     synchronous answer (or a clean timeout) instead of having to
 *     thread async state across modules.
 *   - We collapse the SDK's Result enum to our 3 outcomes:
 *       success: contract returned a verdict (score persisted)
 *       error:   contract reverted (UserError, parse failure, etc.)
 *       timeout: poll deadline hit before consensus settled
 *     Anything else (UNDETERMINED after rotations exhausted) is
 *     reported as `error` with a descriptive message.
 *   - Centralized error handling so the handler can `try/catch` a
 *     single call instead of dealing with SDK-specific enums.
 *
 * Trust model: the relayer signs with its own GenLayer key
 * (env GENLAYER_PRIVATE_KEY). It does NOT use the company's or dev's
 * key — the GenLayer verdict is the relayer's claim, not theirs.
 */

import { createClient, createAccount } from "genlayer-js";
import type { GenLayerClient } from "genlayer-js/types";
import { localnet, studionet, testnetAsimov } from "genlayer-js/chains";

import { log } from "../logger.js";
import type { GenLayerConfig } from "../config.js";

/**
 * Outcome shape we hand back to the submission handler. Mirrors the
 * BountyJudge contract's storage triple (status / score / dimensions)
 * plus the SDK tx hash for audit.
 */
export interface BountyJudgeVerdict {
  outcome: "success";
  txHash: string;
  status: "passed" | "rejected_by_genlayer";
  score: number;
  dimensions: {
    code_quality: number;
    test_coverage: number;
    requirements_match: number;
    security: number;
  };
}

export interface BountyJudgeError {
  outcome: "error" | "timeout";
  txHash: string | null;
  message: string;
}

export type BountyJudgeResult = BountyJudgeVerdict | BountyJudgeError;

/**
 * Pick the right `genlayer-js` chain object from the configured RPC.
 * The SDK derives the chain id, fee account, etc. from this — passing
 * a custom endpoint via `endpoint` instead of `chain` works but skips
 * the chain config (consensus contract ABI) and is fragile, same
 * gotcha the CLI documents.
 */
function chainFromRpc(rpcUrl: string) {
  if (rpcUrl.includes("localhost") || rpcUrl.includes("127.0.0.1")) {
    return localnet;
  }
  if (rpcUrl.includes("studio.genlayer.com")) {
    return studionet;
  }
  if (rpcUrl.includes("asimov")) {
    return testnetAsimov;
  }
  // Fallback: the SDK accepts an unknown chain when we pass `endpoint`,
  // but we lose the consensus contract address. Log loudly so the
  // operator knows to add a chain alias if the network is real.
  log.warn("genlayer: unknown chain for RPC, defaulting to studionet", { rpcUrl });
  return studionet;
}

let cachedClient: GenLayerClient<ReturnType<typeof chainFromRpc>> | null = null;
let cachedFor: { rpc: string; pk: string } | null = null;

/**
 * Lazy-cache the SDK client so repeated submissions reuse the same
 * connection. The cache key is RPC + private key — change either and
 * we rebuild. Restart-safe: a new process always builds fresh.
 */
function getClient(cfg: GenLayerConfig) {
  if (!cfg.privateKey) {
    throw new Error("genlayer: private key not configured");
  }
  if (
    cachedClient &&
    cachedFor &&
    cachedFor.rpc === cfg.rpcUrl &&
    cachedFor.pk === cfg.privateKey
  ) {
    return cachedClient;
  }
  const account = createAccount(cfg.privateKey);
  cachedClient = createClient({
    chain: chainFromRpc(cfg.rpcUrl),
    endpoint: cfg.rpcUrl,
    account,
  });
  cachedFor = { rpc: cfg.rpcUrl, pk: cfg.privateKey };
  return cachedClient;
}

/**
 * Send `submit_evaluation(submissionId, narrativeReport)` to the
 * deployed BountyJudge contract and poll until the tx reaches a
 * decided state.
 *
 * Returns:
 *   - success verdict with score/dimensions when the contract wrote storage
 *   - error when the contract reverted (e.g. "already evaluated", LLM_ERROR)
 *   - timeout when consensus didn't settle inside `pollTimeoutS`
 *
 * Idempotent on `submissionId` from the contract side — if the same id
 * was already evaluated, we get an "already evaluated" error which the
 * caller can treat as a no-op.
 */
export async function submitToBountyJudge(
  cfg: GenLayerConfig,
  submissionId: string,
  narrativeReport: string,
): Promise<BountyJudgeResult> {
  if (!cfg.bountyJudgeContract || !cfg.privateKey) {
    return {
      outcome: "error",
      txHash: null,
      message: "genlayer: feature disabled (missing contract or key)",
    };
  }

  const client = getClient(cfg);
  const address = cfg.bountyJudgeContract as `0x${string}`;

  let txHash: string;
  try {
    txHash = await client.writeContract({
      address,
      functionName: "submit_evaluation",
      args: [submissionId, narrativeReport],
      value: 0n,
    });
  } catch (err) {
    return {
      outcome: "error",
      txHash: null,
      message: `submit_evaluation rejected: ${(err as Error).message}`,
    };
  }

  log.info("genlayer: submit_evaluation tx sent", { submissionId, txHash });

  // ── Polling strategy ──────────────────────────────────────────────────
  //
  // We treat the **contract storage** as ground truth, not the receipt
  // status. Reason: there's a race where the tx receipt flips to
  // ACCEPTED *before* validators execute the body and write storage,
  // so a `get_status` read in that window throws "not found" — and the
  // previous version of this poller treated that as a hard error,
  // returning fast with `genlayer: null` even though the verdict
  // landed seconds later. We empirically lost two real verdicts (PRs
  // #38 and #40) that way before adding this comment.
  //
  // New flow:
  //   1. Try `get_status(submission_id)` on every tick.
  //      → success: contract has the verdict → read everything + return
  //      → "not found": consensus hasn't written storage yet → keep polling
  //      → other error: log + treat as transient (don't return early)
  //   2. In parallel, watch the tx receipt for HARD-fail terminal states
  //      (UNDETERMINED, CANCELED). If we see one, fail fast — no point
  //      polling further.
  //   3. On overall timeout, do ONE final verdict read attempt before
  //      declaring failure. Storage may have landed in the last second.
  // ──────────────────────────────────────────────────────────────────────

  const deadline = Date.now() + cfg.pollTimeoutS * 1000;
  let lastReceiptStatus = "UNKNOWN";
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;

    // 1. Ground-truth check: read the contract state.
    try {
      const verdict = await readVerdict(client, address, submissionId);
      log.info("genlayer: verdict read from contract", {
        submissionId,
        attempts,
        score: verdict.score,
      });
      return { outcome: "success", txHash, ...verdict };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (!/not found/i.test(msg)) {
        // Real error — log and KEEP polling rather than bailing.
        // Studionet sometimes returns transient RPC errors mid-consensus
        // that resolve on the next tick. We only bail on hard receipt
        // terminal states (handled below).
        log.debug("genlayer: verdict read returned error, retrying", {
          submissionId,
          attempts,
          err: msg,
        });
      }
      // "not found" is the expected steady-state while consensus is
      // still settling. Fall through to the receipt check + sleep.
    }

    // 2. Receipt check — only used to short-circuit on confirmed failures.
    try {
      const receipt = await client.getTransaction({
        hash: txHash as unknown as `0x${string}` & { length: 66 },
      });
      const status = (receipt as unknown as { status?: string }).status ?? "PENDING";
      lastReceiptStatus = status;
      if (status === "UNDETERMINED" || status === "CANCELED") {
        return {
          outcome: "error",
          txHash,
          message: `consensus did not settle (status=${status})`,
        };
      }
    } catch (err) {
      // Receipt read failed — RPC blip. Don't bail; we'll retry next tick.
      log.debug("genlayer: getTransaction failed, retrying", {
        submissionId,
        txHash,
        err: String(err),
      });
    }

    await sleep(3000);
  }

  // 3. Last-chance read before declaring timeout. Storage may have just
  //    landed and we missed the window by a few hundred ms.
  try {
    const verdict = await readVerdict(client, address, submissionId);
    log.info("genlayer: verdict read on last-chance attempt", {
      submissionId,
      attempts,
      score: verdict.score,
    });
    return { outcome: "success", txHash, ...verdict };
  } catch {
    // Genuine timeout.
  }

  return {
    outcome: "timeout",
    txHash,
    message: `polling exceeded ${cfg.pollTimeoutS}s after ${attempts} ticks (last receipt status: ${lastReceiptStatus})`,
  };
}

/** Read get_status / get_score / get_dimensions in parallel. */
async function readVerdict(
  client: GenLayerClient<ReturnType<typeof chainFromRpc>>,
  address: `0x${string}`,
  submissionId: string,
): Promise<Omit<BountyJudgeVerdict, "outcome" | "txHash">> {
  const [statusRaw, scoreRaw, dimsRaw] = await Promise.all([
    client.readContract({
      address,
      functionName: "get_status",
      args: [submissionId],
    }),
    client.readContract({
      address,
      functionName: "get_score",
      args: [submissionId],
    }),
    client.readContract({
      address,
      functionName: "get_dimensions",
      args: [submissionId],
    }),
  ]);
  const status = String(statusRaw);
  if (status !== "passed" && status !== "rejected_by_genlayer") {
    throw new Error(`unexpected status from contract: ${status}`);
  }
  const score = Number(scoreRaw);
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw new Error(`unexpected score from contract: ${scoreRaw}`);
  }
  const d = dimsRaw as Record<string, unknown>;
  const dims = {
    code_quality: Number(d.code_quality),
    test_coverage: Number(d.test_coverage),
    requirements_match: Number(d.requirements_match),
    security: Number(d.security),
  };
  for (const [k, v] of Object.entries(dims)) {
    if (!Number.isInteger(v) || v < 1 || v > 10) {
      throw new Error(`unexpected ${k} from contract: ${v}`);
    }
  }
  return {
    status: status as "passed" | "rejected_by_genlayer",
    score,
    dimensions: dims,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
