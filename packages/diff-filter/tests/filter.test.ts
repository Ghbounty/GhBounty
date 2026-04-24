import { describe, expect, test } from "vitest";
import { filterDiffFiles, filterUnifiedDiff } from "../src/filter.js";
import type { DiffFile } from "../src/parse.js";

function file(path: string, opts: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 0,
    raw: `diff --git a/${path} b/${path}\n+stuff\n`,
    isBinaryMarked: false,
    ...opts,
  };
}

describe("filterDiffFiles", () => {
  test("empty input returns empty result", () => {
    const r = filterDiffFiles([]);
    expect(r.kept).toEqual([]);
    expect(r.filtered).toEqual([]);
    expect(r.stats.totalFiles).toBe(0);
  });

  test("keeps real code and filters lockfiles", () => {
    const files = [
      file("src/util.ts"),
      file("pnpm-lock.yaml"),
      file("Cargo.toml"),
      file("Cargo.lock"),
    ];
    const r = filterDiffFiles(files);
    expect(r.kept.map((f) => f.path)).toEqual(["src/util.ts", "Cargo.toml"]);
    expect(r.filtered.map((f) => f.reason)).toEqual(["lockfile", "lockfile"]);
  });

  test("filters binary-marked files independent of extension", () => {
    const r = filterDiffFiles([
      file("weird_binary_no_ext", { isBinaryMarked: true }),
      file("src/keep.ts"),
    ]);
    expect(r.filtered).toHaveLength(1);
    expect(r.filtered[0]!.reason).toBe("binary_marker");
    expect(r.kept.map((f) => f.path)).toEqual(["src/keep.ts"]);
  });

  test("filters generated dirs", () => {
    const files = [file("dist/bundle.js"), file("src/main.ts")];
    const r = filterDiffFiles(files);
    expect(r.kept.map((f) => f.path)).toEqual(["src/main.ts"]);
  });

  test("maxChangedLines marks oversized files", () => {
    const big = file("src/huge.ts", { additions: 1500, deletions: 500 });
    const normal = file("src/small.ts", { additions: 10, deletions: 2 });
    const r = filterDiffFiles([big, normal], { maxChangedLines: 1000 });
    expect(r.kept.map((f) => f.path)).toEqual(["src/small.ts"]);
    expect(r.filtered[0]!.reason).toBe("oversized");
  });

  test("stats reflect bytes kept vs filtered", () => {
    const kept = file("src/a.ts", { raw: "A".repeat(100) });
    const dropped = file("pnpm-lock.yaml", { raw: "B".repeat(500) });
    const r = filterDiffFiles([kept, dropped]);
    expect(r.stats.totalFiles).toBe(2);
    expect(r.stats.keptFiles).toBe(1);
    expect(r.stats.filteredFiles).toBe(1);
    expect(r.stats.keptBytes).toBe(100);
    expect(r.stats.filteredBytes).toBe(500);
  });

  test("extraIgnoreGlobs filters custom patterns", () => {
    const r = filterDiffFiles(
      [file("proto/user.ts"), file("src/main.ts")],
      { extraIgnoreGlobs: ["proto/**"] },
    );
    expect(r.kept.map((f) => f.path)).toEqual(["src/main.ts"]);
    expect(r.filtered[0]!.reason).toBe("custom_pattern");
  });
});

describe("filterUnifiedDiff", () => {
  const COMBINED = `diff --git a/src/code.ts b/src/code.ts
index 111..222 100644
--- a/src/code.ts
+++ b/src/code.ts
@@ -1 +1,2 @@
 existing
+new line
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index aaa..bbb 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1,100 +1,200 @@
-old
+new
diff --git a/images/logo.png b/images/logo.png
index ccc..ddd 100644
Binary files a/images/logo.png and b/images/logo.png differ
`;

  test("returns an output diff with only kept files", () => {
    const r = filterUnifiedDiff(COMBINED);
    expect(r.kept.map((f) => f.path)).toEqual(["src/code.ts"]);
    expect(r.output).toContain("src/code.ts");
    expect(r.output).not.toContain("pnpm-lock.yaml");
    expect(r.output).not.toContain("logo.png");
  });

  test("drastically reduces byte count on PR with lockfile bloat", () => {
    const r = filterUnifiedDiff(COMBINED);
    expect(r.stats.keptBytes).toBeLessThan(r.stats.filteredBytes);
    expect(r.stats.keptFiles).toBe(1);
    expect(r.stats.filteredFiles).toBe(2);
  });
});
