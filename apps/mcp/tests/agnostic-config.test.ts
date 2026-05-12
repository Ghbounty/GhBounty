import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getProgramAddress } from "@/lib/tools/create-account/poll";

describe("getProgramAddress", () => {
  const ORIGINAL = process.env.GHBOUNTY_PROGRAM_ADDRESS;

  beforeEach(() => {
    delete process.env.GHBOUNTY_PROGRAM_ADDRESS;
  });

  afterEach(() => {
    if (ORIGINAL !== undefined) {
      process.env.GHBOUNTY_PROGRAM_ADDRESS = ORIGINAL;
    }
  });

  it("throws when GHBOUNTY_PROGRAM_ADDRESS is not set", () => {
    expect(() => getProgramAddress()).toThrow(
      "GHBOUNTY_PROGRAM_ADDRESS must be set"
    );
  });

  it("returns the env value when set", () => {
    process.env.GHBOUNTY_PROGRAM_ADDRESS = "test_program_addr_xyz";
    expect(getProgramAddress()).toBe("test_program_addr_xyz");
  });
});
