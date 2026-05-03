/**
 * GHB-71 — test runner detector.
 *
 * Inspects a cloned repo and decides which test runner to invoke.
 * Pure synchronous I/O against the local filesystem; no network, no
 * spawning. Designed to run BOTH inside the sandbox machine (after
 * the clone in GHB-72) and in the relayer for unit-testable previews.
 *
 * Decision tree (first match wins):
 *
 *   0. opts.customCommand     → kind=custom (company override, always wins)
 *   1. Anchor.toml            → anchor test
 *   2. foundry.toml           → forge test
 *   3. Cargo.toml             → cargo test
 *   4. go.mod                 → go test ./...
 *   5. package.json (with a real `test` script)
 *      ├─ pnpm-lock.yaml      → pnpm test
 *      ├─ yarn.lock           → yarn test
 *      └─ else                → npm test
 *   6. pyproject.toml | pytest.ini | setup.py | tox.ini | requirements.txt
 *                             → pytest
 *   7. nothing                → null  (caller falls through to GHB-73 path)
 *
 * Anchor wins over Cargo + package.json on purpose: an Anchor repo
 * usually has BOTH (Rust program + TS client tests) and `anchor test`
 * runs both pieces from the root. Picking one of the lower priorities
 * would skip half the suite.
 *
 * The `package.json` check ignores the npm-init placeholder
 * `"test": "echo \"Error: no test specified\" && exit 1"` so a repo
 * with a stub script falls through to lower-priority detection
 * (relevant when a Python repo also ships a frontend with a placeholder
 * package.json — pytest is what we actually want there).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { DetectOptions, RunnerKind, RunnerSpec } from "./types.js";

/**
 * Resolve a runner spec for the repo at `repoRoot`. Returns `null` when
 * no marker matches and no override is set — the caller (GHB-72) is
 * expected to surface that as a "no test results" outcome and let
 * GHB-73's fallback path take over.
 */
export function detectTestRunner(
  repoRoot: string,
  opts: DetectOptions = {},
): RunnerSpec | null {
  // Override path. We trust the company-supplied command and run it
  // through `sh -c` so the operator can use pipes, &&, env, etc.
  const custom = opts.customCommand?.trim();
  if (custom) {
    return {
      kind: "custom",
      command: ["sh", "-c", custom],
      cwd: "",
      markers: ["custom_command"],
    };
  }

  // Auto-detection in priority order. First match wins.
  const checks: Array<(root: string) => RunnerSpec | null> = [
    detectAnchor,
    detectForge,
    detectCargo,
    detectGo,
    detectNode,
    detectPython,
  ];
  for (const check of checks) {
    const spec = check(repoRoot);
    if (spec) return spec;
  }
  return null;
}

// ── individual detectors ───────────────────────────────────────────────

function detectAnchor(root: string): RunnerSpec | null {
  if (!fileExists(root, "Anchor.toml")) return null;
  return {
    kind: "anchor",
    command: ["anchor", "test"],
    cwd: "",
    markers: ["Anchor.toml"],
  };
}

function detectForge(root: string): RunnerSpec | null {
  if (!fileExists(root, "foundry.toml")) return null;
  return {
    kind: "forge",
    command: ["forge", "test"],
    cwd: "",
    markers: ["foundry.toml"],
  };
}

function detectCargo(root: string): RunnerSpec | null {
  if (!fileExists(root, "Cargo.toml")) return null;
  return {
    kind: "cargo",
    command: ["cargo", "test"],
    cwd: "",
    markers: ["Cargo.toml"],
  };
}

function detectGo(root: string): RunnerSpec | null {
  if (!fileExists(root, "go.mod")) return null;
  return {
    kind: "go",
    // ./... runs every package in the module recursively, which is
    // what every Go CI does by default.
    command: ["go", "test", "./..."],
    cwd: "",
    markers: ["go.mod"],
  };
}

function detectNode(root: string): RunnerSpec | null {
  if (!fileExists(root, "package.json")) return null;

  // Ignore stub `test` scripts so we fall through to better signals
  // (e.g. a sibling pytest repo). The default npm-init script is the
  // canonical one to filter out.
  const pkg = readJsonSafe(root, "package.json");
  const scripts = (pkg?.scripts ?? null) as Record<string, string> | null;
  const testScript = scripts?.test;
  if (!testScript || isPlaceholderTestScript(testScript)) return null;

  // Pick package manager based on lockfile presence. pnpm > yarn > npm
  // — order matters because some repos commit MULTIPLE lockfiles by
  // accident; we pick the most modern one available.
  if (fileExists(root, "pnpm-lock.yaml")) {
    return makeNodeSpec("pnpm", ["pnpm", "test"], ["package.json", "pnpm-lock.yaml"]);
  }
  if (fileExists(root, "yarn.lock")) {
    return makeNodeSpec("yarn", ["yarn", "test"], ["package.json", "yarn.lock"]);
  }
  return makeNodeSpec("npm", ["npm", "test"], ["package.json"]);
}

function detectPython(root: string): RunnerSpec | null {
  // Any of these signals "this is a Python project that probably uses
  // pytest". We deliberately don't try to detect unittest / nose —
  // pytest discovers `unittest.TestCase` classes too, so it's the
  // safest default and what the architecture doc specifies.
  const candidates = [
    "pyproject.toml",
    "pytest.ini",
    "setup.py",
    "tox.ini",
    "requirements.txt",
    "setup.cfg",
  ];
  const matched = candidates.filter((name) => fileExists(root, name));
  if (matched.length === 0) return null;
  return {
    kind: "pytest",
    command: ["pytest"],
    cwd: "",
    markers: matched,
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function fileExists(root: string, name: string): boolean {
  try {
    return fs.statSync(path.join(root, name)).isFile();
  } catch {
    return false;
  }
}

function readJsonSafe(root: string, name: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(path.join(root, name), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The `npm init` default script writes
 *   "test": "echo \"Error: no test specified\" && exit 1"
 * which is a non-test placeholder — running it would always fail with
 * exit 1 and give the developer a false-negative score. We treat it
 * the same as "no test script" and fall through.
 */
function isPlaceholderTestScript(s: string): boolean {
  return /no\s+test\s+specified/i.test(s);
}

function makeNodeSpec(
  kind: Extract<RunnerKind, "pnpm" | "yarn" | "npm">,
  command: string[],
  markers: string[],
): RunnerSpec {
  return { kind, command, cwd: "", markers };
}
