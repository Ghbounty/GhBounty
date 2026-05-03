import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { detectTestRunner } from "../src/sandbox/index.js";

/**
 * GHB-71 detector — exercised against real tmp directories so we
 * catch any drift between our `fileExists` helper and `node:fs`.
 *
 * Each test creates a unique tmp dir, drops the marker files it
 * needs, asserts the detector picks the expected runner, and cleans
 * up. No mocks — the detector is small and synchronous, real I/O is
 * fast enough.
 */

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ghbounty-detector-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function touch(...segments: string[]): void {
  const full = path.join(tmpRoot, ...segments);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "");
}

function writePackageJson(scripts?: Record<string, string>): void {
  fs.writeFileSync(
    path.join(tmpRoot, "package.json"),
    JSON.stringify({ name: "test-repo", scripts: scripts ?? {} }),
  );
}

describe("detectTestRunner — empty / no-marker", () => {
  test("returns null for an empty repo", () => {
    expect(detectTestRunner(tmpRoot)).toBeNull();
  });

  test("returns null for a repo with only a README", () => {
    touch("README.md");
    expect(detectTestRunner(tmpRoot)).toBeNull();
  });
});

describe("detectTestRunner — language-specific markers", () => {
  test("Anchor.toml → anchor test", () => {
    touch("Anchor.toml");
    const spec = detectTestRunner(tmpRoot);
    expect(spec?.kind).toBe("anchor");
    expect(spec?.command).toEqual(["anchor", "test"]);
    expect(spec?.markers).toEqual(["Anchor.toml"]);
  });

  test("foundry.toml → forge test", () => {
    touch("foundry.toml");
    const spec = detectTestRunner(tmpRoot);
    expect(spec?.kind).toBe("forge");
    expect(spec?.command).toEqual(["forge", "test"]);
  });

  test("Cargo.toml → cargo test", () => {
    touch("Cargo.toml");
    const spec = detectTestRunner(tmpRoot);
    expect(spec?.kind).toBe("cargo");
    expect(spec?.command).toEqual(["cargo", "test"]);
  });

  test("go.mod → go test ./...", () => {
    touch("go.mod");
    const spec = detectTestRunner(tmpRoot);
    expect(spec?.kind).toBe("go");
    expect(spec?.command).toEqual(["go", "test", "./..."]);
  });

  test("pyproject.toml → pytest", () => {
    touch("pyproject.toml");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("pytest");
  });

  test("requirements.txt alone → pytest (modern python conv)", () => {
    touch("requirements.txt");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("pytest");
  });

  test("setup.py alone → pytest", () => {
    touch("setup.py");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("pytest");
  });

  test("pytest reports every matching marker", () => {
    touch("pyproject.toml");
    touch("pytest.ini");
    touch("requirements.txt");
    expect(detectTestRunner(tmpRoot)?.markers).toEqual([
      "pyproject.toml",
      "pytest.ini",
      "requirements.txt",
    ]);
  });
});

