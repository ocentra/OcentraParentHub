import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  PeerName,
  PeerUrl,
  UserText,
  parsePeerName,
  parsePeerUrl,
  parseUserText,
} from "./domain.js";

export type PeerConfig = {
  readonly name: PeerName;
  readonly url: PeerUrl;
  readonly tokenEnv?: UserText;
};

export type PeerRegistry = {
  readonly peers: readonly PeerConfig[];
};

const registryFileName = "peers.json";

export async function addPeer(
  root: string,
  input: {
    readonly name: string;
    readonly url: string;
    readonly tokenEnv?: string;
  },
): Promise<PeerRegistry> {
  const peer: PeerConfig = {
    name: parsePeerName(input.name),
    url: parsePeerUrl(input.url),
    ...(input.tokenEnv === undefined ? {} : { tokenEnv: parseUserText(input.tokenEnv) }),
  };
  const registry = await loadPeerRegistry(root);
  const peers = [
    ...registry.peers.filter((existing) => existing.name !== peer.name),
    peer,
  ].sort((left, right) => left.name.localeCompare(right.name));
  const next = { peers };
  await savePeerRegistry(root, next);
  return next;
}

export async function loadPeerRegistry(root: string): Promise<PeerRegistry> {
  try {
    const raw = JSON.parse(await readFile(registryPath(root), "utf8")) as unknown;
    if (!isRegistryShape(raw)) {
      throw new Error("peers.json must contain { peers: [...] }");
    }
    return {
      peers: raw.peers.map((peer) => ({
        name: parsePeerName(peer.name),
        url: parsePeerUrl(peer.url),
        ...(peer.tokenEnv === undefined ? {} : { tokenEnv: parseUserText(peer.tokenEnv) }),
      })),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { peers: [] };
    }
    throw error;
  }
}

export async function resolvePeer(
  root: string,
  peerOrUrl: string,
): Promise<{
  readonly url: PeerUrl;
  readonly name?: PeerName;
  readonly token?: string;
}> {
  if (peerOrUrl.startsWith("http://") || peerOrUrl.startsWith("https://")) {
    return { url: parsePeerUrl(peerOrUrl) };
  }
  const name = parsePeerName(peerOrUrl);
  const registry = await loadPeerRegistry(root);
  const peer = registry.peers.find((candidate) => candidate.name === name);
  if (peer === undefined) {
    throw new Error(`unknown peer alias: ${name}`);
  }
  const token = peer.tokenEnv === undefined ? undefined : process.env[peer.tokenEnv];
  return {
    name,
    url: peer.url,
    ...(token === undefined ? {} : { token }),
  };
}

async function savePeerRegistry(root: string, registry: PeerRegistry): Promise<void> {
  const path = registryPath(root);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`);
}

function registryPath(root: string): string {
  return join(root, registryFileName);
}

function isRegistryShape(raw: unknown): raw is {
  readonly peers: readonly {
    readonly name: unknown;
    readonly url: unknown;
    readonly tokenEnv?: unknown;
  }[];
} {
  return typeof raw === "object"
    && raw !== null
    && "peers" in raw
    && Array.isArray(raw.peers)
    && raw.peers.every((peer) => (
      typeof peer === "object"
      && peer !== null
      && "name" in peer
      && typeof peer.name === "string"
      && "url" in peer
      && typeof peer.url === "string"
      && (!("tokenEnv" in peer) || typeof peer.tokenEnv === "string")
    ));
}
