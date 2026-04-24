import type { Program } from "@coral-xyz/anchor";
import type { Connection, PublicKey } from "@solana/web3.js";

import { log } from "./logger.js";

export interface DecodedSubmission {
  pda: PublicKey;
  bounty: PublicKey;
  solver: PublicKey;
  submissionIndex: number;
  prUrl: string;
  opusReportHash: Uint8Array;
  score: number | null;
}

export type SubmissionHandler = (sub: DecodedSubmission) => Promise<void>;

function decode(program: Program, pubkey: PublicKey, data: Buffer): DecodedSubmission | null {
  try {
    const raw = (program.account as any).submission.coder.accounts.decode(
      "submission",
      data,
    );
    return {
      pda: pubkey,
      bounty: raw.bounty,
      solver: raw.solver,
      submissionIndex: raw.submissionIndex,
      prUrl: raw.prUrl,
      opusReportHash: Uint8Array.from(raw.opusReportHash),
      score: raw.score ?? null,
    };
  } catch (err) {
    log.debug("skipping non-submission account", {
      pubkey: pubkey.toBase58(),
      err: String(err),
    });
    return null;
  }
}

/**
 * Scan all program accounts once, decode the ones that are Submissions,
 * and run the handler for those with no score yet. Used on startup so
 * the relayer catches up on any submissions that arrived while it was
 * offline.
 */
export async function processBacklog(
  connection: Connection,
  program: Program,
  handler: SubmissionHandler,
): Promise<number> {
  log.info("scanning backlog...");
  const accounts = await connection.getProgramAccounts(program.programId, {
    commitment: "confirmed",
  });
  let processed = 0;
  for (const { pubkey, account } of accounts) {
    const decoded = decode(program, pubkey, account.data);
    if (!decoded || decoded.score !== null) continue;
    try {
      await handler(decoded);
      processed++;
    } catch (err) {
      log.error("backlog handler failed", {
        pda: pubkey.toBase58(),
        err: String(err),
      });
    }
  }
  log.info("backlog done", { scanned: accounts.length, processed });
  return processed;
}

/**
 * Subscribe to program-account changes and invoke the handler whenever a
 * Submission account appears that still has no score. Returns the
 * subscription id so callers can unsubscribe.
 */
export function watchSubmissions(
  connection: Connection,
  program: Program,
  handler: SubmissionHandler,
): number {
  const subId = connection.onProgramAccountChange(
    program.programId,
    async ({ accountId, accountInfo }) => {
      const decoded = decode(program, accountId, accountInfo.data);
      if (!decoded) return;
      if (decoded.score !== null) {
        log.debug("skipping already-scored submission", {
          pda: accountId.toBase58(),
          score: decoded.score,
        });
        return;
      }
      try {
        await handler(decoded);
      } catch (err) {
        log.error("live handler failed", {
          pda: accountId.toBase58(),
          err: String(err),
        });
      }
    },
    "confirmed",
  );
  log.info("subscribed to program account changes", { subId });
  return subId;
}
