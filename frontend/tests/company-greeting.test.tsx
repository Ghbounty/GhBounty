import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CompanyGreeting } from "@/app/app/company/greeting";

describe("CompanyGreeting", () => {
  test.each([undefined, null, "", "   "])("uses a usable fallback for a missing or blank name", (name) => {
    expect(renderToStaticMarkup(<CompanyGreeting name={name} />)).toContain("Welcome back, there");
  });

  test("preserves the greeting for a named company", () => {
    expect(renderToStaticMarkup(<CompanyGreeting name="Acme Labs" />)).toContain("Welcome back, Acme Labs");
  });
});
