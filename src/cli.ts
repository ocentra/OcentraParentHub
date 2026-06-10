#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseClaimPath,
  parseEventId,
  parseLaneId,
  parseMessageAddress,
  parsePeerName,
  parsePullRequestUrl,
  parseStatusState,
  parseTaskId,
  parseTaskState,
  parseUserText,
  parseWorkerState,
  parseWriterId,
} from "./domain.js";
import { ensureDaemon } from "./daemon.js";
import { inspectLedger } from "./doctor.js";
import { initIdentity, loadIdentity, resolveLane } from "./identity.js";
import { getActiveTasks, getFreeWorkers, getWorkers, materialize, materializedToJson } from "./materialize.js";
import { streamsDir } from "./paths.js";
import { addPeer, loadPeerRegistry, resolvePeer } from "./peers.js";
import { compactLedger } from "./retention.js";
import { resolveLedgerRoot } from "./root.js";
import { startPeerServer } from "./server.js";
import { appendEvent } from "./stream.js";
import { syncFromHttpPeer } from "./sync/http.js";
import { syncFromPeer } from "./sync/local.js";

const args = process.argv.slice(2);
const root = resolveLedgerRoot();

await main(args);

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "init":
      await commandInit(rest);
      return;
    case "root":
      print({ root });
      return;
    case "lane":
      await commandLane(rest);
      return;
    case "start":
      await commandStart(rest);
      return;
    case "msg":
      await commandMessage(rest);
      return;
    case "inbox":
      await commandInbox(rest);
      return;
    case "ack":
      await commandAck(rest);
      return;
    case "handoff":
      await commandHandoff(rest);
      return;
    case "note":
      await commandNote(rest);
      return;
    case "claim":
      await commandClaim(rest);
      return;
    case "release":
      await commandRelease(rest);
      return;
    case "resolve":
      await commandResolve(rest);
      return;
    case "status":
      await commandStatus(rest);
      return;
    case "task":
      await commandTask(rest);
      return;
    case "worker":
      await commandWorker(rest);
      return;
    case "report":
      await commandReport(rest);
      return;
    case "workers":
      await commandWorkers(rest);
      return;
    case "tasks":
      await commandTasks(rest);
      return;
    case "materialize":
      print(materializedToJson(await materialize(root)));
      return;
    case "compact":
      await commandCompact(rest);
      return;
    case "doctor":
      await commandDoctor();
      return;
    case "streams":
      await commandStreams();
      return;
    case "sync":
      await commandSync(rest);
      return;
    case "peer":
      await commandPeer(rest);
      return;
    case "serve":
      await commandServe(rest);
      return;
    case "ensure":
      await commandEnsure(rest);
      return;
    default:
      throw new Error(`unknown command: ${command ?? "(missing)"}`);
  }
}

async function commandInit(argv: string[]): Promise<void> {
  const [hub] = argv;
  if (hub === undefined) {
    throw new Error("usage: ledger init <hub> --lane <lane>");
  }
  const lane = optionValue(argv, "--lane") ?? "primary";
  print(await initIdentity({ root, hub, lane }));
}

