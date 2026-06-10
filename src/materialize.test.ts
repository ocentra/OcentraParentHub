import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaimPath, parseLaneId, parseMessageAddress, parseStatusState, parseUserText } from "./domain.js";
import { initIdentity } from "./identity.js";
import { materialize } from "./materialize.js";
import { streamPath } from "./paths.js";
import { appendEvent } from "./stream.js";
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
});

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ocentra-parent-hub-"));
}
