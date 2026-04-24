import {
  BINARY_EXTENSIONS,
  GENERATED_DIR_PREFIXES,
  GENERATED_FILE_NAMES,
  GENERATED_FILE_SUFFIXES,
  LOCKFILE_NAMES,
} from "./patterns.js";

export type FilterReason =
  | "lockfile"
  | "binary"
  | "generated_dir"
  | "generated_suffix"
  | "generated_name"
  | "custom_pattern";

export interface ClassifyResult {
  ignore: boolean;
  reason?: FilterReason;
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function extensionLower(path: string): string | null {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  if (i <= 0) return null;
  return name.slice(i + 1).toLowerCase();
}

export function classifyPath(
  path: string,
  extraIgnoreGlobs: string[] = [],
): ClassifyResult {
  const normalized = path.replace(/\\/g, "/");
  const name = basename(normalized);

  if (LOCKFILE_NAMES.has(name)) return { ignore: true, reason: "lockfile" };
  if (GENERATED_FILE_NAMES.has(name))
    return { ignore: true, reason: "generated_name" };

  for (const suffix of GENERATED_FILE_SUFFIXES) {
    if (name.endsWith(suffix)) return { ignore: true, reason: "generated_suffix" };
  }

  for (const prefix of GENERATED_DIR_PREFIXES) {
    if (normalized.startsWith(prefix) || normalized.includes("/" + prefix)) {
      return { ignore: true, reason: "generated_dir" };
    }
  }

  const ext = extensionLower(normalized);
  if (ext && BINARY_EXTENSIONS.has(ext)) return { ignore: true, reason: "binary" };

  for (const pattern of extraIgnoreGlobs) {
    if (matchesGlob(normalized, pattern)) {
      return { ignore: true, reason: "custom_pattern" };
    }
  }

  return { ignore: false };
}

function matchesGlob(path: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexSrc = "^" + escaped.replace(/\*\*/g, "::DOUBLESTAR::").replace(/\*/g, "[^/]*").replace(/::DOUBLESTAR::/g, ".*").replace(/\?/g, ".") + "$";
  return new RegExp(regexSrc).test(path);
}
