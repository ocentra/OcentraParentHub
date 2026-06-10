import { createHash } from "node:crypto";
import { Schema } from "effect";
import {
  ClaimPathSchema,
  EventHash,
  EventHashSchema,
  EventId,
  EventIdSchema,
  EventType,
  EventTypeSchema,
  HubIdSchema,
  IsoTimestampSchema,
  LaneId,
  LaneIdSchema,
  MessageAddressSchema,
  NodeIdSchema,
  NodeNameSchema,
  PullRequestUrlSchema,
  StatusStateSchema,
  TaskIdSchema,
  TaskStateSchema,
  UserTextSchema,
  WorkerStateSchema,
  WriterIdSchema,
  parseEventHash,
  parseEventId,
} from "./domain.js";

export const HubEventSchema = Schema.Struct({
  id: EventIdSchema,
  schema: Schema.Literal(1),
  hub: HubIdSchema,
  nodeId: NodeIdSchema,
  nodeName: NodeNameSchema,
  lane: LaneIdSchema,
  writer: WriterIdSchema,
  type: EventTypeSchema,
  ts: IsoTimestampSchema,
  seq: Schema.Number,
  prevEventId: Schema.Union(EventIdSchema, Schema.Null),
  prevHash: Schema.Union(EventHashSchema, Schema.Null),
  hash: EventHashSchema,
  to: Schema.optional(MessageAddressSchema),
  body: Schema.optional(UserTextSchema),
  messageId: Schema.optional(EventIdSchema),
  paths: Schema.optional(Schema.Array(ClaimPathSchema)),
  reason: Schema.optional(UserTextSchema),
  owner: Schema.optional(WriterIdSchema),
  state: Schema.optional(StatusStateSchema),
  workerState: Schema.optional(WorkerStateSchema),
  taskId: Schema.optional(TaskIdSchema),
  taskState: Schema.optional(TaskStateSchema),
  title: Schema.optional(UserTextSchema),
  prUrl: Schema.optional(PullRequestUrlSchema),
  summary: Schema.optional(UserTextSchema),
  ttlSeconds: Schema.optional(Schema.Number),
});
export type HubEvent = Schema.Schema.Type<typeof HubEventSchema>;

const decodeHubEvent = Schema.decodeUnknownSync(HubEventSchema);

export type NewEventInput = Omit<HubEvent, "id" | "seq" | "prevEventId" | "prevHash" | "hash">;

export function parseHubEvent(input: unknown): HubEvent {
  return decodeHubEvent(input);
}

export function completeEvent(input: NewEventInput, streamTip: HubEvent | undefined, rawEventId: string): HubEvent {
  const eventWithoutHash = {
    ...input,
    id: parseEventId(rawEventId),
    seq: streamTip === undefined ? 1 : streamTip.seq + 1,
    prevEventId: streamTip?.id ?? null,
    prevHash: streamTip?.hash ?? null,
  };
  return decodeHubEvent({
    ...eventWithoutHash,
    hash: hashForEvent(eventWithoutHash),
  });
}

export function assertEventHash(event: HubEvent): void {
  const expected = hashForEvent(withoutHash(event));
  if (event.hash !== expected) {
    throw new Error(`event ${event.id} hash mismatch`);
  }
}

export function hashForEvent(event: Omit<HubEvent, "hash">): EventHash {
  const serialized = JSON.stringify(canonicalize(event));
  const digest = createHash("sha256").update(serialized).digest("hex");
  return parseEventHash(`sha256:${digest}`);
}

export function eventType(value: EventType): EventType {
  return value;
}

export function targetLane(event: HubEvent): LaneId {
  return event.lane;
}

function withoutHash(event: HubEvent): Omit<HubEvent, "hash"> {
  const { hash: _hash, ...rest } = event;
  return rest;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}
