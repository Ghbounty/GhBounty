/**
 * GHB-177 — Gas-station wallet balance health check.
 *
 * Polls the gas-station balance and exits with a status that reflects
 * severity. Designed to be run by a scheduled job (Vercel cron, GitHub
 * Actions schedule, external pinger); the runner pipes a non-zero
 * exit to whatever alert channel is wired up.
 *
 * Exit codes:
 *   0  healthy        balance ≥ --warn
 *   1  warn           balance < --warn  but ≥ --critical
 *   2  critical       balance < --critical
 *   3  probe failed   bad env / RPC error / pubkey parse error
 *
 * stdout always contains a single JSON line so downstream consumers
 * can parse without scraping. Run with `--pubkey` to skip loading the
 * keypair entirely (handy for ops tooling that has the address but not
 * the secret).
 *
 * CLI:
 *   pnpm --filter @ghbounty/shared health:gas-station
 *
 * Override pubkey + thresholds:
 *   pnpm --filter @ghbounty/shared health:gas-station -- \
 *     --pubkey <pubkey> --rpc https://api.devnet.solana.com \
 *     --warn 1 --critical 0.1
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { loadGasStationKeypair } from "../src/gas-station/index";

interface Args {
  pubkey?: string;
  rpc?: string;
  /** Warn floor in SOL (NOT lamports). */
  warn: number;
  /** Critical floor in SOL. */
  critical: number;
}

const DEFAULT_WARN_SOL = 1.0;
const DEFAULT_CRITICAL_SOL = 0.1;
const LAMPORTS_PER_SOL = 1_000_000_000;

type Severity = "ok" | "warn" | "critical";

interface HealthReport {
  pubkey: string;
  rpc: string;
  balanceLamports: number;
  balanceSol: number;
  warnLamports: number;
  criticalLamports: number;
  severity: Severity;
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {
    warn: DEFAULT_WARN_SOL,
    critical: DEFAULT_CRITICAL_SOL,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--") {
      // pnpm forwards `--` as the args separator; skip it.
      continue;
    }
    if (a === "--pubkey" && next) {
      out.pubkey = next;
      i += 1;
    } else if (a === "--rpc" && next) {
      out.rpc = next;
      i += 1;
    } else if (a === "--warn" && next) {
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0) {
        die(3, `--warn must be a non-negative number, got: ${next}`);
      }
      out.warn = n;
      i += 1;
    } else if (a === "--critical" && next) {
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0) {
        die(3, `--critical must be a non-negative number, got: ${next}`);
      }
      out.critical = n;
      i += 1;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: gas-station-health [--pubkey <key>] [--rpc <url>] [--warn <SOL>] [--critical <SOL>]\n",
      );
      process.exit(0);
    } else {
      die(3, `unknown arg: ${a}`);
    }
  }
  if (out.critical > out.warn) {
    die(
      3,
      `--critical (${out.critical}) must be <= --warn (${out.warn})`,
    );
  }
  return out;
}

function die(code: number, msg: string): never {
  process.stderr.write(`gas-station-health: ${msg}\n`);
  process.exit(code);
}

function severityFor(
  balanceLamports: number,
  warnLamports: number,
  criticalLamports: number,
): Severity {
  if (balanceLamports < criticalLamports) return "critical";
  if (balanceLamports < warnLamports) return "warn";
  return "ok";
}

function exitCodeFor(severity: Severity): number {
  if (severity === "critical") return 2;
  if (severity === "warn") return 1;
  return 0;
}

function resolvePubkey(args: Args): PublicKey {
  if (args.pubkey) {
    try {
      return new PublicKey(args.pubkey);
    } catch (err) {
      die(3, `invalid --pubkey: ${(err as Error).message}`);
    }
  }
  // No --pubkey override → fall back to loading the keypair from env.
  // The loader throws with a clear message when env is missing, which
  // we forward as exit-3 so cron jobs surface "config broken" cleanly.
  try {
    return loadGasStationKeypair().publicKey;
  } catch (err) {
    die(3, `keypair load failed: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pubkey = resolvePubkey(args);
  const rpc = args.rpc || process.env.RPC_URL || "https://api.devnet.solana.com";

  const warnLamports = Math.floor(args.warn * LAMPORTS_PER_SOL);
  const criticalLamports = Math.floor(args.critical * LAMPORTS_PER_SOL);

  const connection = new Connection(rpc, "confirmed");
  let balanceLamports: number;
  try {
    balanceLamports = await connection.getBalance(pubkey, "confirmed");
  } catch (err) {
    die(3, `getBalance failed: ${(err as Error).message}`);
  }

  const severity = severityFor(balanceLamports, warnLamports, criticalLamports);
  const report: HealthReport = {
    pubkey: pubkey.toBase58(),
    rpc,
    balanceLamports,
    balanceSol: balanceLamports / LAMPORTS_PER_SOL,
    warnLamports,
    criticalLamports,
    severity,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(exitCodeFor(severity));
}

main().catch((err) => die(3, err instanceof Error ? err.message : String(err)));
