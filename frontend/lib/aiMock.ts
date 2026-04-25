export type Complexity = "easy" | "medium" | "hard";

export type AnalyzedIssue = {
  id: string;
  issueNumber: number;
  title: string;
  complexity: Complexity;
  amount: number;
  included: boolean;
};

const ISSUE_TEMPLATES: { title: string; complexity: Complexity }[] = [
  { title: "Add TypeScript types to public API", complexity: "medium" },
  { title: "Fix race condition in connection pool", complexity: "hard" },
  { title: "Empty state for dashboard when no data", complexity: "easy" },
  { title: "Memory leak in long-running worker", complexity: "hard" },
  { title: "Improve error messages for 401 responses", complexity: "easy" },
  { title: "Flaky test in integration suite", complexity: "medium" },
  { title: "Support custom timeouts in HTTP client", complexity: "medium" },
  { title: "Retry with exponential backoff for RPC errors", complexity: "medium" },
  { title: "N+1 query in user listing endpoint", complexity: "medium" },
  { title: "Dark mode for settings page", complexity: "easy" },
  { title: "Breadcrumbs wrap incorrectly on mobile", complexity: "easy" },
  { title: "Upgrade transitive dependency xyz → 2.0", complexity: "easy" },
  { title: "Export table data as CSV", complexity: "medium" },
  { title: "Accent-insensitive search in global filter", complexity: "medium" },
  { title: "Accessibility: keyboard nav in command menu", complexity: "medium" },
  { title: "Validate email format on signup form", complexity: "easy" },
  { title: "Telemetry opt-out from user settings", complexity: "medium" },
  { title: "Parallel execution deadlock in scheduler", complexity: "hard" },
  { title: "Streaming tool-call parse bug", complexity: "hard" },
  { title: "WebGPU texture compression support", complexity: "hard" },
  { title: "Session token rotation on refresh", complexity: "hard" },
  { title: "i18n: externalize strings in auth flow", complexity: "medium" },
  { title: "Copy-to-clipboard toast positioning", complexity: "easy" },
  { title: "Dockerfile: multi-stage build with distroless", complexity: "medium" },
];

function randomAmount(c: Complexity): number {
  const [lo, hi] =
    c === "easy" ? [50, 200] : c === "medium" ? [250, 700] : [800, 2200];
  const raw = lo + Math.random() * (hi - lo);
  return Math.round(raw / 10) * 10;
}

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function analyzeRepo(): AnalyzedIssue[] {
  const count = 6 + Math.floor(Math.random() * 4); // 6–9 issues
  const pool = shuffled(ISSUE_TEMPLATES).slice(0, count);
  const usedNumbers = new Set<number>();
  return pool.map((t, i) => {
    let num: number;
    do {
      num = 100 + Math.floor(Math.random() * 9800);
    } while (usedNumbers.has(num));
    usedNumbers.add(num);
    return {
      id: `tmp_${i}_${num}`,
      issueNumber: num,
      title: t.title,
      complexity: t.complexity,
      amount: randomAmount(t.complexity),
      included: true,
    };
  });
}
