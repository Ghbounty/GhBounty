CREATE TYPE "public"."agent_role" AS ENUM('company', 'dev');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('pending_oauth', 'pending_stake', 'active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."evaluation_source" AS ENUM('stub', 'opus', 'genlayer');--> statement-breakpoint
CREATE TYPE "public"."issue_state" AS ENUM('open', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."release_mode" AS ENUM('auto', 'assisted');--> statement-breakpoint
CREATE TYPE "public"."stake_status" AS ENUM('active', 'frozen', 'slashed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."submission_state" AS ENUM('pending', 'scored', 'winner', 'auto_rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('company', 'dev');--> statement-breakpoint
CREATE TABLE "agent_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_pubkey" text NOT NULL,
	"github_handle" text,
	"github_oauth_token_encrypted" text,
	"role" "agent_role" NOT NULL,
	"status" "agent_status" DEFAULT 'pending_oauth' NOT NULL,
	"warnings" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_accounts_wallet_pubkey_unique" UNIQUE("wallet_pubkey"),
	CONSTRAINT "agent_accounts_github_handle_unique" UNIQUE("github_handle")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_account_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounty_meta" (
	"issue_id" uuid PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"release_mode" "release_mode" DEFAULT 'auto' NOT NULL,
	"closed_by_user" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"reject_threshold" smallint,
	"evaluation_criteria" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_registry" (
	"chain_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rpc_url" text NOT NULL,
	"escrow_address" text NOT NULL,
	"explorer_url" text NOT NULL,
	"token_symbol" text NOT NULL,
	"x402_supported" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"user_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"website" text,
	"industry" text,
	"logo_url" text,
	"github_org" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "developers" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"github_handle" text,
	"bio" text,
	"skills" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developers_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_pda" text NOT NULL,
	"source" "evaluation_source" NOT NULL,
	"score" smallint NOT NULL,
	"reasoning" text,
	"report" jsonb,
	"report_hash" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"tx_hash" text,
	"genlayer_score" smallint,
	"genlayer_status" text,
	"genlayer_dimensions" jsonb,
	"genlayer_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"pda" text NOT NULL,
	"bounty_onchain_id" bigint NOT NULL,
	"creator" text NOT NULL,
	"scorer" text NOT NULL,
	"mint" text NOT NULL,
	"amount" bigint NOT NULL,
	"state" "issue_state" DEFAULT 'open' NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"winner" text,
	"github_issue_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_pda_unique" UNIQUE("pda")
);
--> statement-breakpoint
CREATE TABLE "pending_txs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_account_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"resource_id" text,
	"message_hash" text NOT NULL,
	"expected_signer" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" "user_role" NOT NULL,
	"email" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "slashing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_account_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"severity" smallint NOT NULL,
	"evidence" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stake_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_account_id" uuid NOT NULL,
	"pda" text NOT NULL,
	"tx_signature" text NOT NULL,
	"amount_lamports" bigint NOT NULL,
	"status" "stake_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"refunded_at" timestamp with time zone,
	"slashed_at" timestamp with time zone,
	CONSTRAINT "stake_deposits_pda_unique" UNIQUE("pda")
);
--> statement-breakpoint
CREATE TABLE "submission_meta" (
	"submission_id" uuid PRIMARY KEY NOT NULL,
	"note" text,
	"submitted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" text NOT NULL,
	"issue_pda" text NOT NULL,
	"pda" text NOT NULL,
	"solver" text NOT NULL,
	"submission_index" integer NOT NULL,
	"pr_url" text NOT NULL,
	"opus_report_hash" text NOT NULL,
	"tx_hash" text,
	"state" "submission_state" DEFAULT 'pending' NOT NULL,
	"rank" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scored_at" timestamp with time zone,
	CONSTRAINT "submissions_pda_unique" UNIQUE("pda")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"chain_id" text NOT NULL,
	"address" text NOT NULL,
	"is_treasury" boolean DEFAULT false NOT NULL,
	"is_payout" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_chain_id_address_unique" UNIQUE("user_id","chain_id","address"),
	CONSTRAINT "wallets_chain_id_address_unique" UNIQUE("chain_id","address")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_account_id_agent_accounts_id_fk" FOREIGN KEY ("agent_account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_meta" ADD CONSTRAINT "bounty_meta_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bounty_meta" ADD CONSTRAINT "bounty_meta_created_by_user_id_profiles_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developers" ADD CONSTRAINT "developers_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_chain_id_chain_registry_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_txs" ADD CONSTRAINT "pending_txs_agent_account_id_agent_accounts_id_fk" FOREIGN KEY ("agent_account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slashing_events" ADD CONSTRAINT "slashing_events_agent_account_id_agent_accounts_id_fk" FOREIGN KEY ("agent_account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stake_deposits" ADD CONSTRAINT "stake_deposits_agent_account_id_agent_accounts_id_fk" FOREIGN KEY ("agent_account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_meta" ADD CONSTRAINT "submission_meta_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_meta" ADD CONSTRAINT "submission_meta_submitted_by_user_id_profiles_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_chain_id_chain_registry_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_chain_id_chain_registry_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chain_registry"("chain_id") ON DELETE no action ON UPDATE no action;