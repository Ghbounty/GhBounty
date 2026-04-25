import type { Bounty, Company, Dev, Submission, User } from "./types";

const USERS_KEY = "ghb.users";
const BOUNTIES_KEY = "ghb.bounties";
const SUBMISSIONS_KEY = "ghb.submissions";
const SESSION_KEY = "ghb.session";
const SEEDED_KEY = "ghb.seeded";

const isClient = () => typeof window !== "undefined";

function read<T>(key: string, fallback: T): T {
  if (!isClient()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (!isClient()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadUsers(): User[] {
  return read<User[]>(USERS_KEY, []);
}

export function saveUsers(users: User[]) {
  write(USERS_KEY, users);
}

export function loadBounties(): Bounty[] {
  const raw = read<Bounty[]>(BOUNTIES_KEY, []);
  // backfill releaseMode for legacy records
  let mutated = false;
  const migrated = raw.map((b) => {
    if (!b.releaseMode) {
      mutated = true;
      return { ...b, releaseMode: "auto" as const };
    }
    return b;
  });
  if (mutated) saveBounties(migrated);
  return migrated;
}

export function saveBounties(bounties: Bounty[]) {
  write(BOUNTIES_KEY, bounties);
}

export function getSession(): string | null {
  if (!isClient()) return null;
  return localStorage.getItem(SESSION_KEY);
}

export function setSession(userId: string | null) {
  if (!isClient()) return;
  if (userId) localStorage.setItem(SESSION_KEY, userId);
  else localStorage.removeItem(SESSION_KEY);
}

export function getCurrentUser(): User | null {
  const id = getSession();
  if (!id) return null;
  return loadUsers().find((u) => u.id === id) ?? null;
}

export function upsertUser(user: User) {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  saveUsers(users);
}

export function findUserByEmail(email: string): User | null {
  return loadUsers().find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export function addBounty(b: Bounty) {
  const all = loadBounties();
  all.unshift(b);
  saveBounties(all);
}

export function updateBounty(id: string, patch: Partial<Bounty>) {
  const all = loadBounties();
  const idx = all.findIndex((b) => b.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch };
  saveBounties(all);
}

export function closeBounty(id: string) {
  updateBounty(id, { status: "closed" });
}

export function deleteBounty(id: string) {
  saveBounties(loadBounties().filter((b) => b.id !== id));
  // also remove any submissions pointing to it
  saveSubmissions(loadSubmissions().filter((s) => s.bountyId !== id));
}

export function bountiesByCompany(companyId: string): Bounty[] {
  return loadBounties().filter((b) => b.companyId === companyId);
}

export function loadSubmissions(): Submission[] {
  return read<Submission[]>(SUBMISSIONS_KEY, []);
}

export function saveSubmissions(items: Submission[]) {
  write(SUBMISSIONS_KEY, items);
}

export function submissionsByDev(devId: string): Submission[] {
  return loadSubmissions().filter((s) => s.devId === devId);
}

export function submissionsByBounty(bountyId: string): Submission[] {
  return loadSubmissions().filter((s) => s.bountyId === bountyId);
}

export function hasDevSubmitted(devId: string, bountyId: string): boolean {
  return loadSubmissions().some(
    (s) => s.devId === devId && s.bountyId === bountyId
  );
}

export function addSubmission(s: Submission) {
  const all = loadSubmissions();
  all.unshift(s);
  saveSubmissions(all);
  // auto-flip bounty from open → reviewing on first submission
  updateBounty(s.bountyId, { status: "reviewing" });
}

export function updateSubmission(id: string, patch: Partial<Submission>) {
  const all = loadSubmissions();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch };
  saveSubmissions(all);
}

export function uid(prefix = "u"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/* --------- seed data --------- */
export function ensureSeeded() {
  if (!isClient()) return;
  if (localStorage.getItem(SEEDED_KEY) === "1") return;

  const now = Date.now();
  const companies: Company[] = [
    {
      id: "c_avalabs",
      role: "company",
      email: "builders@avalabs.org",
      name: "Ava Labs",
      website: "https://avalabs.org",
      industry: "L1 / Infra",
      description:
        "Builders of Avalanche. Sponsoring open-source contributions to the builders-hub and core SDKs.",
      avatarUrl:
        "https://avatars.githubusercontent.com/u/77478048?s=200&v=4",
      wallet: "0x19eC9a1dDf0c7E8c5aB5C7f1F2CdC31a8f1a25cb",
      createdAt: now - 1000 * 60 * 60 * 24 * 30,
    },
    {
      id: "c_vercel",
      role: "company",
      email: "oss@vercel.com",
      name: "Vercel",
      website: "https://vercel.com",
      industry: "Developer tools",
      description:
        "Frontend cloud. Funding Next.js, Turbopack and AI SDK contributions.",
      avatarUrl:
        "https://avatars.githubusercontent.com/u/14985020?s=200&v=4",
      wallet: "0x2c8a18Ac4a6F24dF4c7B4E02fA9b3d71c9aEb4d1",
      createdAt: now - 1000 * 60 * 60 * 24 * 22,
    },
    {
      id: "c_solana",
      role: "company",
      email: "grants@solana.org",
      name: "Solana Foundation",
      website: "https://solana.org",
      industry: "L1 / Infra",
      description:
        "Supporting the Solana ecosystem with open bounties across SDKs, tooling and DeFi.",
      avatarUrl:
        "https://avatars.githubusercontent.com/u/35608259?s=200&v=4",
      wallet: "0x8bD4aC9dF2c16E87113a3F9cDfe27cE0fF5eEa10",
      createdAt: now - 1000 * 60 * 60 * 24 * 45,
    },
    {
      id: "c_langchain",
      role: "company",
      email: "bounties@langchain.dev",
      name: "LangChain",
      website: "https://www.langchain.com",
      industry: "AI Infra",
      description:
        "Open-source AI application stack. Paying for agent, memory and integration fixes.",
      avatarUrl:
        "https://avatars.githubusercontent.com/u/126733545?s=200&v=4",
      wallet: "0xAe55B0e2d3e9fF1d23e77BcA9C7c73cD96E24Cc0",
      createdAt: now - 1000 * 60 * 60 * 24 * 12,
    },
  ];

  const devs: Dev[] = [
    {
      id: "d_demo",
      role: "dev",
      email: "dev@ghbounty.xyz",
      username: "opus-builder",
      bio: "Rust + TS contributor. I like refactors.",
      github: "opus-builder",
      skills: ["rust", "typescript", "solana"],
      avatarUrl: "https://avatars.githubusercontent.com/u/9919?s=200&v=4",
      wallet: "0x3f7cD7c0b2D35a60fB18CFC6ecE5f0bA1af7a120",
      createdAt: now - 1000 * 60 * 60 * 24 * 9,
    },
  ];

  const bounties: Bounty[] = [
    {
      id: "b_01",
      companyId: "c_avalabs",
      repo: "ava-labs/builders-hub",
      issueNumber: 3946,
      issueUrl: "https://github.com/ava-labs/builders-hub/issues/3946",
      title: "Add L1 dashboard empty state",
      amountUsdc: 150,
      status: "open",
      releaseMode: "auto",
      createdAt: now - 1000 * 60 * 60 * 24 * 3,
    },
    {
      id: "b_02",
      companyId: "c_avalabs",
      repo: "ava-labs/avalanchego",
      issueNumber: 2410,
      issueUrl: "https://github.com/ava-labs/avalanchego/issues/2410",
      title: "Flaky test in networking/peer_test.go",
      amountUsdc: 320,
      status: "reviewing",
      releaseMode: "assisted",
      createdAt: now - 1000 * 60 * 60 * 24 * 5,
    },
    {
      id: "b_03",
      companyId: "c_vercel",
      repo: "vercel/next.js",
      issueNumber: 70012,
      issueUrl: "https://github.com/vercel/next.js/issues/70012",
      title: "Support async generators in server actions",
      amountUsdc: 2500,
      status: "open",
      releaseMode: "assisted",
      createdAt: now - 1000 * 60 * 60 * 24 * 2,
    },
    {
      id: "b_04",
      companyId: "c_vercel",
      repo: "vercel/ai",
      issueNumber: 1820,
      issueUrl: "https://github.com/vercel/ai/issues/1820",
      title: "Fix streaming tool-call parse on Anthropic provider",
      amountUsdc: 600,
      status: "paid",
      releaseMode: "auto",
      createdAt: now - 1000 * 60 * 60 * 24 * 16,
    },
    {
      id: "b_05",
      companyId: "c_solana",
      repo: "solana-labs/web3.js",
      issueNumber: 2910,
      issueUrl: "https://github.com/solana-labs/web3.js/issues/2910",
      title: "Add retry logic to RPC client",
      amountUsdc: 420,
      status: "open",
      releaseMode: "auto",
      createdAt: now - 1000 * 60 * 60 * 24 * 1,
    },
    {
      id: "b_06",
      companyId: "c_langchain",
      repo: "langchain-ai/langchain",
      issueNumber: 25880,
      issueUrl: "https://github.com/langchain-ai/langchain/issues/25880",
      title: "Fix memory leak in agent executor",
      amountUsdc: 1200,
      status: "reviewing",
      releaseMode: "assisted",
      createdAt: now - 1000 * 60 * 60 * 24 * 4,
    },
    {
      id: "b_07",
      companyId: "c_langchain",
      repo: "langchain-ai/langgraph",
      issueNumber: 1812,
      issueUrl: "https://github.com/langchain-ai/langgraph/issues/1812",
      title: "Parallel node execution deadlock",
      amountUsdc: 900,
      status: "approved",
      releaseMode: "assisted",
      createdAt: now - 1000 * 60 * 60 * 24 * 7,
    },
  ];

  saveUsers([...companies, ...devs]);
  saveBounties(bounties);
  localStorage.setItem(SEEDED_KEY, "1");
}

export function signOut() {
  setSession(null);
}

export function mockWallet(): string {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 40; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

export function setWallet(userId: string, wallet: string | undefined) {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx < 0) return;
  users[idx] = { ...users[idx], wallet };
  saveUsers(users);
}
