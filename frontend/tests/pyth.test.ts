import { describe, expect, test, vi } from "vitest";

import { fetchSolUsdPrice, SOL_USD_FEED_ID } from "@/lib/pyth";

/**
 * Hermes returns Pyth's integer price + a negative `expo`. The helper
 * needs to: (1) request the right URL, (2) parse `price * 10^expo`,
 * (3) reject anything outside [1, 10_000] USD or malformed.
 */

function makeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(
    async () =>
      ({
        ok,
        status,
        json: async () => body,
      }) as unknown as Response,
  ) as unknown as typeof fetch;
}

describe("fetchSolUsdPrice", () => {
  test("parses Pyth's integer + expo into USD per SOL", async () => {
    // 8824550124 × 10^-8 = 88.24550124
    const fetchImpl = makeFetch({
      parsed: [
        {
          price: {
            price: "8824550124",
            conf: "3332069",
            expo: -8,
            publish_time: 1778195436,
          },
        },
      ],
    });
    const price = await fetchSolUsdPrice({ fetchImpl });
    expect(price).toBeCloseTo(88.24550124, 6);
  });

  test("hits the configured base URL + feed id", async () => {
    const fetchImpl = makeFetch({
      parsed: [
        { price: { price: "20000000000", expo: -8, publish_time: 1 } },
      ],
    });
    await fetchSolUsdPrice({
      fetchImpl,
      baseUrl: "https://example.test",
      feedId: "0xfake",
    });
    const call = (fetchImpl as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]!;
    const url = call[0] as string;
    expect(url).toContain("https://example.test/v2/updates/price/latest");
    expect(url).toContain("ids[]=0xfake");
    expect(url).toContain("parsed=true");
  });

  test("default feed id is the canonical SOL/USD Pyth feed", () => {
    expect(SOL_USD_FEED_ID).toBe(
      "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    );
  });

  test("non-2xx response → throws", async () => {
    const fetchImpl = makeFetch({}, false, 503);
    await expect(fetchSolUsdPrice({ fetchImpl })).rejects.toThrow(/HTTP 503/);
  });

  test("missing parsed[0] → throws", async () => {
    const fetchImpl = makeFetch({ parsed: [] });
    await expect(fetchSolUsdPrice({ fetchImpl })).rejects.toThrow(
      /missing parsed price/,
    );
  });

  test("price below sane floor → throws (defends against oracle drift)", async () => {
    // 50 × 10^-8 = 0.0000005 USD — clearly broken.
    const fetchImpl = makeFetch({
      parsed: [{ price: { price: "50", expo: -8, publish_time: 1 } }],
    });
    await expect(fetchSolUsdPrice({ fetchImpl })).rejects.toThrow(
      /outside sane range/,
    );
  });

  test("price above sane ceiling → throws", async () => {
    // 1e15 × 10^-8 = 1e7 USD — also clearly broken.
    const fetchImpl = makeFetch({
      parsed: [{ price: { price: "1000000000000000", expo: -8, publish_time: 1 } }],
    });
    await expect(fetchSolUsdPrice({ fetchImpl })).rejects.toThrow(
      /outside sane range/,
    );
  });
});
