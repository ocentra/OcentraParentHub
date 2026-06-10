import { join } from "node:path";
import { LaneId, NodeId, WriterId, writerId } from "./domain.js";

export function streamsDir(root: string): string {
  return join(root, "streams");
}

export function archiveStreamsDir(root: string): string {
  return join(root, "archive", "streams");
}

export function archivedStreamDir(root: string, streamName: string): string {
  return join(archiveStreamsDir(root), streamName);
}

export function viewsDir(root: string): string {
  return join(root, "views");
}

export function laneViewsDir(root: string, lane: LaneId): string {
  return join(viewsDir(root), "lanes", lane);
}

export function streamPath(root: string, nodeId: NodeId, lane: LaneId): string {
  return join(streamsDir(root), `${writerId(nodeId, lane)}.ndjson`);
}

export function lockPath(root: string, nodeId: NodeId, lane: LaneId): string {
  return join(streamsDir(root), `${writerId(nodeId, lane)}.lock`);
}

export function writerFromStreamFile(fileName: string): WriterId | undefined {
  if (!fileName.endsWith(".ndjson")) {
    return undefined;
  }
  const writer = fileName.slice(0, -".ndjson".length);
  try {
    return writerIdFromRaw(writer);
  } catch {
    return undefined;
  }
}

function writerIdFromRaw(value: string): WriterId {
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === value.length - 1) {
    throw new Error(`invalid stream writer ${value}`);
  }
  return value as WriterId;
}
