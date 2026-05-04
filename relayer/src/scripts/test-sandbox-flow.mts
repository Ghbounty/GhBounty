/**
 * GHB-73 E2E smoke (option B from the chat): runs the full
 * submission-handler pipeline against a real Fly sandbox + a real
 * public PR, but with the DB, scorer, and analyzer all mocked.
 *
 * What this validates END-TO-END:
 *   - Config loads (FLY_API_TOKEN + FLY_SANDBOX_APP from .env)
 *   - PR URL parsing → SandboxSpec build
 *   - runSandboxedTests against real Fly machines.dev
 *   - Result mapping: ExecutorResult → PromptTestResult (or null)
 *   - The exact testResult shape that gets handed to the analyzer (Sonnet)
 *
 * What it does NOT exercise:
 *   - Solana RPC (scorer is a no-op, returns a fake tx hash)
 *   - Postgres (db = null, all queries skipped)
 *   - Anthropic billing (analyze is a stub that captures + prints input)
 *   - GenLayer (genlayer = null in deps)
 *
 * Run with:
 *   pnpm --filter @ghbounty/relayer exec tsx \
 *     src/scripts/test-sandbox-flow.mts [--pr=https://github.com/owner/repo/pull/N]
 *
 * Default PR is pallets/markupsafe#1 (small Python repo with pytest,
 * runs in ~10 s after the sandbox is spawned).
 *
 * Expected output: a "TEST RESULT FOR SONNET" block at the end with
 * the PromptTestResult shape — runner kind, status, durationMs, etc.
 * If you see "null", the sandbox failed and the prompt would tell
 * Sonnet "no test results available" (GHB-73 fallback path).
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ override: true, quiet: true });

import { Keypair, PublicKey } from "@solana/web3.js";

import type { AnalyzeInput, AnalyzeResult, AnalyzerOptions } from "../analyzer.js";
import { loadConfig } from "../config.js";
import { log, setLogLevel } from "../logger.js";
import { handleSubmission } from "../submission-handler.js";
import type { DecodedSubmission } from "../watcher.js";

const DEFAULT_PR = "https://github.com/pallets/markupsafe/pull/1";

function parseArgs(): { prUrl: string } {
  const arg = process.argv.find((a) => a.startsWith("--pr="));
  return { prUrl: arg ? arg.slice("--pr=".length) : DEFAULT_PR };
}

async function main(): Promise<void> {
  const { prUrl } = parseArgs();

  // Always debug-log so the user sees the sandbox lifecycle (machine
  // create / poll / result fetch) and our handler's structured logs.
  setLogLevel("debug");

  const cfg = loadConfig();

  if (!cfg.sandbox.apiToken || !cfg.sandbox.appName) {
    console.error(
      "\nERROR: sandbox not configured. Set FLY_API_TOKEN + FLY_SANDBOX_APP\n" +
        "in relayer/.env and try again.\n",
    );
    process.exit(1);
  }

  console.log("\n=== GHB-73 E2E sandbox smoke ===");
  console.log(`PR under test : ${prUrl}`);
  console.log(`Fly app       : ${cfg.sandbox.appName}`);
  console.log(`Fly image     : ${cfg.sandbox.image}`);
  console.log(`Fly region    : ${cfg.sandbox.region}`);
  console.log(`Inner timeout : ${cfg.sandbox.timeoutS}s`);
  console.log("");

  // Capture what the analyzer (Sonnet) WOULD have seen, so the user
  // can confirm the testResult was wired correctly. We don't actually
  // call the LLM — return a fixed shape that the handler accepts.
  // TS doesn't track that the spy closure mutates this — annotate
  // explicitly so the post-await read sees the union type.
  let capturedAnalyzeInput = null as AnalyzeInput | null;
  const spyAnalyze = async (
    input: AnalyzeInput,
    _opts: AnalyzerOptions,
  ): Promise<AnalyzeResult> => {
    capturedAnalyzeInput = input;
    return {
      score: 7,
      source: "stub",
      reasoning: "stub analyze (sandbox smoke script)",
      report: null,
      reportHash: "",
    };
  };

  const fakeSub: DecodedSubmission = buildFakeSubmission(prUrl);

  await handleSubmission(fakeSub, {
    db: null,
    scorer: { setScore: async () => "fake-tx-hash" },
    chainId: cfg.chainId,
    stubScore: cfg.stubScore,
    anthropicApiKey: null,
    anthropicModel: cfg.anthropicModel,
    genlayer: null, // skip the second-opinion call for this smoke
    sandbox: cfg.sandbox,
    analyze: spyAnalyze,
  });

  // Final report: what the handler ACTUALLY would have fed Sonnet.
  console.log("\n=== TEST RESULT FOR SONNET ===");
  if (!capturedAnalyzeInput) {
    console.log("(analyzer was never called — handler aborted earlier)");
  } else if (capturedAnalyzeInput.testResult == null) {
    console.log(
      "testResult: null  →  Sonnet would see the 'no test results available'\n" +
        "fallback prompt section (GHB-73 fallback path).",
    );
  } else {
    console.log(JSON.stringify(capturedAnalyzeInput.testResult, null, 2));
  }
  console.log("");
  process.exit(0);
}

/**
 * Build a `DecodedSubmission` that the handler accepts. Most fields
 * don't matter for this smoke — they'd land in the DB/Solana paths,
 * which we've stubbed. Only `prUrl` is functionally significant.
 */
function buildFakeSubmission(prUrl: string): DecodedSubmission {
  const fakePda = Keypair.generate().publicKey;
  const fakeBounty = Keypair.generate().publicKey;
  const fakeSolver = Keypair.generate().publicKey;
  return {
    pda: fakePda,
    bounty: fakeBounty,
    solver: fakeSolver,
    submissionIndex: 0,
    prUrl,
    opusReportHash: new Uint8Array(32),
  } as unknown as DecodedSubmission;
}

main().catch((err) => {
  log.error("sandbox smoke failed", { err: String(err) });
  process.exit(1);
});

// Silence the "DecodedSubmission is unused if you don't import it" linter
// in case a future refactor moves the type — defensive re-export.
export type { DecodedSubmission, PublicKey };
