import { describe, expect, it } from "vitest";
import { companyDisplayName, companyGreetingName } from "@/lib/display-names";

describe("company display names", () => {
  it("falls back when a company name is missing", () => {
    expect(companyGreetingName(undefined)).toBe("there");
    expect(companyGreetingName(null)).toBe("there");
    expect(companyGreetingName("")).toBe("there");
    expect(companyGreetingName("   ")).toBe("there");
  });

  it("preserves a configured company name", () => {
    expect(companyGreetingName("Acme Labs")).toBe("Acme Labs");
    expect(companyDisplayName("Acme Labs")).toBe("Acme Labs");
  });
});
