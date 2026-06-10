import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ClaimPath, LaneId, WriterId, parseLaneId } from "./domain.js";
import { assertEventHash, HubEvent } from "./events.js";
import { laneViewsDir, viewsDir } from "./paths.js";
import { readAllStreams } from "./stream.js";

export type MaterializedHub = {
  readonly dashboard: DashboardView;
  readonly ownership: OwnershipView;
  readonly lanes: ReadonlyMap<LaneId, LaneView>;
  readonly warnings: readonly string[];
};

export type MaterializedHubJson = {
  readonly dashboard: DashboardView;
  readonly ownership: OwnershipView;
  readonly lanes: Record<string, LaneView>;
  readonly warnings: readonly string[];
};

export type DashboardView = {
  readonly eventCount: number;
  readonly duplicateCount: number;
  readonly laneCount: number;
  readonly inboxCount: number;
  readonly conflictCount: number;
  readonly generatedAt: string;
};

export type OwnershipView = {
  readonly activeClaims: readonly ClaimView[];
  readonly conflicts: readonly OwnershipConflict[];
};

export type LaneView = {
  readonly lane: LaneId;
  readonly inbox: readonly InboxItem[];
  readonly status?: StatusView;
  readonly ackedMessageIds: readonly string[];
};

export type InboxItem = {
  readonly id: string;
  readonly from: WriterId;
  readonly to?: string;
  readonly body?: string;
  readonly ts: string;
  readonly ackedBy: readonly WriterId[];
};

export type StatusView = {
  readonly state: string;
  readonly summary: string;
  readonly writer: WriterId;
  readonly ts: string;
};

export type ClaimView = {
  readonly writer: WriterId;
  readonly lane: LaneId;
  readonly paths: readonly ClaimPath[];
  readonly reason?: string;
  readonly eventId: string;
};

export type OwnershipConflict = {
  readonly type: "ownership-conflict";
  readonly paths: readonly string[];
  readonly lanes: readonly WriterId[];
  readonly eventIds: readonly string[];
};

export async function materialize(root: string): Promise<MaterializedHub> {
  const { events, duplicateCount, warnings } = await readAllStreams(root);
  for (const event of events) {
    assertEventHash(event);
  }

  const lanes = new Map<LaneId, MutableLaneView>();
  const acks = new Map<string, Set<WriterId>>();
  const activeClaims = new Map<string, ClaimView>();

  for (const event of events) {
    const lane = ensureLane(lanes, event.lane);
    if (event.type === "message" || event.type === "handoff") {
      const item: InboxItem = {
        id: event.id,
        from: event.writer,
        ts: event.ts,
        ackedBy: [],
        ...(event.to === undefined ? {} : { to: event.to }),
        ...(event.body === undefined ? {} : { body: event.body }),
      };
      for (const targetLane of inboxTargetLanes(event)) {
        ensureLane(lanes, targetLane).inbox.push(item);
      }
    }
    if (event.type === "ack" && event.messageId !== undefined) {
      const ackedBy = acks.get(event.messageId) ?? new Set<WriterId>();
      ackedBy.add(event.writer);
      acks.set(event.messageId, ackedBy);
      lane.ackedMessageIds.push(event.messageId);
    }
    if (event.type === "status" && event.state !== undefined && event.summary !== undefined) {
      lane.status = {
        state: event.state,
        summary: event.summary,
        writer: event.writer,
        ts: event.ts,
      };
    }
    if (event.type === "claim" && event.paths !== undefined) {
      const claim: ClaimView = {
        writer: event.writer,
        lane: event.lane,
        paths: event.paths,
        eventId: event.id,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      };
      activeClaims.set(claimKey(event), claim);
    }
    if (event.type === "release" && event.paths !== undefined) {
      for (const path of event.paths) {
        activeClaims.delete(`${event.writer}:${path}`);
      }
    }
  }

  for (const lane of lanes.values()) {
    lane.inbox = lane.inbox.map((item) => ({
      ...item,
      ackedBy: [...(acks.get(item.id) ?? new Set<WriterId>())],
    }));
  }

  const ownership = {
    activeClaims: [...activeClaims.values()],
    conflicts: detectConflicts([...activeClaims.values()]),
  };
  const dashboard = {
    eventCount: events.length,
    duplicateCount,
    laneCount: lanes.size,
    inboxCount: [...lanes.values()].reduce((count, lane) => count + lane.inbox.length, 0),
    conflictCount: ownership.conflicts.length,
    generatedAt: new Date().toISOString(),
  };

  const result = { dashboard, ownership, lanes, warnings };
  await writeViews(root, result);
  return result;
}

