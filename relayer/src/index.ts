import { Connection } from "@solana/web3.js";

import { analyzeSubmission } from "./analyzer.js";
import { loadConfig } from "./config.js";
import { createDb, type Db } from "@ghbounty/db";
import {
  insertEvaluation,
  markScored,
  seedChain,
  upsertSubmission,
} from "./db/ops.js";
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
    anthropic: cfg.anthropicApiKey
      ? { enabled: true, model: cfg.anthropicModel }
      : { enabled: false },
  });

  const connection = new Connection(cfg.rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: cfg.wsUrl,
  });

  const client = createScorerClient(connection, cfg.scorerKeypair, cfg.programId);

  let db: Db | null = null;
  if (cfg.databaseUrl) {
    db = createDb({ url: cfg.databaseUrl });
    await seedChain(db, {
      chainId: cfg.chainId,
      name: "Solana Devnet",
      rpcUrl: cfg.rpcUrl,
      escrowAddress: cfg.programId.toBase58(),
      explorerUrl: "https://explorer.solana.com",
      tokenSymbol: "SOL",
      x402Supported: false,
    });
    log.info("db connected, chain seeded", { chainId: cfg.chainId });
  } else {
    log.warn("DATABASE_URL not set, running without DB persistence");
  }

  const hexHash = (bytes: Uint8Array): string =>
    Buffer.from(bytes).toString("hex");

  const handler = async (sub: DecodedSubmission): Promise<void> => {
    log.info("new submission detected", {
      submission: sub.pda.toBase58(),
      bounty: sub.bounty.toBase58(),
      solver: sub.solver.toBase58(),
      prUrl: sub.prUrl,
    });

    if (db) {
      await upsertSubmission(db, {
        chainId: cfg.chainId,
        issuePda: sub.bounty.toBase58(),
        submissionPda: sub.pda.toBase58(),
        solver: sub.solver.toBase58(),
        submissionIndex: sub.submissionIndex,
        prUrl: sub.prUrl,
        opusReportHashHex: hexHash(sub.opusReportHash),
      });
    }

    const { score, source, reasoning, report, reportHash } = await analyzeSubmission(
      {
        submissionPda: sub.pda.toBase58(),
        prUrl: sub.prUrl,
        opusReportHash: sub.opusReportHash,
      },
      {
        stubScore: cfg.stubScore,
        anthropicApiKey: cfg.anthropicApiKey,
        anthropicModel: cfg.anthropicModel,
      },
    );

    const txHash = await client.setScore(sub.bounty, sub.pda, score);

    if (db) {
      await markScored(db, sub.pda.toBase58());
      await insertEvaluation(db, {
        submissionPda: sub.pda.toBase58(),
        source,
        score,
        reasoning,
        report,
        reportHash,
        txHash,
      });
    }
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
