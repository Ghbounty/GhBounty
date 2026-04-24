import { classifyPath, type FilterReason } from "./classify.js";
import { parseUnifiedDiff, type DiffFile } from "./parse.js";

export interface FilterOptions {
  extraIgnoreGlobs?: string[];
  /** Filter files whose diff (additions + deletions) exceeds this count, regardless of path. Disabled when undefined. */
  maxChangedLines?: number;
}

export interface FilteredFile extends DiffFile {
  reason: FilterReason | "binary_marker" | "oversized";
}

export interface FilterResult {
  kept: DiffFile[];
  filtered: FilteredFile[];
  stats: {
    totalFiles: number;
    keptFiles: number;
    filteredFiles: number;
    keptBytes: number;
    filteredBytes: number;
  };
}

export function filterDiffFiles(
  files: DiffFile[],
  options: FilterOptions = {},
): FilterResult {
  const kept: DiffFile[] = [];
  const filtered: FilteredFile[] = [];

  for (const file of files) {
    if (file.isBinaryMarked) {
      filtered.push({ ...file, reason: "binary_marker" });
      continue;
    }

    const { ignore, reason } = classifyPath(
      file.path,
      options.extraIgnoreGlobs ?? [],
    );
    if (ignore) {
      filtered.push({ ...file, reason: reason ?? "custom_pattern" });
      continue;
    }

    if (
      options.maxChangedLines !== undefined &&
      file.additions + file.deletions > options.maxChangedLines
    ) {
      filtered.push({ ...file, reason: "oversized" });
      continue;
    }

    kept.push(file);
  }

  return {
    kept,
    filtered,
    stats: {
      totalFiles: files.length,
      keptFiles: kept.length,
      filteredFiles: filtered.length,
      keptBytes: kept.reduce((acc, f) => acc + f.raw.length, 0),
      filteredBytes: filtered.reduce((acc, f) => acc + f.raw.length, 0),
    },
  };
}

export function filterUnifiedDiff(
  diff: string,
  options: FilterOptions = {},
): FilterResult & { output: string } {
  const files = parseUnifiedDiff(diff);
  const result = filterDiffFiles(files, options);
  return {
    ...result,
    output: result.kept.map((f) => f.raw).join("\n"),
  };
}
