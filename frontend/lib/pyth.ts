/**
 * Pyth Hermes price reader.
 *
 * Used by `CreateBountyFlow` to lock in a SOL/USD rate at the moment a
 * bounty is created. The locked-in rate sizes both the upfront review
 * fee and any future refund — once a bounty exists, the lamport amount
 * never re-derives from a fresh price, so SOL/USD movement after creation
 * doesn't affect the user.
 *
 * We deliberately read OFF-CHAIN (HTTP) instead of via on-chain Pyth
 * accounts: the math runs in the browser, the result is just a number,
 * and Hermes already serves the same data the on-chain oracle exposes.
 *
 * Hermes API: `https://hermes.pyth.network`
 * Feed ID below = SOL/USD on Pyth mainnet (the canonical feed; same data
 * that Pyth's on-chain Solana program serves).
 */

const HERMES_BASE = "https://hermes.pyth.network";

/**
 * SOL/USD Pyth price feed ID. The "0x" prefix is required by Hermes.
 * Source: https://www.pyth.network/developers/price-feed-ids → SOL/USD.
 */
export const SOL_USD_FEED_ID =
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

/** Cap on the price we'll accept. Beyond this we abort and let the caller
 *  show an error rather than silently charge a number we don't trust. */
const SANE_PRICE_MIN_USD = 1;
const SANE_PRICE_MAX_USD = 10_000;

/** Hermes parsed price entry shape (relevant subset). */
interface HermesParsedPrice {
  price: {
    price: string; // integer, multiply by 10^expo
    expo: number; // typically negative
    publish_time: number;
  };
}

interface HermesResponse {
  parsed?: HermesParsedPrice[];
}

/**
 * Fetch the current SOL/USD price (USD per 1 SOL) from Pyth Hermes.
 *
 * Returns a plain number. Throws on any of:
 *   - network failure
 *   - non-2xx response
 *   - missing/malformed body
 *   - price outside the sanity range
 *
 * Throwing keeps the caller honest — if the rate is unreliable, we'd
 * rather block bounty creation than charge a wrong fee.
 */
export async function fetchSolUsdPrice(opts?: {
  /** Override the fetch impl (tests inject a fake). */
  fetchImpl?: typeof fetch;
  /** Override the feed ID (tests). */
  feedId?: string;
  /** Override the base URL (tests). */
  baseUrl?: string;
}): Promise<number> {
  const fetchFn = opts?.fetchImpl ?? fetch;
  const feedId = opts?.feedId ?? SOL_USD_FEED_ID;
  const base = opts?.baseUrl ?? HERMES_BASE;
  // `parsed=true` tells Hermes to include a JSON `parsed` array next to
  // the binary update. We only consume the parsed entry here.
  const url = `${base}/v2/updates/price/latest?ids[]=${feedId}&parsed=true`;

  const res = await fetchFn(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`pyth: hermes returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as HermesResponse;
  const entry = body.parsed?.[0];
  if (!entry?.price) {
    throw new Error("pyth: hermes response missing parsed price");
  }
  const raw = Number(entry.price.price);
  const expo = entry.price.expo;
  if (!Number.isFinite(raw) || !Number.isFinite(expo)) {
    throw new Error(
      `pyth: malformed price (raw=${entry.price.price}, expo=${expo})`,
    );
  }
  // Pyth uses negative exponents (e.g. price=12345678901, expo=-8 → 123.45...).
  const usdPerSol = raw * Math.pow(10, expo);
  if (
    !Number.isFinite(usdPerSol) ||
    usdPerSol < SANE_PRICE_MIN_USD ||
    usdPerSol > SANE_PRICE_MAX_USD
  ) {
    throw new Error(
      `pyth: SOL/USD ${usdPerSol} is outside sane range [${SANE_PRICE_MIN_USD}, ${SANE_PRICE_MAX_USD}]`,
    );
  }
  return usdPerSol;
}
