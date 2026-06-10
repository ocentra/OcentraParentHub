import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertEventHash, HubEvent, parseHubEvent } from "./events.js";
import { streamsDir } from "./paths.js";
import { listStreamFiles } from "./stream.js";

export type LedgerDiagnostic = {
  readonly level: "warning" | "error";
  readonly stream: string;
  readonly line?: number;
  readonly message: string;
};

export type LedgerInspection = {
  readonly ok: boolean;
  readonly diagnostics: readonly LedgerDiagnostic[];
};

export async function inspectLedger(root: string): Promise<LedgerInspection> {
  const diagnostics: LedgerDiagnostic[] = [];
  for (const stream of await listStreamFiles(root)) {
    const events: HubEvent[] = [];
    const lines = await readLines(join(streamsDir(root), stream));
    for (const [index, line] of lines.entries()) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        const event = parseHubEvent(JSON.parse(line));
        try {
          assertEventHash(event);
        } catch (error) {
          diagnostics.push({
            level: "error",
            stream,
            line: index + 1,
            message: `hash-invalid event: ${String(error)}`,
          });
          continue;
        }
        events.push(event);
      } catch (error) {
        diagnostics.push({
          level: index === lines.length - 1 ? "warning" : "error",
          stream,
          line: index + 1,
          message: index === lines.length - 1
            ? "ignored malformed final line"
            : `malformed event: ${String(error)}`,
        });
      }
    }
    for (const [index, event] of events.entries()) {
      const previous = events[index - 1];
      if (previous === undefined) {
        if (event.seq !== 1 || event.prevEventId !== null || event.prevHash !== null) {
          diagnostics.push({
            level: "error",
            stream,
            line: index + 1,
            message: "first event does not start a stream chain",
          });
        }
        continue;
      }
      if (event.seq !== previous.seq + 1) {
        diagnostics.push({
          level: "error",
          stream,
          line: index + 1,
          message: `sequence break: expected ${previous.seq + 1}, got ${event.seq}`,
        });
      }
      if (event.prevEventId !== previous.id || event.prevHash !== previous.hash) {
        diagnostics.push({
          level: "error",
          stream,
          line: index + 1,
          message: "previous event pointer does not match stream tip",
        });
      }
    }
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    diagnostics,
  };
}

async function readLines(path: string): Promise<string[]> {
  return (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.length > 0);
}
