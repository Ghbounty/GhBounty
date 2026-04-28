import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Identity model (GHB-165)                                             */
/*                                                                      */
/* `profiles.user_id` is a free-form text column holding the user's     */
/* Privy DID (e.g. "did:privy:cm0abc..."). We do NOT FK to auth.users   */
/* anymore — Privy users are minted by our bridge route, not by         */
/* Supabase Auth, so they never appear in `auth.users`.                 */
/*                                                                      */
/* Legacy Supabase-auth UUIDs that predate this change still work:      */
/* migration 0006 cast them to text, and the columns remain unique.     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Enums                                                                */
/* ------------------------------------------------------------------ */

export const issueStateEnum = pgEnum("issue_state", [
  "open",
  "resolved",
  "cancelled",
]);

export const submissionStateEnum = pgEnum("submission_state", [
  "pending",
  "scored",
  "winner",
  "auto_rejected",
]);

export const evaluationSourceEnum = pgEnum("evaluation_source", [
  "stub",
  "opus",
  "genlayer",
]);

export const userRoleEnum = pgEnum("user_role", ["company", "dev"]);

export const releaseModeEnum = pgEnum("release_mode", ["auto", "assisted"]);

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
  // GHB-96: 1-based rank within the issue (score desc, ties by created_at asc).
  // Null until the submission is scored, or for auto_rejected submissions.
  rank: smallint("rank"),
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
  /**
   * Full structured Opus report (4 dimensions + summary). Null for stub
   * evaluations. Stored as JSONB so we can index dimensions later if needed.
   * The same JSON (canonicalized) is what feeds GenLayer's BountyJudge call.
   */
  report: jsonb("report"),
  /**
   * sha256 (hex) of canonical-JSON `report`. Matches `opusReportHash` stored
   * onchain at submission time. Empty string for stub evaluations.
   */
  reportHash: text("report_hash"),
  retryCount: integer("retry_count").notNull().default(0),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

/* ==================================================================
 * APP / IDENTITY LAYER
 *
 * The tables above (issues, submissions, evaluations, chain_registry)
 * mirror onchain state and are the source of truth for the relayer.
 * The tables below carry off-chain identity + UI metadata that the
 * frontend needs (profiles, branding, release modes, etc).
 *
 * Convention: any table here that links to an onchain entity does so
 * via a 1:1 FK ("*_meta" tables). The onchain rows stay untouched.
 * ================================================================== */

/* --- Profiles: 1:1 with the user's Privy DID (or legacy auth UUID) - */
export const profiles = pgTable("profiles", {
  // Privy DID like "did:privy:cm0abc..." or a stringified Supabase auth UUID
  // for legacy rows. No FK — Privy users live outside auth.users.
  userId: text("user_id").primaryKey(),
  role: userRoleEnum("role").notNull(),
  // Optional: Privy wallet-only logins start with no email; the user can
  // fill it in during onboarding. Unique still enforced via the index, so
  // empty values must remain NULL (never "").
  email: text("email").unique(),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

/* --- Companies: populated when profiles.role = 'company' -------- */
export const companies = pgTable("companies", {
  userId: text("user_id")
    .primaryKey()
    .references(() => profiles.userId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  website: text("website"),
  industry: text("industry"),
  logoUrl: text("logo_url"),
  githubOrg: text("github_org"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

/* --- Developers: populated when profiles.role = 'dev' ----------- */
export const developers = pgTable("developers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => profiles.userId, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  githubHandle: text("github_handle"),
  bio: text("bio"),
  skills: text("skills")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

/* --- Wallets: N:1 with profiles, multi-chain ready -------------- */
export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    chainId: text("chain_id")
      .notNull()
      .references(() => chainRegistry.chainId),
    address: text("address").notNull(),
    isTreasury: boolean("is_treasury").notNull().default(false),
    isPayout: boolean("is_payout").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    uniqueUserChainAddr: unique().on(t.userId, t.chainId, t.address),
    uniqueChainAddr: unique().on(t.chainId, t.address),
  }),
);

/* --- Bounty UI metadata: 1:1 with issues ------------------------ */
export const bountyMeta = pgTable("bounty_meta", {
  issueId: uuid("issue_id")
    .primaryKey()
    .references(() => issues.id, { onDelete: "cascade" }),
  title: text("title"),
  description: text("description"),
  releaseMode: releaseModeEnum("release_mode").notNull().default("auto"),
  // Whether the company explicitly closed it from the UI (vs onchain cancel)
  closedByUser: boolean("closed_by_user").notNull().default(false),
  // Link onchain creator wallet → user profile (when known)
  createdByUserId: text("created_by_user_id").references(
    () => profiles.userId,
    { onDelete: "set null" },
  ),
  // GHB-95: submissions scoring < this value are auto-rejected off-chain.
  // null = no auto-rejection (companies must triage every submission).
  rejectThreshold: smallint("reject_threshold"),
  // GHB-98: free-form evaluation criteria injected into the Opus prompt.
  // null/empty = relayer uses the default ("PR must address all
  // requirements, code clean and functional.").
  evaluationCriteria: text("evaluation_criteria"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

/* --- Submission UI metadata: 1:1 with submissions --------------- */
export const submissionMeta = pgTable("submission_meta", {
  submissionId: uuid("submission_id")
    .primaryKey()
    .references(() => submissions.id, { onDelete: "cascade" }),
  note: text("note"),
  submittedByUserId: text("submitted_by_user_id").references(
    () => profiles.userId,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});
