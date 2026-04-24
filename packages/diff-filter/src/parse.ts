export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "unknown";

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Raw diff text for this file, including `diff --git` header + hunks. */
  raw: string;
  /** True when the file section contained the `Binary files ... differ` marker. */
  isBinaryMarked: boolean;
}

const FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+?)$/;

/** Parse a unified diff (output of `git diff` or `gh pr diff`). */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  if (!diff.trim()) return [];

  const lines = diff.split("\n");
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (!current) return;
    current.raw = buffer.join("\n");
    files.push(current);
    current = null;
    buffer = [];
  };

  for (const line of lines) {
    const header = FILE_HEADER_RE.exec(line);
    if (header) {
      flush();
      const [, oldPath, newPath] = header;
      current = {
        path: newPath!,
        oldPath: oldPath !== newPath ? oldPath : undefined,
        status: "modified",
        additions: 0,
        deletions: 0,
        raw: "",
        isBinaryMarked: false,
      };
      buffer = [line];
      continue;
    }

    if (!current) continue;
    buffer.push(line);

    if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("rename from") || line.startsWith("rename to"))
      current.status = "renamed";
    else if (line.startsWith("Binary files ")) current.isBinaryMarked = true;
    else if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      if (p !== "/dev/null" && p.startsWith("b/")) current.path = p.slice(2);
    } else if (line.startsWith("--- ")) {
      const p = line.slice(4).trim();
      if (p !== "/dev/null" && p.startsWith("a/")) {
        const old = p.slice(2);
        if (old !== current.path) current.oldPath = old;
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) current.additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) current.deletions++;
  }

  flush();
  return files;
}
