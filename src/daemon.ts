import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export type EnsureDaemonOptions = {
  readonly root: string;
  readonly port: number;
  readonly host: string;
  readonly token?: string;
};

export type EnsureDaemonResult = {
  readonly url: string;
  readonly alreadyRunning: boolean;
  readonly started: boolean;
  readonly pid?: number;
};

export async function ensureDaemon(options: EnsureDaemonOptions): Promise<EnsureDaemonResult> {
  const url = `http://${options.host}:${options.port}`;
  if (await isHealthy(url, options.token)) {
    return { url, alreadyRunning: true, started: false };
  }

  const command = daemonCommand(options);
  const child = spawn(command.file, command.args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      LEDGER_ROOT: options.root,
      ...(options.token === undefined ? {} : { LEDGER_HTTP_TOKEN: options.token }),
    },
    windowsHide: true,
  });
  child.unref();

  await writeDaemonPid(options.root, options.port, child.pid);
  await waitForHealthy(url, options.token);
  return { url, alreadyRunning: false, started: true, ...(child.pid === undefined ? {} : { pid: child.pid }) };
}

export async function isHealthy(url: string, token?: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", url), requestInit(token));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(url: string, token: string | undefined): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await isHealthy(url, token)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`ledger daemon did not become healthy at ${url}`);
}

async function writeDaemonPid(root: string, port: number, pid: number | undefined): Promise<void> {
  if (pid === undefined) {
    return;
  }
  const dir = join(root, "runtime");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `ledger-${port}.pid`), `${pid}\n`);
}

function requestInit(token: string | undefined): RequestInit | undefined {
  return token === undefined || token.length === 0
    ? undefined
    : { headers: { authorization: `Bearer ${token}` } };
}

function daemonCommand(options: EnsureDaemonOptions): { readonly file: string; readonly args: readonly string[] } {
  const serveArgs = ["serve", "--host", options.host, "--port", String(options.port)];
  const compiledCliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  if (existsSync(compiledCliPath)) {
    return { file: process.execPath, args: [compiledCliPath, ...serveArgs] };
  }

  const require = createRequire(import.meta.url);
  const tsxCliPath = require.resolve("tsx/cli");
  const sourceCliPath = fileURLToPath(new URL("./cli.ts", import.meta.url));
  return { file: process.execPath, args: [tsxCliPath, sourceCliPath, ...serveArgs] };
}