async function commandLane(argv: string[]): Promise<void> {
  const [subcommand, lane] = argv;
  if (subcommand !== "register" || lane === undefined) {
    throw new Error("usage: ledger lane register <lane>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, parseLaneId(lane), { type: "lane.register" }));
}

async function commandStart(argv: string[]): Promise<void> {
  const laneRaw = argv[0];
  const config = await loadIdentity(root);
  const lane = resolveLane(config, laneRaw);
  const ttlSeconds = Number(optionValue(argv, "--ttl-seconds") ?? "180");
  const summary = optionValue(argv, "--summary") ?? "lane started";
  const registered = await appendEvent(root, config, lane, { type: "lane.register" });
  const heartbeat = await appendEvent(root, config, lane, {
    type: "heartbeat",
    state: parseStatusState("online"),
    summary: parseUserText(summary),
    ttlSeconds,
  });
  const state = await materialize(root);
  const inbox = state.lanes.get(lane)?.inbox.filter((item) => item.ackedBy.length === 0) ?? [];
  print({
    lane,
    registeredEventId: registered.id,
    heartbeatEventId: heartbeat.id,
    unreadCount: inbox.length,
    inbox,
    staleHeartbeatCount: state.dashboard.staleHeartbeatCount,
  });
}

async function commandMessage(argv: string[]): Promise<void> {
  const [to, ...bodyParts] = argv;
  if (to === undefined || bodyParts.length === 0) {
    throw new Error("usage: ledger msg <to> <body>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, config.defaultLane, {
    type: "message",
    to: parseMessageAddress(to),
    body: parseUserText(bodyParts.join(" ")),
  }));
}

async function commandInbox(argv: string[]): Promise<void> {
  const all = argv.includes("--all");
  const laneArg = argv.find((arg) => !arg.startsWith("--"));
  const lane = parseLaneId(laneArg ?? (await loadIdentity(root)).defaultLane);
  const state = await materialize(root);
  const inbox = state.lanes.get(lane)?.inbox ?? [];
  print(all ? inbox : inbox.filter((item) => item.ackedBy.length === 0));
}

async function commandAck(argv: string[]): Promise<void> {
  const [messageId] = argv;
  if (messageId === undefined) {
    throw new Error("usage: ledger ack <messageId>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, config.defaultLane, {
    type: "ack",
    messageId: parseEventId(messageId),
  }));
}

async function commandHandoff(argv: string[]): Promise<void> {
  const [to, ...bodyParts] = argv;
  if (to === undefined || bodyParts.length === 0) {
    throw new Error("usage: ledger handoff <to> <body>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, config.defaultLane, {
    type: "handoff",
    to: parseMessageAddress(to),
    body: parseUserText(bodyParts.join(" ")),
  }));
}

async function commandNote(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    throw new Error("usage: ledger note <body>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, config.defaultLane, {
    type: "note",
    body: parseUserText(argv.join(" ")),
  }));
}

async function commandClaim(argv: string[]): Promise<void> {
  const [laneRaw, pathRaw] = argv;
  if (laneRaw === undefined || pathRaw === undefined) {
    throw new Error("usage: ledger claim <lane> <path> [--reason <reason>]");
  }
  const config = await loadIdentity(root);
  const reason = optionValue(argv, "--reason");
  print(await appendEvent(root, config, parseLaneId(laneRaw), {
    type: "claim",
    paths: [parseClaimPath(pathRaw)],
    ...(reason === undefined ? {} : { reason: parseUserText(reason) }),
  }));
}

async function commandRelease(argv: string[]): Promise<void> {
  const [laneRaw, pathRaw] = argv;
  if (laneRaw === undefined || pathRaw === undefined) {
    throw new Error("usage: ledger release <lane> <path>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, parseLaneId(laneRaw), {
    type: "release",
    paths: [parseClaimPath(pathRaw)],
  }));
}

async function commandResolve(argv: string[]): Promise<void> {
  const [laneRaw, pathRaw] = argv;
  if (laneRaw === undefined || pathRaw === undefined) {
    throw new Error("usage: ledger resolve <lane> <path> [--owner <writer>]");
  }
  const config = await loadIdentity(root);
  const owner = optionValue(argv, "--owner");
  print(await appendEvent(root, config, parseLaneId(laneRaw), {
    type: "claim.resolve",
    paths: [parseClaimPath(pathRaw)],
    ...(owner === undefined ? {} : { owner: parseWriterId(owner) }),
  }));
}

async function commandStatus(argv: string[]): Promise<void> {
  const [laneRaw, stateRaw, ...summaryParts] = argv;
  if (laneRaw === undefined || stateRaw === undefined || summaryParts.length === 0) {
    throw new Error("usage: ledger status <lane> <state> <summary>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, resolveLane(config, laneRaw), {
    type: "status",
    state: parseStatusState(stateRaw),
    summary: parseUserText(summaryParts.join(" ")),
  }));
}

