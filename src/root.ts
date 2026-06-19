import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveLedgerRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.LEDGER_ROOT ?? join(homedir(), ".ocentra", "ledger", "ocentra-parent"));
}
