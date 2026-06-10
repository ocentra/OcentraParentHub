# Ocentra Parent Hub

Offline-first decentralized lane sync and event ledger for Ocentra Parent coordination.

This repository is intentionally separate from the Ocentra Parent product repo. The product repo should contain code, docs, and tools. Live hub state belongs here or in peer-local hub stores derived from this project.

## Direction

The hub's canonical truth is an append-only immutable event log. Inbox files, lane status, ownership, reports, and heartbeats are materialized views that can be deleted and rebuilt from events.

V1 is deliberately small and implemented as a Node/TypeScript CLI:

- Stable hub, node, and lane identities are created by `init`.
- Each writer appends to a per-writer stream: `streams/<nodeId>.<laneId>.ndjson`.
- `nodeName` is stored for display only. Canonical stream names use stable `nodeId`, not mutable hostnames.
- Event IDs are globally unique and used for dedupe.
- Every event carries `seq`, `prevEventId`, `prevHash`, and `hash` so stream continuity is auditable.
- Same-machine append races are guarded by per-stream file locks.
- Materialized state is disposable JSON under `views/`.
- Sync is adapter-shaped. V1 includes local filesystem peer sync; V2 includes a read-only HTTP peer server and HTTP stream sync.
- Domain-bearing strings are branded with Effect Schema. Raw text is accepted only at CLI/file boundaries and parsed immediately.

## Event Envelope

Each NDJSON line is one event:

```json
{
  "id": "evt_...",
  "schema": 1,
  "hub": "ocentra-parent",
  "nodeId": "node_...",
  "nodeName": "HP",
  "lane": "lane-a",
  "writer": "node_....lane-a",
  "type": "message",
  "ts": "2026-06-10T13:00:00Z",
  "body": "Review package preview gate.",
  "seq": 1,
  "prevEventId": null,
  "prevHash": null,
  "hash": "sha256:..."
}
```

The `hash` is computed over every envelope field except `hash`. Events are never rewritten after append.

## V1 CLI Shape

```powershell
npm run laser -- init ocentra-parent --lane primary
npm run laser -- start codex-b --ttl-seconds 180
npm run laser -- lane register codex-b
npm run laser -- msg codex-b "ready for review"
npm run laser -- inbox codex-b
npm run laser -- ack evt_...
npm run laser -- claim codex-b "src/auth/**" --reason "auth cleanup"
npm run laser -- release codex-b "src/auth/**"
npm run laser -- resolve codex-b "src/auth/**" --owner node_abc.codex-b
npm run laser -- status codex-b working "reviewing package preview gate"
npm run laser -- handoff codex-b "ready for next slice"
npm run laser -- note "raw operator note"
npm run laser -- materialize
npm run laser -- doctor
npm run laser -- streams
npm run laser -- compact --keep-latest 250
npm run laser -- sync --peer E:\SomeOtherHub
npm run laser -- serve --port 8787
npm run laser -- sync --peer http://127.0.0.1:8787
```

## Materialized Semantics

- **Deduplication:** materialization indexes by event ID and preserves the first observed event for state generation. Duplicate lines remain in source streams and are reported.
- **Inbox:** `message` events create inbox items. `ack` events acknowledge explicit event IDs by actor identity.
- **Ownership:** `claim`, `release`, and `claim.resolve` events drive ownership. Overlapping active claim paths become conflicts until released or resolved.
- **Status:** `status` events carry low-frequency lane state. V1 intentionally avoids replacing Codex internal heartbeat.
- **Heartbeat/startup:** `start` writes `lane.register` and `heartbeat`, materializes views, and returns unread inbox for that lane.
- **Doctor:** `doctor` validates stream hashes, sequence continuity, malformed lines, materialized warnings, and ownership conflicts.

## Retention And Compaction

Live views are not append-only truth. The default `inbox` command shows unread messages only; use `inbox <lane> --all` when debugging historical or acked items.

Canonical event history can be compacted without deleting truth:

```powershell
npm run laser -- compact --keep-latest 250
```

Compaction moves cold stream prefixes from `streams/<writer>.ndjson` into immutable archive segments under `archive/streams/<writer>.ndjson/`. The hot stream keeps the most recent suffix so local sync and normal inspection stay small. Materialization and `doctor` read both archive segments and hot streams, so rebuildable truth is preserved.

## V2 HTTP Peer Sync

Every node can expose its local ledger as a read-only peer:

```powershell
npm run laser -- serve --port 8787
```

Peers can then copy missing stream prefixes:

```powershell
npm run laser -- sync --peer http://127.0.0.1:8787
```

Implemented endpoints:

```txt
GET /health
GET /manifest
GET /streams
GET /streams/:name
POST /streams/:name
```

`POST /streams/:name` intentionally returns `405` in this version. V2 sync copies stream bytes from the writer's peer and appends only when the local stream is a byte-for-byte prefix. If a same-name stream diverges, Laser writes a `*.conflict.*` copy and refuses to merge it into canonical truth.

## Migration Stance

Do not wire this project into `E:\OcentraParent` yet. The existing product-repo hub should continue operating until a later migration explicitly chooses a cutover path.

Planned migration path:

1. Run this hub beside the current repo hub and mirror selected lane activity into events.
2. Compare materialized views against current lane inbox/status files.
3. Add transport adapters for LAN/HTTP and optional Git remote exchange.
4. Switch readers to materialized views.
5. Stop writing mutable product-repo hub state only after parity is proven.

## Test Contract

The V1 scaffold covers:

- append continuity and stream hash chain
- event ID dedupe during materialization
- rebuildable materialized inbox/status/ack state
- ownership conflict detection for overlapping paths
- local filesystem sync without rewriting peer streams
- same-stream divergence conflict copies
- HTTP peer sync
- hash-chain tamper detection
- cold stream compaction into immutable archive segments
- startup heartbeat and unread inbox check
