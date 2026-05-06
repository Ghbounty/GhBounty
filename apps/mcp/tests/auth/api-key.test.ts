import { describe, it, expect } from "vitest";
import { mintApiKey } from "@/lib/auth/api-key";

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
