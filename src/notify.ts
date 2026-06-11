import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { LaneId, WriterId, parseLaneId } from "./domain.js";
import { materialize, MaterializedHub, MaterializedHubJson } from "./materialize.js";

export type WakeReason = "inbox" | "pr-ready" | "done" | "blocked";
export type WakeSeverity = "normal" | "high";

export type WakeRequest = {
  readonly key: string;
  readonly targetLane: LaneId;
  readonly sourceLane: string;
  readonly reason: WakeReason;
  readonly severity: WakeSeverity;
  readonly summary: string;
  readonly eventId: string;
};

export type NotifyOptions = {
  readonly lane: LaneId;
  readonly root: string;
  readonly json?: boolean;
  readonly peek?: boolean;
  readonly exitCode?: boolean;
  readonly stateFile?: string;
};

export type NotifyResult = {
  readonly ok: true;
  readonly targetLane: LaneId;
  readonly checkedAt: string;
  readonly wakeRequests: readonly WakeRequest[];
};

type NotifierState = {
  readonly seen: Record<string, string>;
  readonly updatedAt?: string;
};

export async function notify(options: NotifyOptions): Promise<NotifyResult> {
  const state = await materialize(options.root);
  const notifierStatePath = resolveStatePath(options);
  const notifierState = await readNotifierState(notifierStatePath);
  const wakeRequests = collectWakeRequests(state, options.lane).filter((request) => notifierState.seen[request.key] === undefined);

  if (options.peek !== true) {
    await writeNotifierState(notifierStatePath, markSeen(notifierState, wakeRequests));
  }

  return {
    ok: true,
    targetLane: options.lane,
    checkedAt: new Date().toISOString(),
    wakeRequests,
  };
}

export function collectWakeRequests(materialized: MaterializedHub | MaterializedHubJson, targetLane: LaneId): readonly WakeRequest[] {
  const inboxRequests = collectInboxWakeRequests(materialized, targetLane);
  const reportRequests = targetLane === "primary" ? collectPrimaryReportWakeRequests(materialized) : [];
  return [...inboxRequests, ...reportRequests].sort((left, right) => left.key.localeCompare(right.key));
}

function collectInboxWakeRequests(materialized: MaterializedHub | MaterializedHubJson, targetLane: LaneId): readonly WakeRequest[] {
  const inbox = laneView(materialized, targetLane)?.inbox;
  if (!Array.isArray(inbox)) {
    return [];
  }
  return inbox
    .filter((item) => typeof item.id === "string" && item.ackedBy.length === 0)
    .map((item) => {
      const summary = firstLine(item.body ?? "Ledger message");
      return {
        key: `inbox:${targetLane}:${item.id}`,
        targetLane,
        sourceLane: sourceLaneFromWriter(item.from) ?? "unknown",
        reason: "inbox" as const,
        severity: "normal" as const,
        summary,
        eventId: item.id,
      };
    });
}

function collectPrimaryReportWakeRequests(materialized: MaterializedHub | MaterializedHubJson): readonly WakeRequest[] {
  const requests: WakeRequest[] = [];
  for (const worker of workerValues(materialized)) {
    if (worker.lane === "primary") {
      continue;
    }
    const summary = firstLine(worker.summary ?? "");
    const reason = handoffReason(summary);
    if (reason === undefined) {
      continue;
    }
    requests.push({
      key: `report:${worker.writer}:${worker.lastSeenAt}:${summary}`,
      targetLane: parseLaneId("primary"),
      sourceLane: worker.lane,
      reason,
      severity: reason === "blocked" ? "high" : "normal",
      summary,
      eventId: worker.lastSeenAt,
    });
  }
  return requests;
}

function handoffReason(summary: string): WakeReason | undefined {
  if (/^PR[-_ ]?READY\b/iu.test(summary)) {
    return "pr-ready";
  }
  if (/^DONE\b/iu.test(summary)) {
    return "done";
  }
  if (/^BLOCKED\b/iu.test(summary)) {
    return "blocked";
  }
  return undefined;
}

function laneView(materialized: MaterializedHub | MaterializedHubJson, lane: LaneId) {
  if (isReadonlyMap(materialized.lanes)) {
    return materialized.lanes.get(lane);
  }
  return materialized.lanes[lane];
}

function workerValues(materialized: MaterializedHub | MaterializedHubJson) {
  if (isReadonlyMap(materialized.workers)) {
    return Array.from(materialized.workers.values());
  }
  return Object.values(materialized.workers);
}

function isReadonlyMap<Key, Value>(value: ReadonlyMap<Key, Value> | Record<string, Value>): value is ReadonlyMap<Key, Value> {
  return value instanceof Map;
}

function resolveStatePath(options: NotifyOptions): string {
  if (options.stateFile !== undefined) {
    return resolve(options.stateFile);
  }
  return join(options.root, "notifier", `${options.lane}.json`);
}

async function readNotifierState(filePath: string): Promise<NotifierState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<NotifierState>;
    const seen = parsed !== null && typeof parsed.seen === "object" && parsed.seen !== null ? parsed.seen : {};
    return {
      seen,
      ...(parsed.updatedAt === undefined ? {} : { updatedAt: parsed.updatedAt }),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { seen: {} };
    }
    throw error;
  }
}

async function writeNotifierState(filePath: string, state: NotifierState): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function markSeen(state: NotifierState, wakeRequests: readonly WakeRequest[]): NotifierState {
  const seen = { ...state.seen };
  const now = new Date().toISOString();
  for (const request of wakeRequests) {
    seen[request.key] = now;
  }
  return { seen, updatedAt: now };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u)[0]?.trim() ?? "";
}

function sourceLaneFromWriter(writer: WriterId): string | undefined {
  return writer.split(".").at(-1);
}
