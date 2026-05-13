import { describe, expect, test } from "vitest";
import { classifyPath } from "../src/classify.js";

describe("classifyPath — lockfiles", () => {
  test.each([
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "poetry.lock",
    "Gemfile.lock",
    "go.sum",
    "composer.lock",
    "flake.lock",
    "uv.lock",
    "relayer/pnpm-lock.yaml",
    "nested/deep/Cargo.lock",
  ])("marks %s as lockfile", (path) => {
    const r = classifyPath(path);
    expect(r.ignore).toBe(true);
    expect(r.reason).toBe("lockfile");
  });
});

describe("classifyPath — binaries", () => {
  test.each([
    "assets/logo.png",
    "public/favicon.ico",
    "images/hero.webp",
    "fonts/inter.woff2",
    "audio/intro.mp3",
    "videos/demo.mp4",
    "pkg/app.wasm",
    "LICENSE.pdf",
  ])("marks %s as binary", (path) => {
    const r = classifyPath(path);
    expect(r.ignore).toBe(true);
    expect(r.reason).toBe("binary");
  });
});

describe("classifyPath — generated dirs", () => {
  test.each([
    "dist/bundle.js",
    "build/output.html",
    "target/debug/app",
    ".anchor/test-ledger/genesis.bin",
    "contracts/solana/.anchor/test-ledger/genesis.bin",
    "node_modules/foo/index.js",
    "relayer/dist/index.js",
    "app/.next/static/chunks/webpack.js",
    "coverage/lcov-report/index.html",
    "__pycache__/module.cpython-311.pyc",
  ])("marks %s as generated_dir", (path) => {
    const r = classifyPath(path);
    expect(r.ignore).toBe(true);
    expect(r.reason).toBe("generated_dir");
  });
});

describe("classifyPath — generated suffixes", () => {
  test.each([
    "public/app.min.js",
    "styles/global.min.css",
    "src/bundle.js.map",
    "proto/service.pb.ts",
    "service_grpc_pb.js",
  ])("marks %s as generated_suffix", (path) => {
    const r = classifyPath(path);
    expect(r.ignore).toBe(true);
  });
});

describe("classifyPath — custom glob patterns", () => {
  test("filters paths matching the extra glob", () => {
    const r = classifyPath("internal/generated/api.ts", ["internal/generated/**"]);
    expect(r.ignore).toBe(true);
    expect(r.reason).toBe("custom_pattern");
  });

  test("ignores paths outside the extra glob", () => {
    const r = classifyPath("src/real-code.ts", ["internal/generated/**"]);
    expect(r.ignore).toBe(false);
  });
});

describe("classifyPath — real code kept", () => {
  test.each([
    "src/index.ts",
    "relayer/src/watcher.ts",
    "contracts/solana/programs/ghbounty_escrow/src/lib.rs",
    "bounty_judge/contracts/bounty_judge.py",
    "README.md",
    "CHANGELOG.md",
    ".github/workflows/ci.yml",
    "config/prod.json",
    "Cargo.toml",
    "package.json",
    "tsconfig.json",
  ])("keeps real code file %s", (path) => {
    const r = classifyPath(path);
    expect(r.ignore).toBe(false);
    expect(r.reason).toBeUndefined();
  });
});

describe("classifyPath — Windows path separators", () => {
  test("normalizes backslashes", () => {
    const r = classifyPath("src\\components\\App.tsx");
    expect(r.ignore).toBe(false);
  });

  test("detects lockfiles on Windows paths", () => {
    const r = classifyPath("project\\package-lock.json");
    expect(r.ignore).toBe(true);
    expect(r.reason).toBe("lockfile");
  });
});

describe("classifyPath — edge cases", () => {
  test("files without extension are kept", () => {
    const r = classifyPath("Dockerfile");
    expect(r.ignore).toBe(false);
  });

  test("dotfiles without extension are kept", () => {
    const r = classifyPath(".gitignore");
    expect(r.ignore).toBe(false);
  });

  test("uppercase binary extension is still filtered", () => {
    const r = classifyPath("images/photo.PNG");
    expect(r.ignore).toBe(true);
    expect(r.reason).toBe("binary");
  });
});
