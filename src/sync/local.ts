import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { streamsDir } from "../paths.js";

export async function syncFromPeer(root: string, peer: string): Promise<{ imported: number }> {
  await mkdir(streamsDir(root), { recursive: true });
  let imported = 0;
  for (const fileName of await streamFiles(peer)) {
    const localPath = join(streamsDir(root), fileName);
    const peerLines = await eventLines(join(streamsDir(peer), fileName));
    const localLines = await eventLines(localPath);
    const knownIds = new Set(localLines.map(eventIdFromLine).filter((id) => id !== undefined));
    const handle = await open(localPath, "a");
    try {
      for (const line of peerLines) {
        const id = eventIdFromLine(line);
        if (id !== undefined && !knownIds.has(id)) {
          await handle.appendFile(`${line}\n`);
          knownIds.add(id);
          imported += 1;
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return { imported };
}

async function streamFiles(root: string): Promise<string[]> {
  try {
    return (await readdir(streamsDir(root))).filter((name) => name.endsWith(".ndjson")).sort();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function eventLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function eventIdFromLine(line: string): string | undefined {
  try {
    const value = JSON.parse(line) as { id?: unknown };
    return typeof value.id === "string" ? value.id : undefined;
  } catch {
    return undefined;
  }
}
