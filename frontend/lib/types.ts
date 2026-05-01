export type Role = "company" | "dev";

export type UserBase = {
  id: string;
  role: Role;
  email: string;
  wallet?: string;
  avatarUrl?: string;
  createdAt: number;
};

export type Company = UserBase & {
  role: "company";
  name: string;
  website?: string;
  industry?: string;
  description: string;
};

export type Dev = UserBase & {
  role: "dev";
  username: string;
  bio?: string;
  github?: string;
  skills: string[];
};

export type User = Company | Dev;

export type BountyStatus = "open" | "reviewing" | "approved" | "rejected" | "paid" | "closed";

export type ReleaseMode = "auto" | "assisted";

export type Bounty = {
  /**
   * Internal identifier. In the real Supabase backend this is `issues.id`
   * (a UUID); in the localStorage mock it's the bounty PDA. Always usable
   * as a stable React key + URL slug, never as a Solana address.
   */
  id: string;
  /**
   * On-chain bounty PDA (base58). Required to call `submit_solution` /
   * `resolve_bounty` / `cancel_bounty` against the right account.
   *
   * Optional only because the localStorage mock used to overload `id`
   * with the PDA — old mock rows survive without this field. In every
   * Supabase-backed path it's set.
   */
  pda?: string;
  companyId: string;
  repo: string;
  issueNumber: number;
  issueUrl: string;
  title?: string;
  amountUsdc: number;
  status: BountyStatus;
  releaseMode: ReleaseMode;
  createdAt: number;
};

export type SubmissionStatus = "pending" | "accepted" | "rejected";

export type Submission = {
  id: string;
  bountyId: string;
  devId: string;
  prUrl: string;
  prRepo: string;
  prNumber: number;
  note?: string;
  status: SubmissionStatus;
  createdAt: number;
};
