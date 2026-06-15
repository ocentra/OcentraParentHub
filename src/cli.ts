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
  parseSessionId,
  parseStatusState,
  parseTaskId,
  parseTaskState,
  parseUserText,
  parseWorkerState,
  parseWriterId,
} from "./domain.js";
import { ensureDaemon } from "./daemon.js";
import { inspectLedger } from "./doctor.js";
import { guardLedger } from "./guard.js";
import { initIdentity, loadIdentity, resolveLane } from "./identity.js";
import { getActiveTasks, getFreeWorkers, getWorkers, materialize, materializedToJson } from "./materialize.js";
import { notify } from "./notify.js";
import { streamsDir } from "./paths.js";
import { addPeer, loadPeerRegistry, resolvePeer } from "./peers.js";
import { compactLedger } from "./retention.js";
import { resolveLedgerRoot } from "./root.js";
import { startPeerServer } from "./server.js";
import { appendEvent } from "./stream.js";
import { normalizeClaimPathInput, normalizeClaimPaths } from "./claim-policy.js";
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
    case "heartbeat":
      await commandHeartbeat(rest);
      return;
    case "session":
      await commandSession(rest);
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
    case "notify":
      await commandNotify(rest);
      return;
    case "compact":
      await commandCompact(rest);
      return;
    case "doctor":
      await commandDoctor();
      return;
    case "guard":
      await commandGuard(rest);
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

