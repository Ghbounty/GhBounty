// Load `.env` before any module reads `process.env`. The relayer is the
// only entry point of this package, so a single import here is enough —
// every helper (config.ts, db ops, scorer) reads env later in the chain.
//
// `override: true` because parent environments (Claude Code, some shells)
// may pre-define `ANTHROPIC_API_KEY=""` etc. — dotenv's default is to
// NOT overwrite, which leaves us with a useless empty string and
// `enabled: false`. The `.env` is the source of truth for the relayer.
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ override: true, quiet: true });
import { Connection } from "@solana/web3.js";

import { loadConfig } from "./config.js";
import { createDb, type Db } from "@ghbounty/db";
import { seedChain } from "./db/ops.js";
import { log, setLogLevel } from "./logger.js";
import { createScorerClient } from "./scorer.js";
import { handleSubmission } from "./submission-handler.js";
import { processBacklog, watchSubmissions } from "./watcher.js";

const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce(): Promise<never> {
  const cfg = loadConfig();
  setLogLevel(cfg.logLevel);

  // Diagnostic: surface whether GITHUB_TOKEN was loaded so a 403 rate
  // limit doesn't masquerade as a token-missing problem (or vice versa).
  // We log only the presence + length, never the token itself.
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  log.info("relayer starting", {
    rpcUrl: cfg.rpcUrl,
    wsUrl: cfg.wsUrl,
    programId: cfg.programId.toBase58(),
    scorer: cfg.scorerKeypair.publicKey.toBase58(),
    stubScore: cfg.stubScore,
    anthropic: cfg.anthropicApiKey
      ? { enabled: true, model: cfg.anthropicModel }
      : { enabled: false },
    githubToken: ghToken
      ? { present: true, length: ghToken.length }
      : { present: false },
    genlayer: cfg.genlayer.bountyJudgeContract
      ? {
          enabled: true,
          contract: cfg.genlayer.bountyJudgeContract,
          rpc: cfg.genlayer.rpcUrl,
          pollTimeoutS: cfg.genlayer.pollTimeoutS,
        }
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

  const handler = (sub: Parameters<typeof handleSubmission>[0]) =>
    handleSubmission(sub, {
      db,
      scorer: client,
      chainId: cfg.chainId,
      stubScore: cfg.stubScore,
      anthropicApiKey: cfg.anthropicApiKey,
      anthropicModel: cfg.anthropicModel,
      // GHB-58: pass the GenLayer config through. The handler skips
      // the call when contract or key is null, so this is safe even
      // when the operator hasn't set the env vars yet.
      genlayer: cfg.genlayer,
    }).then(() => undefined);

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
