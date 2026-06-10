import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  HubConfig,
  HubId,
  LaneId,
  NodeId,
  NodeName,
  nowIso,
  parseHubConfig,
  parseHubId,
  parseLaneId,
  parseNodeId,
  parseNodeName,
} from "./domain.js";

export function identityDir(root: string): string {
  return join(root, "identity");
}

export function identityPath(root: string): string {
  return join(identityDir(root), "node.json");
}

export async function initIdentity(input: {
  root: string;
  hub: string;
  lane: string;
  nodeId?: string;
  nodeName?: string;
}): Promise<HubConfig> {
  const config: HubConfig = {
    hub: parseHubId(input.hub),
    nodeId: parseNodeId(input.nodeId ?? randomNodeId()),
    nodeName: parseNodeName(input.nodeName ?? displayHostname()),
    defaultLane: parseLaneId(input.lane),
    createdAt: nowIso(),
  };

  await mkdir(identityDir(input.root), { recursive: true });
  await writeFile(identityPath(input.root), `${JSON.stringify(config, null, 2)}\n`, {
    flag: "wx",
  });
  return config;
}

export async function loadIdentity(root: string): Promise<HubConfig> {
  const raw = await readFile(identityPath(root), "utf8");
  return parseHubConfig(JSON.parse(raw));
}

export function randomEventId(): string {
  return `evt_${randomUUID().replaceAll("-", "")}`;
}

function randomNodeId(): NodeId {
  return parseNodeId(`node_${randomUUID().replaceAll("-", "")}`);
}

function displayHostname(): NodeName {
  return parseNodeName(hostname().replaceAll(/[^A-Za-z0-9._-]/g, "_"));
}

export function resolveHubId(config: HubConfig): HubId {
  return config.hub;
}

export function resolveNodeId(config: HubConfig): NodeId {
  return config.nodeId;
}

export function resolveNodeName(config: HubConfig): NodeName {
  return config.nodeName;
}

export function resolveLane(config: HubConfig, lane?: string): LaneId {
  return lane === undefined ? config.defaultLane : parseLaneId(lane);
}
