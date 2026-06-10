import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseClaimPath,
  parseEventId,
  parseLaneId,
  parseMessageAddress,
  parseStatusState,
  parseUserText,
  parseWriterId,
} from "./domain.js";
import { loadIdentity, resolveLane } from "./identity.js";
import { materialize } from "./materialize.js";
import { streamsDir } from "./paths.js";
import { appendEvent } from "./stream.js";
import { streamFiles } from "./sync/local.js";

export type PeerServer = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export type PeerServerOptions = {
  readonly port: number;
  readonly host?: string;
  readonly token?: string;
};

export async function startPeerServer(root: string, portOrOptions: number | PeerServerOptions): Promise<PeerServer> {
  const options = typeof portOrOptions === "number" ? { port: portOrOptions } : portOrOptions;
  const host = options.host ?? "127.0.0.1";
  const token = options.token;
  if (!isLoopbackHost(host) && (token === undefined || token.length === 0)) {
    throw new Error("serving command endpoints beyond localhost requires --token or LEDGER_HTTP_TOKEN");
  }

  const server = createServer(async (request, response) => {
    try {
      await routeRequest(root, request, response, token === undefined ? {} : { token });
    } catch (error) {
      sendJson(response, 500, { error: String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => resolve());
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : options.port;
  return {
    url: `http://${host}:${actualPort}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
  };
}

async function routeRequest(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
  options: { readonly token?: string },
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }
  if (options.token !== undefined && options.token.length > 0 && !isAuthorized(request, options.token)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/manifest") {
    const identity = await loadIdentity(root);
    const streams = await streamFiles(root);
    sendJson(response, 200, { identity, streams });
    return;
  }
  if (request.method === "GET" && url.pathname === "/streams") {
    sendJson(response, 200, { streams: await streamFiles(root) });
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/streams/")) {
    const fileName = decodeURIComponent(url.pathname.slice("/streams/".length));
    if (!isSafeStreamName(fileName)) {
      sendJson(response, 400, { error: "invalid stream name" });
      return;
    }
    try {
      const body = await readFile(join(streamsDir(root), fileName), "utf8");
      response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
      response.end(body);
    } catch {
      sendJson(response, 404, { error: "stream not found" });
    }
    return;
  }
  if (request.method === "POST" && url.pathname.startsWith("/streams/")) {
    sendJson(response, 405, {
      error: "direct remote append is intentionally disabled in V2; peers copy stream prefixes",
    });
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/inbox/")) {
    const lane = parseLaneId(decodeURIComponent(url.pathname.slice("/inbox/".length)));
    const all = url.searchParams.get("all") === "true";
    const state = await materialize(root);
    const inbox = state.lanes.get(lane)?.inbox ?? [];
    sendJson(response, 200, { inbox: all ? inbox : inbox.filter((item) => item.ackedBy.length === 0) });
    return;
  }
  if (request.method === "POST" && url.pathname.startsWith("/commands/")) {
    await routeCommand(root, request, response, url.pathname.slice("/commands/".length));
    return;
  }
  sendJson(response, 404, { error: "not found" });
}

async function routeCommand(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
  command: string,
): Promise<void> {
  const config = await loadIdentity(root);
  const body = await readJsonBody(request);
  if (command === "message") {
    const lane = resolveLane(config, optionalString(body, "lane"));
    const event = await appendEvent(root, config, lane, {
      type: "message",
      to: parseMessageAddress(requiredString(body, "to")),
      body: parseUserText(requiredString(body, "body")),
    });
    sendJson(response, 200, { event });
    return;
  }
  if (command === "start") {
    const lane = resolveLane(config, optionalString(body, "lane"));
    const ttlSeconds = optionalNumber(body, "ttlSeconds") ?? 180;
    const summary = optionalString(body, "summary") ?? "lane started";
    const registered = await appendEvent(root, config, lane, { type: "lane.register" });
    const heartbeat = await appendEvent(root, config, lane, {
      type: "heartbeat",
      state: parseStatusState("online"),
      summary: parseUserText(summary),
      ttlSeconds,
    });
    const state = await materialize(root);
    const inbox = state.lanes.get(lane)?.inbox.filter((item) => item.ackedBy.length === 0) ?? [];
    sendJson(response, 200, {
      lane,
      registeredEventId: registered.id,
      heartbeatEventId: heartbeat.id,
      unreadCount: inbox.length,
      inbox,
      staleHeartbeatCount: state.dashboard.staleHeartbeatCount,
    });
    return;
  }
  if (command === "ack") {
    const lane = resolveLane(config, optionalString(body, "lane"));
    const event = await appendEvent(root, config, lane, {
      type: "ack",
      messageId: parseEventId(requiredString(body, "eventId")),
    });
    sendJson(response, 200, { event });
    return;
  }
  if (command === "status") {
    const lane = resolveLane(config, optionalString(body, "lane"));
    const event = await appendEvent(root, config, lane, {
      type: "status",
      state: parseStatusState(requiredString(body, "state")),
      summary: parseUserText(requiredString(body, "summary")),
    });
    sendJson(response, 200, { event });
    return;
  }
  if (command === "claim") {
    const lane = parseLaneId(requiredString(body, "lane"));
    const reason = optionalString(body, "reason");
    const event = await appendEvent(root, config, lane, {
      type: "claim",
      paths: [parseClaimPath(requiredString(body, "path"))],
      ...(reason === undefined ? {} : { reason: parseUserText(reason) }),
    });
    sendJson(response, 200, { event });
    return;
  }
  if (command === "release") {
    const event = await appendEvent(root, config, parseLaneId(requiredString(body, "lane")), {
      type: "release",
      paths: [parseClaimPath(requiredString(body, "path"))],
    });
    sendJson(response, 200, { event });
    return;
  }
  if (command === "resolve") {
    const owner = optionalString(body, "owner");
    const event = await appendEvent(root, config, parseLaneId(requiredString(body, "lane")), {
      type: "claim.resolve",
      paths: [parseClaimPath(requiredString(body, "path"))],
      ...(owner === undefined ? {} : { owner: parseWriterId(owner) }),
    });
    sendJson(response, 200, { event });
    return;
  }
  sendJson(response, 404, { error: `unknown command ${command}` });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("JSON body must be an object");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

function isSafeStreamName(fileName: string): boolean {
  return /^[A-Za-z0-9._-]+\.ndjson$/u.test(fileName) && !fileName.includes("..");
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
