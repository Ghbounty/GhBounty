export function parseIssueUrl(url: string): { repo: string; issueNumber: number } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com") return null;
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!m) return null;
    return { repo: `${m[1]}/${m[2]}`, issueNumber: Number(m[3]) };
  } catch {
    return null;
  }
}

export function parseRepoUrl(url: string): { owner: string; repo: string; full: string } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repoRaw] = parts;
    const repo = repoRaw.replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return { owner, repo, full: `${owner}/${repo}` };
  } catch {
    return null;
  }
}

export function parsePrUrl(url: string): { repo: string; prNumber: number } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com") return null;
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return null;
    return { repo: `${m[1]}/${m[2]}`, prNumber: Number(m[3]) };
  } catch {
    return null;
  }
}
