#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseClaimPath,
  parseEventId,
  parseLaneId,
  parseMessageAddress,
  parseStatusState,
  parseUserText,
  parseWriterId,
} from "./domain.js";
import { inspectLedger } from "./doctor.js";
import { initIdentity, loadIdentity, resolveLane } from "./identity.js";
import { materialize, materializedToJson } from "./materialize.js";
import { streamsDir } from "./paths.js";
import { startPeerServer } from "./server.js";
import { appendEvent } from "./stream.js";
import { syncFromHttpPeer } from "./sync/http.js";
import { syncFromPeer } from "./sync/local.js";

const args = process.argv.slice(2);
const root = resolve(process.env.LASER_ROOT ?? ".");

await main(args);

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "init":
      await commandInit(rest);
      return;
    case "lane":
      await commandLane(rest);
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
    case "materialize":
      print(materializedToJson(await materialize(root)));
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
    case "serve":
      await commandServe(rest);
      return;
    default:
      throw new Error(`unknown command: ${command ?? "(missing)"}`);
  }
}

async function commandInit(argv: string[]): Promise<void> {
  const [hub] = argv;
  if (hub === undefined) {
    throw new Error("usage: laser init <hub> --lane <lane>");
  }
  const lane = optionValue(argv, "--lane") ?? "primary";
  print(await initIdentity({ root, hub, lane }));
}

async function commandLane(argv: string[]): Promise<void> {
  const [subcommand, lane] = argv;
  if (subcommand !== "register" || lane === undefined) {
    throw new Error("usage: laser lane register <lane>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, parseLaneId(lane), { type: "lane.register" }));
}

async function commandMessage(argv: string[]): Promise<void> {
  const [to, ...bodyParts] = argv;
  if (to === undefined || bodyParts.length === 0) {
    throw new Error("usage: laser msg <to> <body>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, config.defaultLane, {
    type: "message",
    to: parseMessageAddress(to),
    body: parseUserText(bodyParts.join(" ")),
  }));
}

async function commandInbox(argv: string[]): Promise<void> {
  const lane = parseLaneId(argv[0] ?? (await loadIdentity(root)).defaultLane);
  const state = await materialize(root);
  print(state.lanes.get(lane)?.inbox ?? []);
}

async function commandAck(argv: string[]): Promise<void> {
  const [messageId] = argv;
  if (messageId === undefined) {
    throw new Error("usage: laser ack <messageId>");
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
    throw new Error("usage: laser handoff <to> <body>");
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
    throw new Error("usage: laser note <body>");
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
    throw new Error("usage: laser claim <lane> <path> [--reason <reason>]");
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
    throw new Error("usage: laser release <lane> <path>");
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
    throw new Error("usage: laser resolve <lane> <path> [--owner <writer>]");
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
    throw new Error("usage: laser status <lane> <state> <summary>");
  }
  const config = await loadIdentity(root);
  print(await appendEvent(root, config, resolveLane(config, laneRaw), {
    type: "status",
    state: parseStatusState(stateRaw),
    summary: parseUserText(summaryParts.join(" ")),
  }));
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
    throw new Error("usage: laser sync --peer <path>");
  }
  print(peer.startsWith("http://") || peer.startsWith("https://")
    ? await syncFromHttpPeer(root, peer)
    : await syncFromPeer(root, resolve(peer)));
}

async function commandServe(argv: string[]): Promise<void> {
  const port = Number(optionValue(argv, "--port") ?? "8787");
  const server = await startPeerServer(root, port);
  print({ url: server.url });
  await new Promise(() => undefined);
}

function optionValue(argv: readonly string[], option: string): string | undefined {
  const index = argv.indexOf(option);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value === undefined || value.startsWith("--") ? undefined : value;
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
