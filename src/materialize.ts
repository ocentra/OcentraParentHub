import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ClaimPath,
  LaneId,
  NodeId,
  NodeName,
  PullRequestUrl,
  TaskId,
  TaskState,
  WorkerState,
  WriterId,
  parseLaneId,
  parseWorkerState,
  writerId,
} from "./domain.js";
import { assertEventHash, HubEvent } from "./events.js";
import { laneViewsDir, viewsDir } from "./paths.js";
import { readAllStreams } from "./stream.js";

export type MaterializedHub = {
  readonly dashboard: DashboardView;
  readonly ownership: OwnershipView;
  readonly lanes: ReadonlyMap<LaneId, LaneView>;
  readonly workers: ReadonlyMap<WriterId, WorkerView>;
  readonly tasks: ReadonlyMap<TaskId, TaskView>;
  readonly warnings: readonly string[];
};

export type MaterializedHubJson = {
  readonly dashboard: DashboardView;
  readonly ownership: OwnershipView;
  readonly lanes: Record<string, LaneView>;
  readonly workers: Record<string, WorkerView>;
  readonly freeWorkers: readonly WorkerView[];
  readonly activeTasks: readonly TaskView[];
  readonly tasks: Record<string, TaskView>;
  readonly warnings: readonly string[];
};

export type DashboardView = {
  readonly eventCount: number;
  readonly duplicateCount: number;
  readonly laneCount: number;
  readonly inboxCount: number;
  readonly staleHeartbeatCount: number;
  readonly workerCount: number;
  readonly freeWorkerCount: number;
  readonly activeTaskCount: number;
  readonly conflictCount: number;
  readonly generatedAt: string;
};

export type OwnershipView = {
  readonly activeClaims: readonly ClaimView[];
  readonly conflicts: readonly OwnershipConflict[];
};