async function commandTask(argv: string[]): Promise<void> {
  const [laneRaw, taskIdRaw, stateRaw, ...summaryParts] = argv;
  if (laneRaw === undefined || taskIdRaw === undefined || stateRaw === undefined || summaryParts.length === 0) {
    throw new Error("usage: ledger task <lane> <taskId> <state> <summary> [--title <title>] [--pr-url <url>]");
  }
  const config = await loadIdentity(root);
  const title = optionValue(argv, "--title");
  const prUrl = optionValue(argv, "--pr-url");
  const state = parseTaskState(stateRaw);
  print(await appendEvent(root, config, parseLaneId(laneRaw), {
    type: "task.update",
    taskId: parseTaskId(taskIdRaw),
    taskState: state,
    summary: parseUserText(summaryWithoutOptions(summaryParts)),
    ...(title === undefined ? {} : { title: parseUserText(title) }),
    ...(prUrl === undefined ? {} : { prUrl: parsePullRequestUrl(prUrl) }),
  }));
}

async function commandWorker(argv: string[]): Promise<void> {
  const [laneRaw, stateRaw, ...summaryParts] = argv;
  if (laneRaw === undefined || stateRaw === undefined || summaryParts.length === 0) {
    throw new Error("usage: ledger worker <lane> <state> <summary> [--task-id <taskId>]");
  }
  const config = await loadIdentity(root);
  const taskIdRaw = optionValue(argv, "--task-id");
  print(await appendEvent(root, config, parseLaneId(laneRaw), {
    type: "worker.update",
    workerState: parseWorkerState(stateRaw),
    summary: parseUserText(summaryWithoutOptions(summaryParts)),
    ...(taskIdRaw === undefined ? {} : { taskId: parseTaskId(taskIdRaw) }),
  }));
}

async function commandReport(argv: string[]): Promise<void> {
  const taskIdRaw = optionValue(argv, "--task-id");
  const summaryParts = argv.filter((arg, index) => {
    const previous = argv[index - 1];
    return !arg.startsWith("--") && previous !== "--task-id";
  });
  if (summaryParts.length === 0) {
    throw new Error("usage: ledger report [--task-id <taskId>] <summary>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, config.defaultLane, {
    type: "report",
    summary: parseUserText(summaryParts.join(" ")),
    ...(taskIdRaw === undefined ? {} : { taskId: parseTaskId(taskIdRaw) }),
  }));
}

async function commandWorkers(argv: string[]): Promise<void> {
  const state = await materialize(root);
  print(argv[0] === "free" ? getFreeWorkers(state) : getWorkers(state));
}

async function commandTasks(argv: string[]): Promise<void> {
  const state = await materialize(root);
  print(argv[0] === "active" ? getActiveTasks(state) : [...state.tasks.values()]);
}

async function commandDoctor(): Promise<void> {
  const state = await materialize(root);
  const inspection = await inspectLedger(root);
  print({
    ok: inspection.ok && state.warnings.length === 0 && state.ownership.conflicts.length === 0,
    diagnostics: inspection.diagnostics,
    warnings: state.warnings,
    conflicts: state.ownership.conflicts,
    dashboard: state.dashboard,
  });
}

async function commandCompact(argv: string[]): Promise<void> {
  const keepLatest = Number(optionValue(argv, "--keep-latest") ?? "250");
  print(await compactLedger(root, { keepLatest }));
}

async function commandStreams(): Promise<void> {
  try {
    print((await readdir(streamsDir(root))).filter((name) => name.endsWith(".ndjson")).sort());
  } catch {
    print([]);
  }
}

