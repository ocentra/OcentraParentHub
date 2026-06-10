import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseClaimPath,
  parseLaneId,
  parseMessageAddress,
  parsePullRequestUrl,
  parseTaskId,
  parseTaskState,
  parseStatusState,
  parseUserText,
  writerId,
} from "./domain.js";
import { inspectLedger } from "./doctor.js";
import { initIdentity } from "./identity.js";
import { materialize } from "./materialize.js";
import { compactLedger } from "./retention.js";
import { streamPath } from "./paths.js";
import { startPeerServer } from "./server.js";
import { appendEvent } from "./stream.js";
import { syncFromHttpPeer } from "./sync/http.js";
import { syncFromPeer } from "./sync/local.js";

describe("Ocentra Parent Hub ledger", () => {
  it("appends events with stream sequence and hash continuity", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });

    const first = await appendEvent(root, config, config.defaultLane, {
      type: "message",
      to: parseMessageAddress("codex-b"),
      body: parseUserText("hello"),
    });
    const second = await appendEvent(root, config, config.defaultLane, {
      type: "status",
      state: parseStatusState("working"),
      summary: parseUserText("reviewing"),
    });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.prevEventId).toBe(first.id);
    expect(second.prevHash).toBe(first.hash);
  });

  it("dedupes duplicate event ids while preserving source stream lines", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    const event = await appendEvent(root, config, config.defaultLane, {
      type: "message",
      to: parseMessageAddress("codex-b"),
      body: parseUserText("hello"),
    });
    const path = streamPath(root, config.nodeId, config.defaultLane);
    await writeFile(path, `${await readFile(path, "utf8")}${JSON.stringify(event)}\n`);

    const state = await materialize(root);
    expect(state.dashboard.eventCount).toBe(1);
    expect(state.dashboard.duplicateCount).toBe(1);
    expect(state.dashboard.inboxCount).toBe(1);
  });

  it("materializes inbox status and ack state", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "codex-b",
      nodeId: "node-gamedev",
      nodeName: "GAMEDEV",
    });
    const message = await appendEvent(root, config, config.defaultLane, {
      type: "message",
      to: parseMessageAddress("codex-b"),
      body: parseUserText("review package preview gate"),
    });
    await appendEvent(root, config, config.defaultLane, { type: "ack", messageId: message.id });
    await appendEvent(root, config, config.defaultLane, {
      type: "status",
      state: parseStatusState("working"),
      summary: parseUserText("reviewing package preview gate"),
    });

    const state = await materialize(root);
    const lane = state.lanes.get(config.defaultLane);
    expect(lane?.inbox[0]?.ackedBy).toEqual(["node-gamedev.codex-b"]);
    expect(lane?.status?.state).toBe("working");
  });

  it("materializes heartbeat freshness for lane startup", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "codex-b",
      nodeId: "node-gamedev",
      nodeName: "GAMEDEV",
    });
    await appendEvent(root, config, config.defaultLane, {
      type: "heartbeat",
      state: parseStatusState("online"),
      summary: parseUserText("lane started"),
      ttlSeconds: 180,
    });

    const lane = (await materialize(root)).lanes.get(config.defaultLane);
    expect(lane?.heartbeat?.state).toBe("online");
    expect(lane?.heartbeat?.stale).toBe(false);
  });

  it("routes addressed messages to the target lane inbox", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    await appendEvent(root, config, config.defaultLane, {
      type: "message",
      to: parseMessageAddress("codex-b"),
      body: parseUserText("hello from primary"),
    });

    const state = await materialize(root);
    expect(state.lanes.get(parseLaneId("codex-b"))?.inbox).toHaveLength(1);
    expect(state.lanes.get(config.defaultLane)?.inbox).toHaveLength(0);
  });

  it("detects overlapping ownership conflicts after local sync", async () => {
    const hp = await tempRoot();
    const gamedev = await tempRoot();
    const hpConfig = await initIdentity({
      root: hp,
      hub: "ocentra-parent",
      lane: "codex-b",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    const gamedevConfig = await initIdentity({
      root: gamedev,
      hub: "ocentra-parent",
      lane: "codex-c",
      nodeId: "node-gamedev",
      nodeName: "GAMEDEV",
    });

    await appendEvent(hp, hpConfig, hpConfig.defaultLane, {
      type: "claim",
      paths: [parseClaimPath("src/auth/**")],
      reason: parseUserText("auth cleanup"),
    });
    await appendEvent(gamedev, gamedevConfig, gamedevConfig.defaultLane, {
      type: "claim",
      paths: [parseClaimPath("src/auth/login.ts")],
    });

    await syncFromPeer(hp, gamedev);
    const state = await materialize(hp);
    expect(state.ownership.conflicts).toHaveLength(1);
    expect(state.ownership.conflicts[0]?.lanes).toEqual(["node-hp.codex-b", "node-gamedev.codex-c"]);
  });

  it("resolves overlapping ownership conflicts by selected writer", async () => {
    const root = await tempRoot();
    const hpConfig = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "codex-b",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    await appendEvent(root, hpConfig, hpConfig.defaultLane, {
      type: "claim",
      paths: [parseClaimPath("src/auth/**")],
    });
    await appendEvent(root, hpConfig, parseLaneId("codex-c"), {
      type: "claim",
      paths: [parseClaimPath("src/auth/login.ts")],
    });
    await appendEvent(root, hpConfig, hpConfig.defaultLane, {
      type: "claim.resolve",
      paths: [parseClaimPath("src/auth/login.ts")],
      owner: writerId(hpConfig.nodeId, hpConfig.defaultLane),
    });

    const state = await materialize(root);
    expect(state.ownership.conflicts).toHaveLength(0);
    expect(state.ownership.activeClaims).toHaveLength(1);
    expect(state.ownership.activeClaims[0]?.writer).toBe("node-hp.codex-b");
  });

  it("routes broadcast messages to registered lane inboxes", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    await appendEvent(root, config, parseLaneId("codex-b"), { type: "lane.register" });
    await appendEvent(root, config, config.defaultLane, {
      type: "message",
      to: parseMessageAddress("*"),
      body: parseUserText("all lanes"),
    });

    const state = await materialize(root);
    expect(state.lanes.get(parseLaneId("primary"))?.inbox).toHaveLength(1);
    expect(state.lanes.get(parseLaneId("codex-b"))?.inbox).toHaveLength(1);
  });

  it("copies same-stream divergence to a conflict file instead of appending", async () => {
    const left = await tempRoot();
    const right = await tempRoot();
    const leftConfig = await initIdentity({
      root: left,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    const rightConfig = await initIdentity({
      root: right,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    await appendEvent(left, leftConfig, leftConfig.defaultLane, {
      type: "note",
      body: parseUserText("left"),
    });
    await appendEvent(right, rightConfig, rightConfig.defaultLane, {
      type: "note",
      body: parseUserText("right"),
    });

    const result = await syncFromPeer(left, right);
    expect(result.imported).toBe(0);
    expect(result.conflicts).toHaveLength(1);
  });

  it("syncs streams from an HTTP peer", async () => {
    const local = await tempRoot();
    const remote = await tempRoot();
    await initIdentity({
      root: local,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    const remoteConfig = await initIdentity({
      root: remote,
      hub: "ocentra-parent",
      lane: "codex-b",
      nodeId: "node-gamedev",
      nodeName: "GAMEDEV",
    });
    await appendEvent(remote, remoteConfig, remoteConfig.defaultLane, {
      type: "message",
      to: parseMessageAddress("primary"),
      body: parseUserText("from http peer"),
    });

    const server = await startPeerServer(remote, 0);
    try {
      const result = await syncFromHttpPeer(local, server.url);
      expect(result.imported).toBe(1);
      expect((await materialize(local)).dashboard.eventCount).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("accepts localhost HTTP command messages and exposes target inbox", async () => {
    const root = await tempRoot();
    await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-boss",
      nodeName: "BOSS",
    });

    const server = await startPeerServer(root, 0);
    try {
      const messageResponse = await postJson(new URL("/commands/message", server.url), {
        to: "codex-b",
        body: "do the preview gate",
      });
      const event = messageResponse.event as { type?: unknown };
      expect(event.type).toBe("message");

      const inboxResponse = await fetch(new URL("/inbox/codex-b", server.url));
      expect(inboxResponse.status).toBe(200);
      const inbox = await inboxResponse.json() as { inbox?: Array<{ body?: string }> };
      expect(inbox.inbox?.[0]?.body).toBe("do the preview gate");
    } finally {
      await server.close();
    }
  });

  it("protects HTTP endpoints when a server token is configured", async () => {
    const root = await tempRoot();
    await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-boss",
      nodeName: "BOSS",
    });

    const server = await startPeerServer(root, { port: 0, token: "secret" });
    try {
      expect((await fetch(new URL("/streams", server.url))).status).toBe(401);
      expect((await fetch(new URL("/streams", server.url), {
        headers: { authorization: "Bearer secret" },
      })).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("materializes typed worker and task lifecycle views", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "codex-b",
      nodeId: "node-worker",
      nodeName: "WORKER",
    });
    await appendEvent(root, config, config.defaultLane, {
      type: "task.update",
      taskId: parseTaskId("task-preview-gate"),
      taskState: parseTaskState("started"),
      title: parseUserText("Preview gate"),
      summary: parseUserText("started work"),
    });
    await appendEvent(root, config, config.defaultLane, {
      type: "task.update",
      taskId: parseTaskId("task-preview-gate"),
      taskState: parseTaskState("pr_ready"),
      summary: parseUserText("PR is ready"),
      prUrl: parsePullRequestUrl("https://github.com/ocentra/OcentraParent/pull/123"),
    });

    const state = await materialize(root);
    expect(state.dashboard.workerCount).toBe(1);
    expect(state.dashboard.activeTaskCount).toBe(1);
    expect([...state.workers.values()][0]?.state).toBe("pr_ready");
    expect([...state.tasks.values()][0]?.state).toBe("pr_ready");

    await appendEvent(root, config, config.defaultLane, {
      type: "task.update",
      taskId: parseTaskId("task-preview-gate"),
      taskState: parseTaskState("done"),
      summary: parseUserText("merged"),
    });
    const doneState = await materialize(root);
    expect(doneState.dashboard.activeTaskCount).toBe(0);
    expect([...doneState.workers.values()][0]?.free).toBe(true);
  });

  it("serves workers, free workers, and active task queries over HTTP", async () => {
    const root = await tempRoot();
    await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-boss",
      nodeName: "BOSS",
    });

    const server = await startPeerServer(root, 0);
    try {
      await postJson(new URL("/commands/task", server.url), {
        lane: "codex-b",
        taskId: "task-1",
        state: "progress",
        summary: "building the slice",
      });
      const workers = await fetchJson(new URL("/workers", server.url)) as { workers?: Array<{ state?: string }> };
      const free = await fetchJson(new URL("/workers/free", server.url)) as { workers?: Array<unknown> };
      const active = await fetchJson(new URL("/tasks/active", server.url)) as { tasks?: Array<{ taskId?: string }> };

      expect(workers.workers?.[0]?.state).toBe("progress");
      expect(free.workers).toHaveLength(0);
      expect(active.tasks?.[0]?.taskId).toBe("task-1");
    } finally {
      await server.close();
    }
  });

  it("reports hash tampering in doctor inspection", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    await appendEvent(root, config, config.defaultLane, {
      type: "note",
      body: parseUserText("before"),
    });
    const path = streamPath(root, config.nodeId, config.defaultLane);
    await writeFile(path, (await readFile(path, "utf8")).replace("before", "after"));

    const inspection = await inspectLedger(root);
    expect(inspection.ok).toBe(false);
    expect(inspection.diagnostics[0]?.message).toContain("hash-invalid");
  });

  it("compacts cold stream prefixes into archives without losing materialized truth", async () => {
    const root = await tempRoot();
    const config = await initIdentity({
      root,
      hub: "ocentra-parent",
      lane: "primary",
      nodeId: "node-hp",
      nodeName: "HP",
    });
    for (const body of ["one", "two", "three", "four", "five"]) {
      await appendEvent(root, config, config.defaultLane, {
        type: "note",
        body: parseUserText(body),
      });
    }

    const result = await compactLedger(root, { keepLatest: 2 });
    expect(result.compactedStreams[0]?.archivedEvents).toBe(3);
    expect((await hotLineCount(streamPath(root, config.nodeId, config.defaultLane)))).toBe(2);
    expect((await materialize(root)).dashboard.eventCount).toBe(5);
    expect((await inspectLedger(root)).ok).toBe(true);

    const next = await appendEvent(root, config, config.defaultLane, {
      type: "note",
      body: parseUserText("six"),
    });
    expect(next.seq).toBe(6);
    expect((await materialize(root)).dashboard.eventCount).toBe(6);
  });
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ocentra-parent-hub-"));
}

async function hotLineCount(path: string): Promise<number> {
  return (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

async function postJson(url: URL, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return await response.json() as Record<string, unknown>;
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return await response.json();
}
