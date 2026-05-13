import { describe, expect, it } from "vitest";
import { formatCompanyGreetingName } from "../lib/company-display";

describe("formatCompanyGreetingName", () => {
  it("uses a neutral fallback for missing names", () => {
    expect(formatCompanyGreetingName(undefined)).toBe("there");
    expect(formatCompanyGreetingName(null)).toBe("there");
  });

  it("uses a neutral fallback for empty or whitespace-only names", () => {
    expect(formatCompanyGreetingName("")).toBe("there");
    expect(formatCompanyGreetingName("   ")).toBe("there");
  });

  it("preserves a configured company name after trimming display whitespace", () => {
    expect(formatCompanyGreetingName("GHBounty")).toBe("GHBounty");
    expect(formatCompanyGreetingName("  GHBounty  ")).toBe("GHBounty");
  });
});
