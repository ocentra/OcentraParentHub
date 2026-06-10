import { homedir } from "node:os";
import { join, resolve } from "node:path";

const defaultRootParts = [".ocentra", "ledger", "ocentra-parent"] as const;

export function resolveLedgerRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.LEDGER_ROOT ?? defaultLedgerRoot());
}

export function defaultLedgerRoot(): string {
  return join(homedir(), ...defaultRootParts);
}
