import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadIdentity } from "./identity.js";
import { streamsDir } from "./paths.js";
import { streamFiles } from "./sync/local.js";

export type PeerServer = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

export async function startPeerServer(root: string, port: number): Promise<PeerServer> {
  const server = createServer(async (request, response) => {
    try {
      await routeRequest(root, request, response);
    } catch (error) {
      sendJson(response, 500, { error: String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))),
  };
}

async function routeRequest(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
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
  sendJson(response, 404, { error: "not found" });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}

function isSafeStreamName(fileName: string): boolean {
  return /^[A-Za-z0-9._-]+\.ndjson$/u.test(fileName) && !fileName.includes("..");
}
