import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { parseClaimPath, ClaimPath } from "./domain.js";

export const MAX_CLAIM_PATHS = 10;

export function splitClaimPathList(value: string): readonly string[] {
  return value
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export async function normalizeClaimPaths(root: string, rawPaths: readonly string[]): Promise<ClaimPath[]> {
  const paths = rawPaths.map(normalizeClaimPathInput).filter((path) => path.length > 0);
  if (paths.length === 0) {
    throw new Error("claim requires at least one exact file path");
  }
  if (paths.length > MAX_CLAIM_PATHS) {
    throw new Error(`claim can cover at most ${MAX_CLAIM_PATHS} files`);
  }

  const seen = new Set<string>();
  const normalized: ClaimPath[] = [];
  for (const path of paths) {
    if (seen.has(path)) {
      throw new Error(`duplicate claim path: ${path}`);
    }
    if (!isExactClaimPathCandidate(path)) {
      throw new Error(`claim paths must be exact files, not folders or globs: ${path}`);
    }
    if (await isExistingDirectory(root, path)) {
      throw new Error(`claim paths must be exact files, not folders: ${path}`);
    }
    if (await hasKnownDescendants(root, path)) {
      throw new Error(`claim paths must be exact files, not folder prefixes: ${path}`);
    }
    seen.add(path);
    normalized.push(parseClaimPath(path));
  }

  return normalized;
}

export async function isFolderLikeClaimPath(root: string, path: string): Promise<boolean> {
  const normalized = normalizeClaimPathInput(path);
  if (!isExactClaimPathCandidate(normalized)) {
    return true;
  }
  if (await isExistingDirectory(root, normalized)) {
    return true;
  }
  return hasKnownDescendants(root, normalized);
}

export function normalizeClaimPathInput(raw: string): string {
  return raw
    .trim()
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\.\//u, "");
}

export function isExactClaimPathCandidate(path: string): boolean {
  if (path.length === 0) {
    return false;
  }
  if (path.includes("*") || path.includes("?")) {
    return false;
  }
  if (path.endsWith("/")) {
    return false;
  }
  if (path.startsWith("/") || /^[A-Za-z]:\//u.test(path)) {
    return false;
  }
  if (path.split("/").includes("..")) {
    return false;
  }
  return true;
}

async function isExistingDirectory(root: string, path: string): Promise<boolean> {
  try {
    return (await stat(join(root, path))).isDirectory();
  } catch {
    return false;
  }
}

async function hasKnownDescendants(root: string, path: string): Promise<boolean> {
  const result = spawnSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "--", `${path}/`],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if ((result.status ?? 1) !== 0) {
    return false;
  }
  return result.stdout.trim().length > 0;
}