export function materializedToJson(state: MaterializedHub): MaterializedHubJson {
  return {
    dashboard: state.dashboard,
    ownership: state.ownership,
    lanes: Object.fromEntries(state.lanes.entries()),
    warnings: state.warnings,
  };
}

function ensureLane(lanes: Map<LaneId, MutableLaneView>, lane: LaneId): MutableLaneView {
  const existing = lanes.get(lane);
  if (existing !== undefined) {
    return existing;
  }
  const view: MutableLaneView = {
    lane,
    inbox: [],
    ackedMessageIds: [],
  };
  lanes.set(lane, view);
  return view;
}

type MutableLaneView = {
  readonly lane: LaneId;
  inbox: InboxItem[];
  status?: StatusView;
  ackedMessageIds: string[];
};

function claimKey(event: HubEvent): string {
  return `${event.writer}:${event.paths?.join("\u0000") ?? ""}`;
}

function detectConflicts(claims: readonly ClaimView[]): OwnershipConflict[] {
  const conflicts: OwnershipConflict[] = [];
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const left = claims[leftIndex];
      const right = claims[rightIndex];
      if (left === undefined || right === undefined || left.writer === right.writer) {
        continue;
      }
      const overlapping = overlappingPaths(left.paths, right.paths);
      if (overlapping.length > 0) {
        conflicts.push({
          type: "ownership-conflict",
          paths: overlapping,
          lanes: [left.writer, right.writer],
          eventIds: [left.eventId, right.eventId],
        });
      }
    }
  }
  return conflicts;
}

function inboxTargetLanes(event: HubEvent): readonly LaneId[] {
  if (event.to === undefined || event.to === "*") {
    return [event.lane];
  }
  const raw = String(event.to);
  if (raw.includes("*")) {
    return [event.lane];
  }
  const lanePart = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
  try {
    return [parseLaneId(lanePart)];
  } catch {
    return [event.lane];
  }
}

function overlappingPaths(left: readonly ClaimPath[], right: readonly ClaimPath[]): string[] {
  const matches = new Set<string>();
  for (const leftPath of left) {
    for (const rightPath of right) {
      if (pathsOverlap(leftPath, rightPath)) {
        matches.add(leftPath);
        matches.add(rightPath);
      }
    }
  }
  return [...matches].sort();
}

function pathsOverlap(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  const leftPrefix = left.replace(/\*\*?$/u, "");
  const rightPrefix = right.replace(/\*\*?$/u, "");
  return left.startsWith(rightPrefix) || right.startsWith(leftPrefix);
}

async function writeViews(root: string, state: MaterializedHub): Promise<void> {
  await mkdir(viewsDir(root), { recursive: true });
  await writeFile(join(viewsDir(root), "dashboard.json"), `${JSON.stringify(state.dashboard, null, 2)}\n`);
  await writeFile(join(viewsDir(root), "ownership.json"), `${JSON.stringify(state.ownership, null, 2)}\n`);
  for (const lane of state.lanes.values()) {
    const laneDir = laneViewsDir(root, parseLaneId(lane.lane));
    await mkdir(laneDir, { recursive: true });
    await writeFile(join(laneDir, "status.json"), `${JSON.stringify(lane.status ?? null, null, 2)}\n`);
    await writeFile(join(laneDir, "inbox.md"), renderInbox(lane));
  }
}

function renderInbox(lane: LaneView): string {
  const lines = [`# Inbox: ${lane.lane}`, ""];
  for (const item of lane.inbox) {
    const acked = item.ackedBy.length === 0 ? "unacked" : `acked by ${item.ackedBy.join(", ")}`;
    lines.push(`- ${item.id} from ${item.from}: ${item.body ?? ""} (${acked})`);
  }
  return `${lines.join("\n")}\n`;
}
