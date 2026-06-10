import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { archivedStreamDir, streamsDir } from "./paths.js";
import { listStreamFiles } from "./stream.js";

export type CompactOptions = {
  readonly keepLatest: number;
};

export type CompactResult = {
  readonly compactedStreams: readonly CompactedStream[];
};

export type CompactedStream = {
  readonly stream: string;
  readonly archivedEvents: number;
  readonly retainedEvents: number;
  readonly archivePath: string;
};

export async function compactLedger(root: string, options: CompactOptions): Promise<CompactResult> {
  if (!Number.isInteger(options.keepLatest) || options.keepLatest < 1) {
    throw new Error("keepLatest must be a positive integer");
  }

  const compactedStreams: CompactedStream[] = [];
  for (const stream of await listStreamFiles(root)) {
    const streamPath = join(streamsDir(root), stream);
    const raw = await readFile(streamPath, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= options.keepLatest) {
      continue;
    }

    const archiveLines = lines.slice(0, -options.keepLatest);
    const retainedLines = lines.slice(-options.keepLatest);
    const archiveDir = archivedStreamDir(root, stream);
    await mkdir(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${archiveStamp()}.ndjson`);
    await writeFile(archivePath, `${archiveLines.join("\n")}\n`, { flag: "wx" });

    const tmpPath = `${streamPath}.compact.tmp`;
    await writeFile(tmpPath, `${retainedLines.join("\n")}\n`, { flag: "w" });
    await rename(tmpPath, streamPath);

    compactedStreams.push({
      stream,
      archivedEvents: archiveLines.length,
      retainedEvents: retainedLines.length,
      archivePath,
    });
  }

  return { compactedStreams };
}

function archiveStamp(): string {
  return new Date().toISOString().replaceAll(/[^0-9A-Za-z]/g, "");
}
