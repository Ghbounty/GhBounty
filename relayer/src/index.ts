import { Connection } from "@solana/web3.js";

import { analyzeSubmission } from "./analyzer.js";
import { loadConfig } from "./config.js";
import { log, setLogLevel } from "./logger.js";
import { createScorerClient } from "./scorer.js";
import { processBacklog, watchSubmissions, type DecodedSubmission } from "./watcher.js";

const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce(): Promise<never> {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);

  log.info("relayer starting", {
    rpcUrl: cfg.rpcUrl,
    wsUrl: cfg.wsUrl,
    programId: cfg.programId.toBase58(),
    scorer: cfg.scorerKeypair.publicKey.toBase58(),
    stubScore: cfg.stubScore,
  });

  const connection = new Connection(cfg.rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: cfg.wsUrl,
  });

  const client = createScorerClient(connection, cfg.scorerKeypair, cfg.programId);

  const handler = async (sub: DecodedSubmission): Promise<void> => {
    log.info("new submission detected", {
      submission: sub.pda.toBase58(),
      bounty: sub.bounty.toBase58(),
      solver: sub.solver.toBase58(),
      prUrl: sub.prUrl,
    });

    const { score } = await analyzeSubmission(
      {
        submissionPda: sub.pda.toBase58(),
        prUrl: sub.prUrl,
        opusReportHash: sub.opusReportHash,
      },
      cfg.stubScore,
    );

    await client.setScore(sub.bounty, sub.pda, score);
  };

  await processBacklog(connection, client.getProgram(), handler);
  watchSubmissions(connection, client.getProgram(), handler);

  // Keep the process alive; websocket subscription does its own work.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(60_000);
    log.debug("heartbeat");
  }
}

async function main(): Promise<void> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOnce();
    } catch (err) {
      attempt++;
      const delay = Math.min(BASE_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
      log.error("relayer loop crashed, retrying", {
        attempt,
        delayMs: delay,
        err: String(err),
      });
      await sleep(delay);
    }
  }
}

process.on("SIGINT", () => {
  log.info("received SIGINT, shutting down");
  process.exit(0);
});
process.on("SIGTERM", () => {
  log.info("received SIGTERM, shutting down");
  process.exit(0);
});

main().catch((err) => {
  log.error("fatal", { err: String(err) });
  process.exit(1);
});
