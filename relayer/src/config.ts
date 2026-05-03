import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

function must(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Load the scorer keypair from one of:
 *  1. SCORER_KEYPAIR_JSON — the raw JSON array as a string. Cloud-friendly:
 *     Railway/Fly/etc. let you paste this as a regular env var. Wins if set.
 *  2. SCORER_KEYPAIR_PATH — file path on disk. Convenient for local dev with
 *     the Solana CLI's default keypair location.
 *  3. Default fallback to ~/.config/solana/ghbounty-dev.json.
 *
 * Either source must yield a 64-byte secret key array.
 */
function loadScorerKeypair(): Keypair {
  const inlineJson = process.env.SCORER_KEYPAIR_JSON?.trim();
  if (inlineJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(inlineJson);
    } catch (err) {
      throw new Error(
        `SCORER_KEYPAIR_JSON is not valid JSON: ${(err as Error).message}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== "number")) {
      throw new Error(
        "SCORER_KEYPAIR_JSON must be a JSON array of numbers (64 bytes)",
      );
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  }
  const keypairPath = must(
    "SCORER_KEYPAIR_PATH",
    path.join(os.homedir(), ".config/solana/ghbounty-dev.json"),
  );
  // Expand a leading `~` — `fs.readFileSync` does not, and the .env.example
  // uses `~/.config/...` as the documented value. Without this, the relayer
  // crashes on every loop iteration with ENOENT against the literal tilde.
  const expandedPath = keypairPath.startsWith("~")
    ? path.join(os.homedir(), keypairPath.slice(1))
    : keypairPath;
  const raw = JSON.parse(fs.readFileSync(expandedPath, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/**
 * GHB-58 second-opinion config — GenLayer BountyJudge integration.
 *
 * `bountyJudgeContract` is the deployed address on the chain we point
 * to via `genlayerRpc`. When unset (null), the relayer SKIPS the
 * GenLayer call entirely and falls back to Sonnet-only — useful for
 * local dev or while the GenLayer side is being iterated on.
 *
 * `genlayerPrivateKey` is the EVM-shaped private key the relayer signs
 * GenLayer txs with. It pays gas (zero on studionet, non-zero on
 * testnet/mainnet). Distinct from the Solana scorer keypair on
 * purpose: blowing one doesn't blow the other.
 */
export interface GenLayerConfig {
  rpcUrl: string;
  bountyJudgeContract: string | null;
  privateKey: `0x${string}` | null;
  /**
   * How long to wait (seconds) for the BountyJudge tx to reach a
   * decided state (ACCEPTED / FINALIZED / UNDETERMINED). Default 300s
   * because studionet's full leader+validators round routinely takes
   * 2-4 minutes with the slower LLM providers in the validator pool.
   */
  pollTimeoutS: number;
}

export interface RelayerConfig {
  rpcUrl: string;
  wsUrl: string;
  programId: PublicKey;
  scorerKeypair: Keypair;
  stubScore: number;
  logLevel: "debug" | "info" | "warn" | "error";
  databaseUrl: string | null;
  chainId: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  genlayer: GenLayerConfig;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

export function loadConfig(): RelayerConfig {
  const rpcUrl = must("RPC_URL", "https://api.devnet.solana.com");
  const wsUrl = process.env.WS_URL ?? rpcUrl.replace(/^http/, "ws");
  const programId = new PublicKey(
    must("PROGRAM_ID", "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg"),
  );
  const scorerKeypair = loadScorerKeypair();

  const stubScore = Number(process.env.STUB_SCORE ?? "7");
  if (!Number.isInteger(stubScore) || stubScore < 1 || stubScore > 10) {
    throw new Error(`STUB_SCORE must be integer in [1,10], got ${stubScore}`);
  }

  const logLevel = (process.env.LOG_LEVEL ?? "info") as RelayerConfig["logLevel"];
  const databaseUrl = process.env.DATABASE_URL?.trim() || null;
  const chainId = process.env.CHAIN_ID ?? "solana-devnet";
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const anthropicModel = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;

  // GenLayer second-opinion: all three must be set to enable. When
  // contract or key is missing we treat it as feature-disabled and the
  // submission handler skips the call without erroring.
  const glRpc = process.env.GENLAYER_RPC?.trim() || "https://studio.genlayer.com/api";
  const glContractRaw = process.env.BOUNTY_JUDGE_CONTRACT?.trim() || null;
  const glContract = glContractRaw && /^0x[0-9a-fA-F]{40}$/.test(glContractRaw)
    ? glContractRaw
    : null;
  const glKeyRaw = process.env.GENLAYER_PRIVATE_KEY?.trim() || null;
  const glKey = glKeyRaw && /^0x[0-9a-fA-F]{64}$/.test(glKeyRaw)
    ? (glKeyRaw as `0x${string}`)
    : null;
  // Studionet's leader+validators round can take 2-4 minutes when LLM
  // providers are slow. 300s is a safe default that still surfaces real
  // hangs without cutting off legitimate consensus rounds.
  const glPollTimeout = Number(process.env.GENLAYER_POLL_TIMEOUT_S ?? "300");

  return {
    rpcUrl,
    wsUrl,
    programId,
    scorerKeypair,
    stubScore,
    logLevel,
    databaseUrl,
    chainId,
    anthropicApiKey,
    anthropicModel,
    genlayer: {
      rpcUrl: glRpc,
      bountyJudgeContract: glContract,
      privateKey: glKey,
      pollTimeoutS: Number.isFinite(glPollTimeout) && glPollTimeout > 0
        ? glPollTimeout
        : 300,
    },
  };
}
