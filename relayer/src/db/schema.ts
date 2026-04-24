import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const issueStateEnum = pgEnum("issue_state", [
  "open",
  "resolved",
  "cancelled",
]);

export const submissionStateEnum = pgEnum("submission_state", [
  "pending",
  "scored",
  "winner",
]);

export const evaluationSourceEnum = pgEnum("evaluation_source", [
  "stub",
  "opus",
  "genlayer",
]);

export const chainRegistry = pgTable("chain_registry", {
  chainId: text("chain_id").primaryKey(),
  name: text("name").notNull(),
  rpcUrl: text("rpc_url").notNull(),
  escrowAddress: text("escrow_address").notNull(),
  explorerUrl: text("explorer_url").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  x402Supported: boolean("x402_supported").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const issues = pgTable("issues", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  chainId: text("chain_id")
    .notNull()
    .references(() => chainRegistry.chainId),
  pda: text("pda").notNull().unique(),
  bountyOnchainId: bigint("bounty_onchain_id", { mode: "bigint" }).notNull(),
  creator: text("creator").notNull(),
  scorer: text("scorer").notNull(),
  mint: text("mint").notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  state: issueStateEnum("state").notNull().default("open"),
  submissionCount: integer("submission_count").notNull().default(0),
  winner: text("winner"),
  githubIssueUrl: text("github_issue_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  chainId: text("chain_id")
    .notNull()
    .references(() => chainRegistry.chainId),
  issuePda: text("issue_pda").notNull(),
  pda: text("pda").notNull().unique(),
  solver: text("solver").notNull(),
  submissionIndex: integer("submission_index").notNull(),
  prUrl: text("pr_url").notNull(),
  opusReportHash: text("opus_report_hash").notNull(),
  txHash: text("tx_hash"),
  state: submissionStateEnum("state").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  scoredAt: timestamp("scored_at", { withTimezone: true }),
});

export const evaluations = pgTable("evaluations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  submissionPda: text("submission_pda").notNull(),
  source: evaluationSourceEnum("source").notNull(),
  score: smallint("score").notNull(),
  reasoning: text("reasoning"),
  retryCount: integer("retry_count").notNull().default(0),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});