async function commandNotify(argv: string[]): Promise<void> {
  const config = await loadIdentity(root);
  const lane = parseLaneId(optionValue(argv, "--lane") ?? config.defaultLane);
  const stateFile = optionValue(argv, "--state-file");
  const result = await notify({
    lane,
    root,
    json: argv.includes("--json"),
    peek: argv.includes("--peek"),
    exitCode: argv.includes("--exit-code"),
    ...(stateFile === undefined ? {} : { stateFile }),
  });
  if (argv.includes("--json")) {
    print(result);
  } else if (result.wakeRequests.length === 0) {
    console.log(`ledger-notify: lane=${lane} no wake requests`);
  } else {
    for (const request of result.wakeRequests) {
      console.log(`${request.severity.toUpperCase()} ${request.reason} ${request.sourceLane}: ${request.summary}`);
    }
  }
  if (argv.includes("--exit-code") && result.wakeRequests.length > 0) {
    process.exit(2);
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
  const laneRaw = optionValue(argv, "--lane");
  const messageId = firstPositional(argv, ["--lane"]);
  if (messageId === undefined) {
    throw new Error("usage: ledger ack [--lane <lane>] <messageId>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, resolveLane(config, laneRaw), {
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
  const laneRaw = argv[0];
  const pathArgs = argv.slice(1).filter((arg) => !arg.startsWith("--")).flatMap((value) => splitPathList(value));
  if (laneRaw === undefined || pathArgs.length === 0) {
    throw new Error("usage: ledger claim <lane> <path> [<path> ...] [--reason <reason>]");
  }
  const config = await loadIdentity(root);
  const reason = optionValue(argv, "--reason");
  const paths = await normalizeClaimPaths(root, pathArgs);
  print(await appendEvent(root, config, parseLaneId(laneRaw), {
    type: "claim",
    paths,
    ...(reason === undefined ? {} : { reason: parseUserText(reason) }),
  }));
}

async function commandRelease(argv: string[]): Promise<void> {
  const laneRaw = argv[0];
  const pathArgs = argv.slice(1).filter((arg) => !arg.startsWith("--")).flatMap((value) => splitPathList(value));
  if (laneRaw === undefined || pathArgs.length === 0) {
    throw new Error("usage: ledger release <lane> <path> [<path> ...]");
  }
  const config = await loadIdentity(root);
  const paths = pathArgs.map((path) => parseClaimPath(normalizeClaimPathInput(path)));
  print(await appendEvent(root, config, parseLaneId(laneRaw), {
    type: "release",
    paths,
  }));
}

async function commandResolve(argv: string[]): Promise<void> {
  const laneRaw = argv[0];
  const pathArgs = argv.slice(1).filter((arg) => !arg.startsWith("--")).flatMap((value) => splitPathList(value));
  if (laneRaw === undefined || pathArgs.length === 0) {
    throw new Error("usage: ledger resolve <lane> <path> [<path> ...] [--owner <writer>]");
  }
  const config = await loadIdentity(root);
  const owner = optionValue(argv, "--owner");
  const paths = pathArgs.map((path) => parseClaimPath(normalizeClaimPathInput(path)));
  print(await appendEvent(root, config, parseLaneId(laneRaw), {
    type: "claim.resolve",
    paths,
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

async function commandHeartbeat(argv: string[]): Promise<void> {
  const [laneRaw, stateRaw, ...summaryParts] = argv;
  if (laneRaw === undefined || stateRaw === undefined || summaryParts.length === 0) {
    throw new Error("usage: ledger heartbeat <lane> <state> <summary> [--ttl-seconds <seconds>]");
  }
  const config = await loadIdentity(root);
  const ttlSeconds = Number(optionValue(argv, "--ttl-seconds") ?? "180");
  print(await appendEvent(root, config, resolveLane(config, laneRaw), {
    type: "heartbeat",
    state: parseStatusState(stateRaw),
    summary: parseUserText(summaryWithoutOptions(summaryParts)),
    ttlSeconds,
  }));
}

async function commandSession(argv: string[]): Promise<void> {
  const [subcommand, laneRaw, sessionRaw] = argv;
  if ((subcommand !== "claim" && subcommand !== "release") || laneRaw === undefined || sessionRaw === undefined) {
    throw new Error("usage: ledger session <claim|release> <lane> <sessionId> [--ttl-seconds <seconds>] [--summary <summary>]");
  }
  const config = await loadIdentity(root);
  const lane = resolveLane(config, laneRaw);
  const sessionId = parseSessionId(sessionRaw);
  const summary = optionValue(argv, "--summary");
  if (subcommand === "release") {
    print(await appendEvent(root, config, lane, {
      type: "session.release",
      sessionId,
      ...(summary === undefined ? {} : { summary: parseUserText(summary) }),
    }));
    return;
  }

  const existing = (await materialize(root)).sessions.get(lane);
  if (existing !== undefined && existing.sessionId !== sessionId) {
    print({
      ok: false,
      lane,
      sessionId,
      activeSession: existing,
      message: `lane ${lane} is already owned by active session ${existing.sessionId}`,
    });
    process.exitCode = 1;
    return;
  }

  const ttlSeconds = Number(optionValue(argv, "--ttl-seconds") ?? "3600");
  const event = await appendEvent(root, config, lane, {
    type: "session.claim",
    sessionId,
    ttlSeconds,
    ...(summary === undefined ? {} : { summary: parseUserText(summary) }),
  });
  print({
    ok: true,
    lane,
    sessionId,
    event,
  });
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
  const laneRaw = optionValue(argv, "--lane");
  const summaryParts = argv.filter((arg, index) => {
    const previous = argv[index - 1];
    return !arg.startsWith("--") && previous !== "--task-id" && previous !== "--lane";
  });
  if (summaryParts.length === 0) {
    throw new Error("usage: ledger report [--lane <lane>] [--task-id <taskId>] <summary>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, resolveLane(config, laneRaw), {
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

async function commandGuard(argv: string[]): Promise<void> {
  const config = await loadIdentity(root);
  const lane = optionValue(argv, "--lane") ?? config.defaultLane;
  const changed = optionValue(argv, "--changed");
  const sessionId = optionValue(argv, "--session");
  const result = await guardLedger(root, {
    lane,
    changedPaths: changed === undefined ? [] : splitPathList(changed),
    allowPrimaryWithoutClaims: argv.includes("--allow-primary-without-claims"),
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  print(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
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

function firstPositional(argv: readonly string[], optionsWithValues: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (optionsWithValues.includes(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      return arg;
    }
  }
  return undefined;
}

function summaryWithoutOptions(parts: readonly string[]): string {
  const summary: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "--title" || part === "--pr-url" || part === "--task-id" || part === "--ttl-seconds") {
      index += 1;
      continue;
    }
    if (part !== undefined) {
      summary.push(part);
    }
  }
  return summary.join(" ");
}

function splitPathList(value: string): readonly string[] {
  return value
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
