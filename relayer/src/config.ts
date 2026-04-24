import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

function must(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
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
}

export function loadConfig(): RelayerConfig {
  const rpcUrl = must("RPC_URL", "https://api.devnet.solana.com");
  const wsUrl = process.env.WS_URL ?? rpcUrl.replace(/^http/, "ws");
  const programId = new PublicKey(
    must("PROGRAM_ID", "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg"),
  );
  const keypairPath = must(
    "SCORER_KEYPAIR_PATH",
    path.join(os.homedir(), ".config/solana/ghbounty-dev.json"),
  );
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8")) as number[];
  const scorerKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));

  const stubScore = Number(process.env.STUB_SCORE ?? "7");
  if (!Number.isInteger(stubScore) || stubScore < 1 || stubScore > 10) {
    throw new Error(`STUB_SCORE must be integer in [1,10], got ${stubScore}`);
  }

  const logLevel = (process.env.LOG_LEVEL ?? "info") as RelayerConfig["logLevel"];
  const databaseUrl = process.env.DATABASE_URL?.trim() || null;
  const chainId = process.env.CHAIN_ID ?? "solana-devnet";

  return {
    rpcUrl,
    wsUrl,
    programId,
    scorerKeypair,
    stubScore,
    logLevel,
    databaseUrl,
    chainId,
  };
}
