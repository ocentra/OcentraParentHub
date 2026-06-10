import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { streamsDir } from "../paths.js";
import { eventLines, isPrefix, SyncResult } from "./local.js";

export async function syncFromHttpPeer(root: string, peerUrl: string, token?: string): Promise<SyncResult> {
  await mkdir(streamsDir(root), { recursive: true });
  const base = new URL(peerUrl);
  const streamsResponse = await fetch(new URL("/streams", base), requestInit(token));
  if (!streamsResponse.ok) {
    throw new Error(`peer streams request failed: ${streamsResponse.status}`);
  }
  const { streams } = await streamsResponse.json() as { streams?: unknown };
  if (!Array.isArray(streams) || !streams.every((stream) => typeof stream === "string")) {
    throw new Error("peer streams response was not a string array");
  }

  let imported = 0;
  const conflicts: string[] = [];
  for (const stream of streams) {
    const remoteResponse = await fetch(new URL(`/streams/${encodeURIComponent(stream)}`, base), requestInit(token));
    if (!remoteResponse.ok) {
      throw new Error(`peer stream request failed for ${stream}: ${remoteResponse.status}`);
    }
    const remoteText = await remoteResponse.text();
    const remoteLines = remoteText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const localPath = join(streamsDir(root), stream);
    const localLines = await eventLines(localPath);
    if (!isPrefix(localLines, remoteLines)) {
      const conflictName = `${stream}.conflict.${Date.now()}`;
      await writeFile(join(streamsDir(root), conflictName), remoteText.endsWith("\n") ? remoteText : `${remoteText}\n`);
      conflicts.push(conflictName);
      continue;
    }
    const handle = await open(localPath, "a");
    try {
      for (const line of remoteLines.slice(localLines.length)) {
        await handle.appendFile(`${line}\n`);
        imported += 1;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return { imported, conflicts };
}

function requestInit(token: string | undefined): RequestInit | undefined {
  return token === undefined || token.length === 0
    ? undefined
    : { headers: { authorization: `Bearer ${token}` } };
}
