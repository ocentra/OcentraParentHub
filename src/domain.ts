import { Schema } from "effect";

const identityPattern = /^[A-Za-z0-9._-]+$/;
const writerPattern = /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/;
const eventHashPattern = /^sha256:[a-f0-9]{64}$/;

export const HubIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(80),
  Schema.pattern(identityPattern),
  Schema.brand("HubId"),
);
export type HubId = Schema.Schema.Type<typeof HubIdSchema>;

export const NodeIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(96),
  Schema.pattern(identityPattern),
  Schema.brand("NodeId"),
);
export type NodeId = Schema.Schema.Type<typeof NodeIdSchema>;

export const NodeNameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(96),
  Schema.pattern(identityPattern),
  Schema.brand("NodeName"),
);
export type NodeName = Schema.Schema.Type<typeof NodeNameSchema>;

export const LaneIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(80),
  Schema.pattern(identityPattern),
  Schema.brand("LaneId"),
);
export type LaneId = Schema.Schema.Type<typeof LaneIdSchema>;

export const WriterIdSchema = Schema.String.pipe(
  Schema.minLength(3),
  Schema.maxLength(180),
  Schema.pattern(writerPattern),
  Schema.brand("WriterId"),
);
export type WriterId = Schema.Schema.Type<typeof WriterIdSchema>;

export const EventIdSchema = Schema.String.pipe(
  Schema.minLength(8),
  Schema.maxLength(80),
  Schema.pattern(identityPattern),
  Schema.brand("EventId"),
);
export type EventId = Schema.Schema.Type<typeof EventIdSchema>;

export const EventHashSchema = Schema.String.pipe(
  Schema.pattern(eventHashPattern),
  Schema.brand("EventHash"),
);
export type EventHash = Schema.Schema.Type<typeof EventHashSchema>;

export const IsoTimestampSchema = Schema.String.pipe(
  Schema.minLength(20),
  Schema.brand("IsoTimestamp"),
);
export type IsoTimestamp = Schema.Schema.Type<typeof IsoTimestampSchema>;

export const ClaimPathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(260),
  Schema.brand("ClaimPath"),
);
export type ClaimPath = Schema.Schema.Type<typeof ClaimPathSchema>;

export const MessageAddressSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(120),
  Schema.brand("MessageAddress"),
);
export type MessageAddress = Schema.Schema.Type<typeof MessageAddressSchema>;

export const UserTextSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(4000),
  Schema.brand("UserText"),
);
export type UserText = Schema.Schema.Type<typeof UserTextSchema>;

export const TaskIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(120),
  Schema.pattern(identityPattern),
  Schema.brand("TaskId"),
);
export type TaskId = Schema.Schema.Type<typeof TaskIdSchema>;

export const SessionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(180),
  Schema.pattern(identityPattern),
  Schema.brand("SessionId"),
);
export type SessionId = Schema.Schema.Type<typeof SessionIdSchema>;

export const PullRequestUrlSchema = Schema.String.pipe(
  Schema.minLength(8),
  Schema.maxLength(500),
  Schema.pattern(/^https?:\/\/.+/),
  Schema.brand("PullRequestUrl"),
);
export type PullRequestUrl = Schema.Schema.Type<typeof PullRequestUrlSchema>;

export const PeerNameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(80),
  Schema.pattern(identityPattern),
  Schema.brand("PeerName"),
);
export type PeerName = Schema.Schema.Type<typeof PeerNameSchema>;

export const PeerUrlSchema = Schema.String.pipe(
  Schema.minLength(8),
  Schema.maxLength(500),
  Schema.pattern(/^https?:\/\/.+/),
  Schema.brand("PeerUrl"),
);
export type PeerUrl = Schema.Schema.Type<typeof PeerUrlSchema>;

export const WorkerStateSchema = Schema.Literal(
  "idle",
  "started",
  "progress",
  "working",
  "blocked",
  "pr_ready",
  "done",
  "offline",
).pipe(Schema.brand("WorkerState"));
export type WorkerState = Schema.Schema.Type<typeof WorkerStateSchema>;

export const TaskStateSchema = Schema.Literal(
  "queued",
  "started",
  "progress",
  "blocked",
  "pr_ready",
  "done",
  "cancelled",
).pipe(Schema.brand("TaskState"));
export type TaskState = Schema.Schema.Type<typeof TaskStateSchema>;

export const StatusStateSchema = Schema.Literal(
  "idle",
  "working",
  "blocked",
  "ready",
  "done",
  "handoff",
  "online",
).pipe(Schema.brand("StatusState"));
export type StatusState = Schema.Schema.Type<typeof StatusStateSchema>;

export const EventTypeSchema = Schema.Literal(
  "lane.register",
  "message",
  "ack",
  "claim",
  "release",
  "claim.resolve",
  "status",
  "heartbeat",
  "session.claim",
  "session.release",
  "worker.update",
  "task.update",
  "report",
  "handoff",
  "note",
).pipe(Schema.brand("EventType"));
export type EventType = Schema.Schema.Type<typeof EventTypeSchema>;

export const HubConfigSchema = Schema.Struct({
  hub: HubIdSchema,
  nodeId: NodeIdSchema,
  nodeName: NodeNameSchema,
  defaultLane: LaneIdSchema,
  createdAt: IsoTimestampSchema,
});
export type HubConfig = Schema.Schema.Type<typeof HubConfigSchema>;

export const parseHubId = Schema.decodeUnknownSync(HubIdSchema);
export const parseNodeId = Schema.decodeUnknownSync(NodeIdSchema);
export const parseNodeName = Schema.decodeUnknownSync(NodeNameSchema);
export const parseLaneId = Schema.decodeUnknownSync(LaneIdSchema);
export const parseWriterId = Schema.decodeUnknownSync(WriterIdSchema);
export const parseEventId = Schema.decodeUnknownSync(EventIdSchema);
export const parseEventHash = Schema.decodeUnknownSync(EventHashSchema);
export const parseIsoTimestamp = Schema.decodeUnknownSync(IsoTimestampSchema);
export const parseClaimPath = Schema.decodeUnknownSync(ClaimPathSchema);
export const parseMessageAddress = Schema.decodeUnknownSync(MessageAddressSchema);
export const parseUserText = Schema.decodeUnknownSync(UserTextSchema);
export const parseTaskId = Schema.decodeUnknownSync(TaskIdSchema);
export const parseSessionId = Schema.decodeUnknownSync(SessionIdSchema);
export const parsePullRequestUrl = Schema.decodeUnknownSync(PullRequestUrlSchema);
export const parsePeerName = Schema.decodeUnknownSync(PeerNameSchema);
export const parsePeerUrl = Schema.decodeUnknownSync(PeerUrlSchema);
export const parseWorkerState = Schema.decodeUnknownSync(WorkerStateSchema);
export const parseTaskState = Schema.decodeUnknownSync(TaskStateSchema);
export const parseStatusState = Schema.decodeUnknownSync(StatusStateSchema);
export const parseEventType = Schema.decodeUnknownSync(EventTypeSchema);
export const parseHubConfig = Schema.decodeUnknownSync(HubConfigSchema);

export function writerId(nodeId: NodeId, lane: LaneId): WriterId {
  return parseWriterId(`${nodeId}.${lane}`);
}

export function nowIso(): IsoTimestamp {
  return parseIsoTimestamp(new Date().toISOString());
}
