import { describe, expect, test } from "vitest";
import { parseUnifiedDiff } from "../src/parse.js";

const SIMPLE_MODIFY = `diff --git a/src/util.ts b/src/util.ts
index 1234567..89abcde 100644
--- a/src/util.ts
+++ b/src/util.ts
@@ -1,3 +1,4 @@
 export function x() {
+  return 1;
 }
-const unused = 0;
`;

const NEW_FILE = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const v = 1;
+export const w = 2;
`;

const DELETED_FILE = `diff --git a/old.ts b/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const a = 1;
-const b = 2;
`;

const RENAMED_FILE = `diff --git a/foo.ts b/bar.ts
similarity index 100%
rename from foo.ts
rename to bar.ts
`;

const BINARY_MARKER = `diff --git a/logo.png b/logo.png
index abc..def 100644
Binary files a/logo.png and b/logo.png differ
`;

describe("parseUnifiedDiff", () => {
  test("returns empty array for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  test("parses a single modified file", () => {
    const files = parseUnifiedDiff(SIMPLE_MODIFY);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/util.ts");
    expect(files[0]!.status).toBe("modified");
    expect(files[0]!.additions).toBe(1);
    expect(files[0]!.deletions).toBe(1);
  });

  test("detects added files", () => {
    const files = parseUnifiedDiff(NEW_FILE);
    expect(files[0]!.status).toBe("added");
    expect(files[0]!.additions).toBe(2);
    expect(files[0]!.deletions).toBe(0);
  });

  test("detects deleted files", () => {
    const files = parseUnifiedDiff(DELETED_FILE);
    expect(files[0]!.status).toBe("deleted");
    expect(files[0]!.additions).toBe(0);
    expect(files[0]!.deletions).toBe(2);
  });

  test("detects renamed files and records oldPath", () => {
    const files = parseUnifiedDiff(RENAMED_FILE);
    expect(files[0]!.status).toBe("renamed");
    expect(files[0]!.path).toBe("bar.ts");
    expect(files[0]!.oldPath).toBe("foo.ts");
  });

  test("flags binary-marked files", () => {
    const files = parseUnifiedDiff(BINARY_MARKER);
    expect(files).toHaveLength(1);
    expect(files[0]!.isBinaryMarked).toBe(true);
  });

  test("parses multi-file diffs", () => {
    const files = parseUnifiedDiff(SIMPLE_MODIFY + NEW_FILE + DELETED_FILE);
    expect(files.map((f) => f.path)).toEqual(["src/util.ts", "src/new.ts", "old.ts"]);
    expect(files.map((f) => f.status)).toEqual(["modified", "added", "deleted"]);
  });

  test("preserves raw content per file", () => {
    const files = parseUnifiedDiff(SIMPLE_MODIFY + NEW_FILE);
    expect(files[0]!.raw).toContain("src/util.ts");
    expect(files[0]!.raw).not.toContain("src/new.ts");
    expect(files[1]!.raw).toContain("src/new.ts");
    expect(files[1]!.raw).not.toContain("src/util.ts");
  });
});
