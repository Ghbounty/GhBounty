import { describe, it, expect } from "vitest";
import { mintApiKey, verifyApiKey, extractPrefix } from "@/lib/auth/api-key";

describe("mintApiKey", () => {
  it("produces a key with the correct prefix and length", () => {
    const { plaintext, prefix, hash } = mintApiKey();
    expect(plaintext).toMatch(/^ghbk_live_[0-9a-f]{32}$/);
    expect(prefix).toMatch(/^ghbk_live_[0-9a-f]{12}$/);
    expect(plaintext.startsWith(prefix)).toBe(true);
    expect(hash).not.toBe(plaintext);
    expect(hash.length).toBeGreaterThan(50); // bcrypt hashes are ~60 chars
  });

  it("produces unique keys on every call", () => {
    const a = mintApiKey();
    const b = mintApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe("verifyApiKey", () => {
  it("returns true for the matching plaintext", () => {
    const { plaintext, hash } = mintApiKey();
    expect(verifyApiKey(plaintext, hash)).toBe(true);
  });

  it("returns false for a different plaintext", () => {
    const { hash } = mintApiKey();
    expect(verifyApiKey("ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", hash)).toBe(false);
  });
});

describe("extractPrefix", () => {
  it("returns the first 22 chars (prefix + 12 hex)", () => {
    const { plaintext, prefix } = mintApiKey();
    expect(extractPrefix(plaintext)).toBe(prefix);
  });

  it("throws on invalid format", () => {
    expect(() => extractPrefix("invalid_key")).toThrow();
  });
});
