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
  };
}
