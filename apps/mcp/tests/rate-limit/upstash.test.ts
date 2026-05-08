import { describe, it, expect } from "vitest";

const HAS_UPSTASH =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

describe.skipIf(!HAS_UPSTASH)("Upstash rate limiter (live)", () => {
  it("createAccountLimiter rejects on the 6th request from same IP within an hour", async () => {
    const { createAccountLimiter } = await import("@/lib/rate-limit/upstash");
    const limiter = createAccountLimiter();
    const ip = `test:${Date.now()}`;

    for (let i = 0; i < 5; i++) {
      const r = await limiter.limit(ip);
      expect(r.success).toBe(true);
    }
    const sixth = await limiter.limit(ip);
    expect(sixth.success).toBe(false);
  }, 30_000);
});
