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
  id: string;
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