export type LaneView = {
  readonly lane: LaneId;
  readonly registeredWriters: readonly WriterId[];
  readonly inbox: readonly InboxItem[];
  readonly status?: StatusView;
  readonly heartbeat?: HeartbeatView;
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

export type HeartbeatView = {
  readonly state: string;
  readonly summary: string;
  readonly writer: WriterId;
  readonly ts: string;
  readonly ttlSeconds: number;
  readonly expiresAt: string;
  readonly stale: boolean;
};

export type WorkerView = {
  readonly writer: WriterId;
  readonly nodeId: NodeId;
  readonly nodeName: NodeName;
  readonly lane: LaneId;
  readonly state: WorkerState;
  readonly summary?: string;
  readonly currentTaskId?: TaskId;
  readonly lastSeenAt: string;
  readonly heartbeat?: HeartbeatView;
  readonly status?: StatusView;
  readonly activeClaims: readonly ClaimView[];
  readonly free: boolean;
};

export type TaskView = {
  readonly taskId: TaskId;
  readonly lane: LaneId;
  readonly writer: WriterId;
  readonly state: TaskState;
  readonly title?: string;
  readonly summary: string;
  readonly prUrl?: PullRequestUrl;
  readonly updatedAt: string;
  readonly eventId: string;
  readonly active: boolean;
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
  const writers = new Map<WriterId, WriterDirectoryEntry>();
  const workers = new Map<WriterId, MutableWorkerView>();
  const tasks = new Map<TaskId, TaskView>();
  const acks = new Map<string, Set<WriterId>>();
  const activeClaims = new Map<string, ClaimView>();

  for (const event of events) {
    const lane = ensureLane(lanes, event.lane);
    writers.set(event.writer, {
      writer: event.writer,
      nodeId: event.nodeId,
      nodeName: event.nodeName,
      lane: event.lane,
    });
    const worker = ensureWorker(workers, event);
    worker.lastSeenAt = event.ts;
    if (event.type === "lane.register") {
      lane.registeredWriters.add(event.writer);
      worker.state = parseWorkerState("idle");
      worker.summary = "registered";
    }
    if (event.type === "message" || event.type === "handoff") {
      const item: InboxItem = {
        id: event.id,
        from: event.writer,
        ts: event.ts,
        ackedBy: [],
        ...(event.to === undefined ? {} : { to: event.to }),
        ...(event.body === undefined ? {} : { body: event.body }),
      };
      for (const targetLane of inboxTargetLanes(event, writers, lanes)) {
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
      worker.status = lane.status;
      worker.summary = event.summary;
    }
    if (event.type === "heartbeat" && event.state !== undefined && event.summary !== undefined) {
      const ttlSeconds = event.ttlSeconds ?? 180;
      const expiresAt = new Date(Date.parse(event.ts) + ttlSeconds * 1000).toISOString();
      lane.heartbeat = {
        state: event.state,
        summary: event.summary,
        writer: event.writer,
        ts: event.ts,
        ttlSeconds,
        expiresAt,
        stale: Date.parse(expiresAt) < Date.now(),
      };
      worker.heartbeat = lane.heartbeat;
      if (!lane.heartbeat.stale && worker.state === "offline") {
        worker.state = parseWorkerState("idle");
      }
      worker.summary = event.summary;
    }
    if (event.type === "worker.update" && event.workerState !== undefined && event.summary !== undefined) {
      worker.state = event.workerState;
      worker.summary = event.summary;
      if (event.taskId === undefined) {
        delete worker.currentTaskId;
      } else {
        worker.currentTaskId = event.taskId;
      }
    }
    if (event.type === "task.update" && event.taskId !== undefined && event.taskState !== undefined && event.summary !== undefined) {
      const task: TaskView = {
        taskId: event.taskId,
        lane: event.lane,
        writer: event.writer,
        state: event.taskState,
        summary: event.summary,
        updatedAt: event.ts,
        eventId: event.id,
        active: isTaskActive(event.taskState),
        ...(event.title === undefined ? {} : { title: event.title }),
        ...(event.prUrl === undefined ? {} : { prUrl: event.prUrl }),
      };
      tasks.set(event.taskId, task);
      if (task.active) {
        worker.currentTaskId = event.taskId;
      } else {
        delete worker.currentTaskId;
      }
      worker.state = workerStateFromTaskState(event.taskState);
      worker.summary = event.summary;
    }
    if (event.type === "report" && event.summary !== undefined) {
      worker.summary = event.summary;
      if (event.taskId !== undefined) {
        worker.currentTaskId = event.taskId;
      }
    }
    if (event.type === "claim" && event.paths !== undefined) {
      for (const path of event.paths) {
        const claim: ClaimView = {
          writer: event.writer,
          lane: event.lane,
          paths: [path],
          eventId: event.id,
          ...(event.reason === undefined ? {} : { reason: event.reason }),
        };
        activeClaims.set(claimKey(event.writer, path), claim);
      }
      if (event.reason !== undefined) {
        worker.summary = event.reason;
      }
    }
    if (event.type === "release" && event.paths !== undefined) {
      for (const path of event.paths) {
        activeClaims.delete(claimKey(event.writer, path));
      }
    }
    if (event.type === "claim.resolve" && event.paths !== undefined) {
      for (const path of event.paths) {
        for (const [key, claim] of activeClaims) {
          const overlaps = overlappingPaths(claim.paths, [path]).length > 0;
          if (overlaps && claim.writer !== event.owner) {
            activeClaims.delete(key);
          }
        }
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
  const frozenLanes = freezeLanes(lanes);
  const frozenWorkers = freezeWorkers(workers, ownership.activeClaims, tasks);
  const freeWorkers = [...frozenWorkers.values()].filter((worker) => worker.free);
  const activeTasks = [...tasks.values()].filter((task) => task.active);
  const dashboard = {
    eventCount: events.length,
    duplicateCount,
    laneCount: frozenLanes.size,
    inboxCount: [...frozenLanes.values()].reduce((count, lane) => count + lane.inbox.length, 0),
    staleHeartbeatCount: [...frozenLanes.values()].filter((lane) => lane.heartbeat?.stale === true).length,
    workerCount: frozenWorkers.size,
    freeWorkerCount: freeWorkers.length,
    activeTaskCount: activeTasks.length,
    conflictCount: ownership.conflicts.length,
    generatedAt: new Date().toISOString(),
  };

  const result = { dashboard, ownership, lanes: frozenLanes, workers: frozenWorkers, tasks, warnings };
  await writeViews(root, result);
  return result;
}

export function materializedToJson(state: MaterializedHub): MaterializedHubJson {
  return {
    dashboard: state.dashboard,
    ownership: state.ownership,
    lanes: Object.fromEntries(state.lanes.entries()),
    workers: Object.fromEntries(state.workers.entries()),
    freeWorkers: getFreeWorkers(state),
    activeTasks: getActiveTasks(state),
    tasks: Object.fromEntries(state.tasks.entries()),
    warnings: state.warnings,
  };
}

export function getWorkers(state: MaterializedHub): readonly WorkerView[] {
  return [...state.workers.values()];
}

export function getFreeWorkers(state: MaterializedHub): readonly WorkerView[] {
  return getWorkers(state).filter((worker) => worker.free);
}

export function getActiveTasks(state: MaterializedHub): readonly TaskView[] {
  return [...state.tasks.values()].filter((task) => task.active);
}

function ensureLane(lanes: Map<LaneId, MutableLaneView>, lane: LaneId): MutableLaneView {
  const existing = lanes.get(lane);
  if (existing !== undefined) {
    return existing;
  }
  const view: MutableLaneView = {
    lane,
    registeredWriters: new Set<WriterId>(),
    inbox: [],
    ackedMessageIds: [],
  };
  lanes.set(lane, view);
  return view;
}

type MutableLaneView = {
  readonly lane: LaneId;
  readonly registeredWriters: Set<WriterId>;
  inbox: InboxItem[];
  status?: StatusView;
  heartbeat?: HeartbeatView;
  ackedMessageIds: string[];
};

type WriterDirectoryEntry = {
  readonly writer: WriterId;
  readonly nodeId: NodeId;
  readonly nodeName: NodeName;
  readonly lane: LaneId;
};

type MutableWorkerView = {
  readonly writer: WriterId;
  readonly nodeId: NodeId;
  readonly nodeName: NodeName;
  readonly lane: LaneId;
  state: WorkerState;
  summary?: string;
  currentTaskId?: TaskId;
  lastSeenAt: string;
  heartbeat?: HeartbeatView;
  status?: StatusView;
};

function ensureWorker(workers: Map<WriterId, MutableWorkerView>, event: HubEvent): MutableWorkerView {
  const existing = workers.get(event.writer);
  if (existing !== undefined) {
    return existing;
  }
  const worker: MutableWorkerView = {
    writer: event.writer,
    nodeId: event.nodeId,
    nodeName: event.nodeName,
    lane: event.lane,
    state: parseWorkerState("idle"),
    lastSeenAt: event.ts,
  };
  workers.set(event.writer, worker);
  return worker;
}

function freezeLanes(lanes: ReadonlyMap<LaneId, MutableLaneView>): ReadonlyMap<LaneId, LaneView> {
  return new Map(
    [...lanes.entries()].map(([laneId, lane]) => [
      laneId,
      {
        lane: lane.lane,
        registeredWriters: [...lane.registeredWriters],
        inbox: lane.inbox,
        ...(lane.status === undefined ? {} : { status: lane.status }),
        ...(lane.heartbeat === undefined ? {} : { heartbeat: lane.heartbeat }),
        ackedMessageIds: lane.ackedMessageIds,
      },
    ]),
  );
}

function freezeWorkers(
  workers: ReadonlyMap<WriterId, MutableWorkerView>,
  activeClaims: readonly ClaimView[],
  tasks: ReadonlyMap<TaskId, TaskView>,
): ReadonlyMap<WriterId, WorkerView> {
  return new Map(
    [...workers.entries()].map(([writer, worker]) => {
      const claims = activeClaims.filter((claim) => claim.writer === writer);
      const currentTask = worker.currentTaskId === undefined ? undefined : tasks.get(worker.currentTaskId);
      const heartbeatStale = worker.heartbeat?.stale === true;
      const free = !heartbeatStale
        && claims.length === 0
        && (currentTask === undefined || !currentTask.active)
        && (worker.state === "idle" || worker.state === "done");
      return [
        writer,
        {
          writer: worker.writer,
          nodeId: worker.nodeId,
          nodeName: worker.nodeName,
          lane: worker.lane,
          state: heartbeatStale ? parseWorkerState("offline") : worker.state,
          lastSeenAt: worker.lastSeenAt,
          activeClaims: claims,
          free,
          ...(worker.summary === undefined ? {} : { summary: worker.summary }),
          ...(worker.currentTaskId === undefined ? {} : { currentTaskId: worker.currentTaskId }),
          ...(worker.heartbeat === undefined ? {} : { heartbeat: worker.heartbeat }),
          ...(worker.status === undefined ? {} : { status: worker.status }),
        },
      ];
    }),
  );
}

function isTaskActive(state: TaskState): boolean {
  return state !== "done" && state !== "cancelled";
}

function workerStateFromTaskState(state: TaskState): WorkerState {
  switch (state) {
    case "queued":
      return parseWorkerState("idle");
    case "started":
      return parseWorkerState("started");
    case "progress":
      return parseWorkerState("progress");
    case "blocked":
      return parseWorkerState("blocked");
    case "pr_ready":
      return parseWorkerState("pr_ready");
    case "done":
    case "cancelled":
      return parseWorkerState("done");
    default:
      return parseWorkerState("idle");
  }
}

function claimKey(writer: WriterId, path: ClaimPath): string {
  return `${writer}:${path}`;
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

function inboxTargetLanes(
  event: HubEvent,
  writers: ReadonlyMap<WriterId, WriterDirectoryEntry>,
  lanes: ReadonlyMap<LaneId, MutableLaneView>,
): readonly LaneId[] {
  if (event.to === undefined || event.to === "*") {
    return lanes.size === 0 ? [event.lane] : [...lanes.keys()];
  }
  const raw = String(event.to);
  if (raw.endsWith(".*")) {
    const node = raw.slice(0, -2);
    const matches = [...writers.values()]
      .filter((entry) => entry.nodeId === node || entry.nodeName === node)
      .map((entry) => entry.lane);
    return uniqueLanes(matches.length === 0 ? [event.lane] : matches);
  }
  const specificWriter = [...writers.values()].find((entry) => entry.writer === raw);
  if (specificWriter !== undefined) {
    return [specificWriter.lane];
  }
  const lanePart = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw;
  try {
    return [parseLaneId(lanePart)];
  } catch {
    return [event.lane];
  }
}

function uniqueLanes(lanes: readonly LaneId[]): readonly LaneId[] {
  return [...new Map(lanes.map((lane) => [lane, lane])).values()];
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
  await writeFile(join(viewsDir(root), "workers.json"), `${JSON.stringify(getWorkers(state), null, 2)}\n`);
  await writeFile(join(viewsDir(root), "free-workers.json"), `${JSON.stringify(getFreeWorkers(state), null, 2)}\n`);
  await writeFile(join(viewsDir(root), "active-tasks.json"), `${JSON.stringify(getActiveTasks(state), null, 2)}\n`);
  for (const lane of state.lanes.values()) {
    const laneDir = laneViewsDir(root, parseLaneId(lane.lane));
    await mkdir(laneDir, { recursive: true });
    await writeFile(
      join(laneDir, "status.json"),
      `${JSON.stringify(lane.status ?? null, null, 2)}\n`,
    );
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
