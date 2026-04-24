import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  chainRegistry,
  evaluations,
  issues,
  submissions,
} from "./schema.js";

export interface ChainSeed {
  chainId: string;
  name: string;
  rpcUrl: string;
  escrowAddress: string;
  explorerUrl: string;
  tokenSymbol: string;
  x402Supported?: boolean;
}

export async function seedChain(db: Db, chain: ChainSeed): Promise<void> {
  await db
    .insert(chainRegistry)
    .values({
      chainId: chain.chainId,
      name: chain.name,
      rpcUrl: chain.rpcUrl,
      escrowAddress: chain.escrowAddress,
      explorerUrl: chain.explorerUrl,
      tokenSymbol: chain.tokenSymbol,
      x402Supported: chain.x402Supported ?? false,
    })
    .onConflictDoUpdate({
      target: chainRegistry.chainId,
      set: {
        name: chain.name,
        rpcUrl: chain.rpcUrl,
        escrowAddress: chain.escrowAddress,
        explorerUrl: chain.explorerUrl,
        tokenSymbol: chain.tokenSymbol,
        x402Supported: chain.x402Supported ?? false,
      },
    });
}

export interface UpsertSubmissionInput {
  chainId: string;
  issuePda: string;
  submissionPda: string;
  solver: string;
  submissionIndex: number;
  prUrl: string;
  opusReportHashHex: string;
  txHash?: string;
}

export async function upsertSubmission(
  db: Db,
  input: UpsertSubmissionInput,
): Promise<void> {
  await db
    .insert(submissions)
    .values({
      chainId: input.chainId,
      issuePda: input.issuePda,
      pda: input.submissionPda,
      solver: input.solver,
      submissionIndex: input.submissionIndex,
      prUrl: input.prUrl,
      opusReportHash: input.opusReportHashHex,
      txHash: input.txHash,
      state: "pending",
    })
    .onConflictDoNothing({ target: submissions.pda });
}

export async function markScored(
  db: Db,
  submissionPda: string,
): Promise<void> {
  await db
    .update(submissions)
    .set({
      state: "scored",
      scoredAt: sql`now()`,
    })
    .where(sql`${submissions.pda} = ${submissionPda}`);
}

export interface InsertEvaluationInput {
  submissionPda: string;
  source: "stub" | "opus" | "genlayer";
  score: number;
  reasoning?: string;
  retryCount?: number;
  txHash?: string;
}

export async function insertEvaluation(
  db: Db,
  input: InsertEvaluationInput,
): Promise<void> {
  await db.insert(evaluations).values({
    submissionPda: input.submissionPda,
    source: input.source,
    score: input.score,
    reasoning: input.reasoning,
    retryCount: input.retryCount ?? 0,
    txHash: input.txHash,
  });
}

export async function issueExists(db: Db, pda: string): Promise<boolean> {
  const rows = await db
    .select({ pda: issues.pda })
    .from(issues)
    .where(sql`${issues.pda} = ${pda}`)
    .limit(1);
  return rows.length > 0;
}
