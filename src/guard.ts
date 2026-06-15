import { LaneId, parseLaneId } from "./domain.js";
import { inspectLedger, LedgerDiagnostic } from "./doctor.js";
import { ClaimView, materialize } from "./materialize.js";
import { MAX_CLAIM_PATHS, isFolderLikeClaimPath } from "./claim-policy.js";

export type GuardResult = {
  readonly ok: boolean;
  readonly lane: LaneId;
  readonly findings: readonly string[];
  readonly diagnostics: readonly LedgerDiagnostic[];
};

export async function guardLedger(
  root: string,
  input: {
    readonly lane: string;
    readonly changedPaths?: readonly string[];
    readonly allowPrimaryWithoutClaims?: boolean;
    readonly sessionId?: string;
  },
): Promise<GuardResult> {
  const lane = parseLaneId(input.lane);
  const state = await materialize(root);
  const inspection = await inspectLedger(root);
  const findings: string[] = [];
  const laneView = state.lanes.get(lane);
  const activeSession = state.sessions.get(lane);
  if (input.sessionId !== undefined && activeSession !== undefined && activeSession.sessionId !== input.sessionId) {
    findings.push(`lane ${lane} is owned by active session ${activeSession.sessionId}`);
  }
  const unread = laneView?.inbox.filter((item) => item.ackedBy.length === 0) ?? [];
  if (lane !== "primary" && unread.length > 0) {
    findings.push(`lane ${lane} has ${unread.length} unread ledger message(s)`);
  }
  for (const conflict of state.ownership.conflicts) {
    findings.push(`ownership conflict: ${conflict.paths.join(", ")} owned by ${conflict.lanes.join(", ")}`);
  }

  const changedPaths = (input.changedPaths ?? [])
    .map(normalizeRepoPath)
    .filter((path) => path.length > 0);
  if (changedPaths.length > 0 && (lane !== "primary" || input.allowPrimaryWithoutClaims !== true)) {
    const laneClaims = state.ownership.activeClaims.filter((claim) => claim.lane === lane);
    if (laneClaims.length === 0) {
      findings.push(`lane ${lane} has changed files but no active ledger claim`);
    } else {
      for (const path of changedPaths) {
        if (!laneClaims.some((claim) => claimMatchesPath(claim, path))) {
          findings.push(`changed path ${path} is outside active ledger claims for lane ${lane}`);
        }
      }
    }
  }

  for (const claim of state.ownership.activeClaims.filter((item) => item.lane === lane)) {
    for (const path of claim.paths) {
      if (await isFolderLikeClaimPath(root, String(path))) {
        findings.push(`lane ${lane} has non-exact claim path ${path}; claims must be exact files`);
      }
    }
  }
  if (state.ownership.activeClaims.filter((claim) => claim.lane === lane).length > MAX_CLAIM_PATHS) {
    findings.push(`lane ${lane} has more than ${MAX_CLAIM_PATHS} active ledger claims`);
  }

  for (const diagnostic of inspection.diagnostics) {
    if (diagnostic.level === "error") {
      findings.push(`${diagnostic.stream}: ${diagnostic.message}`);
    }
  }

  return {
    ok: findings.length === 0,
    lane,
    findings,
    diagnostics: inspection.diagnostics,
  };
}

function claimMatchesPath(claim: ClaimView, path: string): boolean {
  return claim.paths.some((claimPath) => pathMatchesClaim(path, normalizeRepoPath(claimPath)));
}

function pathMatchesClaim(path: string, claimPath: string): boolean {
  return path === claimPath;
}

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\.\//u, "").toLowerCase();
}
