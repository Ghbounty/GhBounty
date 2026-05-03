#!/usr/bin/env node
/**
 * sandbox-runner.mjs — runs INSIDE a Fly sandbox machine.
 *
 * Reads SANDBOX_SPEC from env, fetches the target PR, detects the
 * test runner, installs deps, runs the tests, and emits a single
 * JSON line to stdout that the relayer parses.
 *
 * Pure node stdlib — no npm install in the image, no version drift.
 *
 * The detector logic is duplicated from
 *   relayer/src/sandbox/detector.ts
 * Keep it in sync. We can't `import` the TS module here because the
 * sandbox image has no bundler step; rewriting in pure JS is the
 * cheaper trade-off (~80 LOC duplicated, 0 build infrastructure).
 *
 * Output contract — the LAST line of stdout MUST be:
 *   __SANDBOX_RESULT__:<single-line JSON>
 * The relayer's executor scans logs for that prefix. Earlier stdout
 * lines are runner noise that we tail-truncate.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const WORK = "/work/repo";
const RESULT_PREFIX = "__SANDBOX_RESULT__:";
const TAIL_BYTES = 4096;
const SIGKILL_GRACE_MS = 5000;

// ── result emission ───────────────────────────────────────────────────

function emit(result) {
  // Final line of stdout. We always emit something so the relayer
  // never has to deal with a "no result" case — even infra failures
  // produce a parseable JSON line.
  process.stdout.write(`\n${RESULT_PREFIX}${JSON.stringify(result)}\n`);
}

function tail(buf) {
  const s = Buffer.isBuffer(buf) ? buf.toString("utf-8") : String(buf);
  return s.length > TAIL_BYTES ? s.slice(-TAIL_BYTES) : s;
}

function exitWith(result, code = 0) {
  emit(result);
  process.exit(code);
}

// ── parse + validate spec ─────────────────────────────────────────────

let spec;
try {
  spec = JSON.parse(process.env.SANDBOX_SPEC || "{}");
} catch (err) {
  exitWith({ status: "infra", reason: `bad SANDBOX_SPEC json: ${err.message}` }, 1);
}
if (!spec.repoUrl) exitWith({ status: "infra", reason: "spec.repoUrl required" }, 1);
if (!spec.baseRef) exitWith({ status: "infra", reason: "spec.baseRef required" }, 1);

const repoUrl = String(spec.repoUrl);
const baseRef = String(spec.baseRef);
const prNumber = Number.isFinite(Number(spec.prNumber)) ? Number(spec.prNumber) : null;
const customCommand = (spec.customCommand && String(spec.customCommand).trim()) || null;
const testTimeoutS = Number(spec.testTimeoutS) > 0 ? Number(spec.testTimeoutS) : 240;
const gitToken = spec.gitToken ? String(spec.gitToken) : null;

const startedAt = Date.now();
function elapsed() {
  return Date.now() - startedAt;
}

// ── git: fetch + checkout the PR head ────────────────────────────────

function git(args, cwd = WORK) {
  // Header-based auth keeps the token out of the URL (where it would
  // leak into git config / reflog). When no token, the array is empty
  // and git runs unauthenticated against the public repo.
  const auth = gitToken
    ? ["-c", `http.extraHeader=Authorization: Bearer ${gitToken}`]
    : [];
  const advice = ["-c", "advice.detachedHead=false"];
  return spawnSync("git", [...auth, ...advice, ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

fs.mkdirSync(WORK, { recursive: true });

let g = git(["init", "-q", "-b", baseRef], WORK);
if (g.status !== 0) {
  exitWith({
    status: "git_error",
    reason: `git init failed: ${tail(g.stderr)}`,
    durationMs: elapsed(),
  }, 1);
}

g = git(["remote", "add", "origin", repoUrl], WORK);
if (g.status !== 0) {
  exitWith({
    status: "git_error",
    reason: `git remote add failed: ${tail(g.stderr)}`,
    durationMs: elapsed(),
  }, 1);
}

// Fetch PR head when we have one, otherwise fetch the base ref. depth=1
// is enough — we only need the working tree, no history for testing.
//
// `pull/N/head` works for PRs from forks too: GitHub auto-creates the
// ref in the upstream repo when the PR is opened. No fork URL juggling.
const fetchRef = prNumber ? `pull/${prNumber}/head` : baseRef;
g = git(["fetch", "--depth=1", "origin", fetchRef], WORK);
if (g.status !== 0) {
  exitWith({
    status: "git_error",
    reason: `git fetch ${fetchRef} failed: ${tail(g.stderr)}`,
    durationMs: elapsed(),
  }, 1);
}

g = git(["checkout", "-q", "FETCH_HEAD"], WORK);
if (g.status !== 0) {
  exitWith({
    status: "git_error",
    reason: `git checkout failed: ${tail(g.stderr)}`,
    durationMs: elapsed(),
  }, 1);
}

// ── detect runner (mirror of detector.ts) ────────────────────────────

function fileExists(name) {
  try {
    return fs.statSync(path.join(WORK, name)).isFile();
  } catch {
    return false;
  }
}

function readJsonSafe(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(WORK, name), "utf-8"));
  } catch {
    return null;
  }
}

function detect() {
  if (customCommand) {
    return {
      kind: "custom",
      install: [],
      test: ["sh", "-c", customCommand],
      markers: ["custom_command"],
    };
  }
  if (fileExists("Anchor.toml")) {
    return { kind: "anchor", install: [], test: ["anchor", "test"], markers: ["Anchor.toml"] };
  }
  if (fileExists("foundry.toml")) {
    return { kind: "forge", install: [["forge", "install"]], test: ["forge", "test"], markers: ["foundry.toml"] };
  }
  if (fileExists("Cargo.toml")) {
    return { kind: "cargo", install: [], test: ["cargo", "test"], markers: ["Cargo.toml"] };
  }
  if (fileExists("go.mod")) {
    return {
      kind: "go",
      install: [["go", "mod", "download"]],
      test: ["go", "test", "./..."],
      markers: ["go.mod"],
    };
  }
  if (fileExists("package.json")) {
    const pkg = readJsonSafe("package.json");
    const test = pkg?.scripts?.test;
    if (test && !/no\s+test\s+specified/i.test(test)) {
      if (fileExists("pnpm-lock.yaml")) {
        return {
          kind: "pnpm",
          install: [["pnpm", "install", "--frozen-lockfile"]],
          test: ["pnpm", "test"],
          markers: ["package.json", "pnpm-lock.yaml"],
        };
      }
      if (fileExists("yarn.lock")) {
        return {
          kind: "yarn",
          install: [["yarn", "install", "--frozen-lockfile"]],
          test: ["yarn", "test"],
          markers: ["package.json", "yarn.lock"],
        };
      }
      // Use `npm ci` when a lockfile exists for reproducibility, fall
      // back to `npm install` when not — `npm ci` errors out without
      // a lockfile.
      const install = fileExists("package-lock.json") ? ["npm", "ci"] : ["npm", "install"];
      return {
        kind: "npm",
        install: [install],
        test: ["npm", "test"],
        markers: ["package.json"],
      };
    }
  }
  const pyMarkers = [
    "pyproject.toml",
    "pytest.ini",
    "setup.py",
    "tox.ini",
    "requirements.txt",
    "setup.cfg",
  ];
  const matched = pyMarkers.filter(fileExists);
  if (matched.length > 0) {
    // Pytest install heuristic: requirements.txt wins when present
    // (it's the most explicit dep declaration). Otherwise try `pip
    // install .` against the project root, which works for both
    // pyproject.toml + setup.py layouts.
    const install = fileExists("requirements.txt")
      ? [["pip", "install", "--break-system-packages", "-r", "requirements.txt"]]
      : [["pip", "install", "--break-system-packages", "."]];
    return { kind: "pytest", install, test: ["pytest"], markers: matched };
  }
  return null;
}

const runner = detect();
if (!runner) {
  exitWith({
    status: "no_runner",
    reason: "detector found no test runner markers in the repo",
    durationMs: elapsed(),
  }, 0);
}

// ── execute install steps + test command, single shared timeout ──────

let stdoutBuf = "";
let stderrBuf = "";

function bufferStdio(chunk, into) {
  // Ring-buffer trick — keep the last ~8 KB of each stream so we
  // don't OOM on chatty test runners (some npm libraries dump MB).
  const s = chunk.toString("utf-8");
  let combined = into() + s;
  if (combined.length > TAIL_BYTES * 2) {
    combined = combined.slice(-TAIL_BYTES * 2);
  }
  return combined;
}

function runChild(argv, label, deadlineMs) {
  return new Promise((resolve) => {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      resolve({ kind: "timeout", code: null, signal: null });
      return;
    }

    const child = spawn(argv[0], argv.slice(1), {
      cwd: WORK,
      stdio: ["ignore", "pipe", "pipe"],
      // CI=true flips many runners into non-interactive mode (no
      // colors, no progress spinners that bloat logs).
      env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
    });

    let killed = false;
    const killer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      // Give the child a moment to clean up; SIGKILL if it ignores us.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, SIGKILL_GRACE_MS);
    }, remaining);

    child.stdout.on("data", (c) => {
      stdoutBuf = bufferStdio(c, () => stdoutBuf);
      // Mirror the test runner's stdout to ours so `flyctl logs` shows
      // it live during the run (helpful for debugging stuck tests).
      process.stdout.write(`[${label}] ${c}`);
    });
    child.stderr.on("data", (c) => {
      stderrBuf = bufferStdio(c, () => stderrBuf);
      process.stderr.write(`[${label}] ${c}`);
    });
    child.on("error", (err) => {
      clearTimeout(killer);
      resolve({ kind: "spawn_error", message: err.message });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(killer);
      if (killed) {
        resolve({ kind: "timeout", code, signal });
      } else {
        resolve({ kind: "exited", code, signal });
      }
    });
  });
}

const deadlineMs = startedAt + testTimeoutS * 1000;

// Install phase — fail-fast if any install step errors. Without deps
// the tests will fail in confusing ways; better to surface the install
// failure cleanly.
for (const step of runner.install ?? []) {
  const res = await runChild(step, "install", deadlineMs);
  if (res.kind === "timeout") {
    exitWith({
      status: "timeout",
      phase: "install",
      runner: { kind: runner.kind, command: runner.test, markers: runner.markers },
      durationMs: elapsed(),
      stdoutTail: tail(stdoutBuf),
      stderrTail: tail(stderrBuf),
    }, 0);
  }
  if (res.kind === "spawn_error" || res.code !== 0) {
    exitWith({
      status: "install_error",
      phase: "install",
      reason: res.message ?? `install step exited ${res.code}`,
      runner: { kind: runner.kind, command: runner.test, markers: runner.markers },
      exitCode: res.code ?? null,
      durationMs: elapsed(),
      stdoutTail: tail(stdoutBuf),
      stderrTail: tail(stderrBuf),
    }, 0);
  }
}

// Test phase.
const testRes = await runChild(runner.test, "test", deadlineMs);
if (testRes.kind === "timeout") {
  exitWith({
    status: "timeout",
    phase: "test",
    runner: { kind: runner.kind, command: runner.test, markers: runner.markers },
    durationMs: elapsed(),
    stdoutTail: tail(stdoutBuf),
    stderrTail: tail(stderrBuf),
  }, 0);
}
if (testRes.kind === "spawn_error") {
  exitWith({
    status: "infra",
    phase: "test",
    reason: `test spawn failed: ${testRes.message}`,
    runner: { kind: runner.kind, command: runner.test, markers: runner.markers },
    durationMs: elapsed(),
  }, 1);
}

exitWith({
  status: "exited",
  phase: "test",
  runner: { kind: runner.kind, command: runner.test, markers: runner.markers },
  exitCode: testRes.code,
  signal: testRes.signal,
  durationMs: elapsed(),
  stdoutTail: tail(stdoutBuf),
  stderrTail: tail(stderrBuf),
}, 0);
