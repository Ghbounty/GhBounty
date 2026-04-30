/**
 * Hand-rolled types for the Supabase schema in `relayer/drizzle/0001_app_identity.sql`.
 * Replace with `npx supabase gen types typescript --project-id ...` when CI is wired.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          // GHB-165: Privy DID (e.g. "did:privy:cm0abc...") or stringified
          // legacy Supabase-Auth UUID. No FK to auth.users anymore.
          user_id: string;
          role: "company" | "dev";
          // Optional now that Privy wallet-only logins start with no email.
          email: string | null;
          onboarding_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          role: "company" | "dev";
          email?: string | null;
          onboarding_completed?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      companies: {
        Row: {
          user_id: string;
          name: string;
          slug: string;
          description: string;
          website: string | null;
          industry: string | null;
          logo_url: string | null;
          github_org: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          name: string;
          slug: string;
          description: string;
          website?: string | null;
          industry?: string | null;
          logo_url?: string | null;
          github_org?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Insert"]>;
        Relationships: [];
      };
      developers: {
        Row: {
          user_id: string;
          username: string;
          github_handle: string | null;
          bio: string | null;
          skills: string[];
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          username: string;
          github_handle?: string | null;
          bio?: string | null;
          skills?: string[];
          avatar_url?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["developers"]["Insert"]>;
        Relationships: [];
      };
      wallets: {
        Row: {
          id: string;
          user_id: string;
          chain_id: string;
          address: string;
          is_treasury: boolean;
          is_payout: boolean;
          created_at: string;
        };
        Insert: {
          user_id: string;
          chain_id: string;
          address: string;
          is_treasury?: boolean;
          is_payout?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["wallets"]["Insert"]>;
        Relationships: [];
      };
      issues: {
        // bigint columns travel as strings over PostgREST.
        Row: {
          id: string;
          chain_id: string;
          pda: string;
          bounty_onchain_id: string;
          creator: string;
          scorer: string;
          mint: string;
          amount: string;
          state: "open" | "resolved" | "cancelled";
          submission_count: number;
          winner: string | null;
          github_issue_url: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          chain_id: string;
          pda: string;
          bounty_onchain_id: string;
          creator: string;
          scorer: string;
          mint: string;
          amount: string;
          state?: "open" | "resolved" | "cancelled";
          submission_count?: number;
          winner?: string | null;
          github_issue_url: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["issues"]["Insert"]>;
        Relationships: [];
      };
      submissions: {
        Row: {
          id: string;
          chain_id: string;
          issue_pda: string;
          pda: string;
          solver: string;
          submission_index: number;
          pr_url: string;
          opus_report_hash: string;
          tx_hash: string | null;
          state: "pending" | "scored" | "winner";
          created_at: string;
          scored_at: string | null;
        };
        // GHB-89: surface a real Insert shape so the dev SubmitPRModal can
        // post via PostgREST after `submit_solution` confirms.
        Insert: {
          id?: string;
          chain_id: string;
          issue_pda: string;
          pda: string;
          solver: string;
          submission_index: number;
          pr_url: string;
          opus_report_hash: string;
          tx_hash?: string | null;
          state?: "pending" | "scored" | "winner";
          created_at?: string;
          scored_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["submissions"]["Insert"]>;
        Relationships: [];
      };
      bounty_meta: {
        Row: {
          issue_id: string;
          title: string | null;
          description: string | null;
          release_mode: "auto" | "assisted";
          closed_by_user: boolean;
          created_by_user_id: string | null;
          // GHB-95
          reject_threshold: number | null;
          // GHB-98
          evaluation_criteria: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          issue_id: string;
          title?: string | null;
          description?: string | null;
          release_mode?: "auto" | "assisted";
          closed_by_user?: boolean;
          created_by_user_id?: string | null;
          reject_threshold?: number | null;
          evaluation_criteria?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["bounty_meta"]["Insert"]>;
        Relationships: [];
      };
      submission_meta: {
        Row: {
          submission_id: string;
          note: string | null;
          submitted_by_user_id: string | null;
          created_at: string;
        };
        Insert: {
          submission_id: string;
          note?: string | null;
          submitted_by_user_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["submission_meta"]["Insert"]>;
        Relationships: [];
      };
      chain_registry: {
        Row: {
          chain_id: string;
          name: string;
          rpc_url: string;
          escrow_address: string;
          explorer_url: string;
          token_symbol: string;
          x402_supported: boolean;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      user_role: "company" | "dev";
      release_mode: "auto" | "assisted";
      issue_state: "open" | "resolved" | "cancelled";
      submission_state: "pending" | "scored" | "winner";
      evaluation_source: "stub" | "opus" | "genlayer";
    };
    CompositeTypes: Record<never, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