describe("detectTestRunner — node package manager dispatch", () => {
  test("package.json + real test script → npm by default", () => {
    writePackageJson({ test: "vitest" });
    const spec = detectTestRunner(tmpRoot);
    expect(spec?.kind).toBe("npm");
    expect(spec?.command).toEqual(["npm", "test"]);
  });

  test("pnpm-lock.yaml → pnpm test", () => {
    writePackageJson({ test: "vitest" });
    touch("pnpm-lock.yaml");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("pnpm");
    expect(detectTestRunner(tmpRoot)?.markers).toContain("pnpm-lock.yaml");
  });

  test("yarn.lock → yarn test", () => {
    writePackageJson({ test: "jest" });
    touch("yarn.lock");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("yarn");
  });

  test("pnpm wins over yarn when both lockfiles present", () => {
    writePackageJson({ test: "vitest" });
    touch("pnpm-lock.yaml");
    touch("yarn.lock");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("pnpm");
  });

  test("package.json without scripts → null (not a node project)", () => {
    fs.writeFileSync(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({ name: "x" }),
    );
    expect(detectTestRunner(tmpRoot)).toBeNull();
  });

  test("npm-init placeholder script → falls through (treated as no script)", () => {
    writePackageJson({
      test: 'echo "Error: no test specified" && exit 1',
    });
    expect(detectTestRunner(tmpRoot)).toBeNull();
  });

  test("placeholder script doesn't block lower-priority detection", () => {
    // A Python project with a placeholder package.json (e.g. for
    // tooling) should still be detected as pytest.
    writePackageJson({
      test: 'echo "Error: no test specified" && exit 1',
    });
    touch("pyproject.toml");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("pytest");
  });

  test("malformed package.json doesn't crash → falls through", () => {
    fs.writeFileSync(path.join(tmpRoot, "package.json"), "{ not valid json");
    expect(detectTestRunner(tmpRoot)).toBeNull();
  });
});

describe("detectTestRunner — priority order", () => {
  test("Anchor.toml beats Cargo.toml AND package.json", () => {
    touch("Anchor.toml");
    touch("Cargo.toml");
    writePackageJson({ test: "mocha" });
    const spec = detectTestRunner(tmpRoot);
    expect(spec?.kind).toBe("anchor");
  });

  test("foundry.toml beats Cargo.toml", () => {
    touch("foundry.toml");
    touch("Cargo.toml");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("forge");
  });

  test("Cargo.toml beats package.json", () => {
    touch("Cargo.toml");
    writePackageJson({ test: "vitest" });
    expect(detectTestRunner(tmpRoot)?.kind).toBe("cargo");
  });

  test("go.mod beats package.json", () => {
    touch("go.mod");
    writePackageJson({ test: "vitest" });
    expect(detectTestRunner(tmpRoot)?.kind).toBe("go");
  });

  test("package.json with real script beats pyproject.toml", () => {
    writePackageJson({ test: "vitest" });
    touch("pyproject.toml");
    expect(detectTestRunner(tmpRoot)?.kind).toBe("npm");
  });
});

describe("detectTestRunner — custom command override", () => {
  test("non-empty customCommand wins over every marker", () => {
    touch("Anchor.toml"); // would normally win
    const spec = detectTestRunner(tmpRoot, {
      customCommand: "pnpm -F @my/pkg test",
    });
    expect(spec?.kind).toBe("custom");
    expect(spec?.command).toEqual(["sh", "-c", "pnpm -F @my/pkg test"]);
    expect(spec?.markers).toEqual(["custom_command"]);
  });

  test("whitespace-only customCommand falls back to detection", () => {
    touch("Cargo.toml");
    const spec = detectTestRunner(tmpRoot, { customCommand: "   " });
    expect(spec?.kind).toBe("cargo");
  });

  test("null customCommand is ignored", () => {
    touch("Cargo.toml");
    const spec = detectTestRunner(tmpRoot, { customCommand: null });
    expect(spec?.kind).toBe("cargo");
  });

  test("custom command is shell-wrapped so pipes / && work", () => {
    const spec = detectTestRunner(tmpRoot, {
      customCommand: "make test && bash scripts/post.sh | tee out.log",
    });
    expect(spec?.command[0]).toBe("sh");
    expect(spec?.command[1]).toBe("-c");
  });
});

describe("detectTestRunner — defensive checks", () => {
  test("ignores directories with the marker name", () => {
    // A `Cargo.toml/` directory shouldn't trip the cargo detector.
    fs.mkdirSync(path.join(tmpRoot, "Cargo.toml"));
    expect(detectTestRunner(tmpRoot)).toBeNull();
  });

  test("nonexistent repoRoot returns null instead of throwing", () => {
    const ghost = path.join(tmpRoot, "does-not-exist");
    expect(detectTestRunner(ghost)).toBeNull();
  });
});