async function commandSync(argv: string[]): Promise<void> {
  const peer = optionValue(argv, "--peer");
  if (peer === undefined) {
    throw new Error("usage: ledger sync --peer <path|url|alias>");
  }
  if (isHttpPeer(peer)) {
    print(await syncFromHttpPeer(root, peer, optionValue(argv, "--token") ?? process.env.LEDGER_PEER_TOKEN));
    return;
  }
  if (isLocalPeerPath(peer) || await pathExists(resolve(peer))) {
    print(await syncFromPeer(root, resolve(peer)));
    return;
  }
  const resolved = await resolvePeer(root, peer);
  print(await syncFromHttpPeer(root, resolved.url, optionValue(argv, "--token") ?? resolved.token ?? process.env.LEDGER_PEER_TOKEN));
}

async function commandPeer(argv: string[]): Promise<void> {
  const [subcommand, nameOrUrl, url] = argv;
  switch (subcommand) {
    case "add": {
      if (nameOrUrl === undefined || url === undefined) {
        throw new Error("usage: ledger peer add <name> <url> [--token-env <envName>]");
      }
      const tokenEnv = optionValue(argv, "--token-env");
      print(await addPeer(root, {
        name: nameOrUrl,
        url,
        ...(tokenEnv === undefined ? {} : { tokenEnv }),
      }));
      return;
    }
    case "list":
      print(await loadPeerRegistry(root));
      return;
    case "health": {
      if (nameOrUrl === undefined) {
        throw new Error("usage: ledger peer health <name|url>");
      }
      const resolved = await resolvePeer(root, nameOrUrl);
      const response = await fetch(new URL("/health", resolved.url), requestInit(optionValue(argv, "--token") ?? resolved.token ?? process.env.LEDGER_PEER_TOKEN));
      print({
        peer: isHttpPeer(nameOrUrl) ? parsePeerName("direct") : parsePeerName(nameOrUrl),
        url: resolved.url,
        ok: response.ok,
        status: response.status,
        body: response.ok ? await response.json() : await response.text(),
      });
      return;
    }
    default:
      throw new Error("usage: ledger peer <add|list|health>");
  }
}

async function commandServe(argv: string[]): Promise<void> {
  const port = Number(optionValue(argv, "--port") ?? "8787");
  const host = optionValue(argv, "--host") ?? "127.0.0.1";
  const token = optionValue(argv, "--token") ?? process.env.LEDGER_HTTP_TOKEN;
  const server = await startPeerServer(root, {
    port,
    host,
    ...(token === undefined ? {} : { token }),
  });
  print({ url: server.url, commandApi: true, authRequired: token !== undefined });
  await new Promise(() => undefined);
}

async function commandEnsure(argv: string[]): Promise<void> {
  const port = Number(optionValue(argv, "--port") ?? process.env.LEDGER_PORT ?? "8787");
  const host = optionValue(argv, "--host") ?? process.env.LEDGER_HOST ?? "127.0.0.1";
  const token = optionValue(argv, "--token") ?? process.env.LEDGER_HTTP_TOKEN;
  print(await ensureDaemon({
    root,
    port,
    host,
    ...(token === undefined ? {} : { token }),
  }));
}

function optionValue(argv: readonly string[], option: string): string | undefined {
  const index = argv.indexOf(option);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value === undefined || value.startsWith("--") ? undefined : value;
}

function summaryWithoutOptions(parts: readonly string[]): string {
  const summary: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "--title" || part === "--pr-url" || part === "--task-id") {
      index += 1;
      continue;
    }
    if (part !== undefined) {
      summary.push(part);
    }
  }
  return summary.join(" ");
}

function isHttpPeer(peer: string): boolean {
  return peer.startsWith("http://") || peer.startsWith("https://");
}

function isLocalPeerPath(peer: string): boolean {
  return peer.includes(":\\")
    || peer.includes(":/")
    || peer.startsWith(".")
    || peer.startsWith("/")
    || peer.startsWith("\\")
    || peer.includes("\\");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function requestInit(token: string | undefined): RequestInit | undefined {
  return token === undefined || token.length === 0
    ? undefined
    : { headers: { authorization: `Bearer ${token}` } };
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
