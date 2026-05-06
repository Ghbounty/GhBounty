// Sliding-window rate limits for the MCP server.
//
// Three tiers (spec section 9 layer 3):
//   - createAccount: 5 req / hour / IP (anonymous)
//   - read: 100 req / minute / agent (authenticated)
//   - prepare: 30 req / minute / agent (authenticated, for prepare_* tools)
//
// Each tier is a separate Ratelimit instance so we can monitor / tune
// independently. Upstash's REST client makes them safe to invoke from
// any serverless environment.
//
// Provisioned via Vercel Marketplace (Project → Storage → Browse Marketplace
// → Upstash → Connect). Vercel auto-injects UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN; no manual setup needed.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set");
  }
  _redis = new Redis({ url, token });
  return _redis;
}

let _createAccount: Ratelimit | null = null;
let _read: Ratelimit | null = null;
let _prepare: Ratelimit | null = null;

export function createAccountLimiter(): Ratelimit {
  if (_createAccount) return _createAccount;
  _createAccount = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    prefix: "mcp:create_account",
    analytics: true,
  });
  return _createAccount;
}

export function readLimiter(): Ratelimit {
  if (_read) return _read;
  _read = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(100, "1 m"),
    prefix: "mcp:read",
    analytics: true,
  });
  return _read;
}

export function prepareLimiter(): Ratelimit {
  if (_prepare) return _prepare;
  _prepare = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    prefix: "mcp:prepare",
    analytics: true,
  });
  return _prepare;
}
