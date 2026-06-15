import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_CLAIM_PATHS, normalizeClaimPaths } from "./claim-policy.js";

describe("claim policy", () => {
  it("accepts exact file claims", async () => {
    const root = await tempRoot();
    await gitInit(root);
    await mkdir(join(root, "src", "auth"), { recursive: true });
    await writeFile(join(root, "src", "auth", "login.ts"), "");

    await expect(normalizeClaimPaths(root, ["src/auth/login.ts"])).resolves.toEqual([
      "src/auth/login.ts",
    ]);
  });

  it("rejects folder claims and oversized batches", async () => {
    const root = await tempRoot();
    await gitInit(root);
    await mkdir(join(root, "docs", "plans"), { recursive: true });
    await writeFile(join(root, "docs", "plans", "readme.md"), "");

    await expect(normalizeClaimPaths(root, ["docs/plans"])).rejects.toThrow(/exact files/);

    const batch = Array.from({ length: MAX_CLAIM_PATHS + 1 }, (_, index) => `src/file-${index}.ts`);
    await expect(normalizeClaimPaths(root, batch)).rejects.toThrow(/at most 10/);
  });
});

async function tempRoot(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  return mkdtemp(join(tmpdir(), "ocentra-claim-policy-"));
}

function gitInit(root: string): void {
  const result = spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || "git init failed");
  }
}
