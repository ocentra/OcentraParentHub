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
npm run ledger -- init ocentra-parent --lane primary
npm run ledger -- start codex-b --ttl-seconds 180
npm run ledger -- lane register codex-b
npm run ledger -- msg codex-b "ready for review"
npm run ledger -- inbox codex-b
npm run ledger -- ack evt_...
npm run ledger -- claim codex-b "src/auth/**" --reason "auth cleanup"
npm run ledger -- release codex-b "src/auth/**"
npm run ledger -- resolve codex-b "src/auth/**" --owner node_abc.codex-b
npm run ledger -- status codex-b working "reviewing package preview gate"
npm run ledger -- worker codex-b progress "implemented route checks" --task-id task-preview-gate
npm run ledger -- task codex-b task-preview-gate started "starting preview gate"
npm run ledger -- task codex-b task-preview-gate progress "tests passing"
npm run ledger -- task codex-b task-preview-gate pr_ready "PR ready" --pr-url https://github.com/ocentra/OcentraParent/pull/123
npm run ledger -- workers
npm run ledger -- workers free
npm run ledger -- tasks active
npm run ledger -- handoff codex-b "ready for next slice"
npm run ledger -- note "raw operator note"
npm run ledger -- materialize
npm run ledger -- doctor
npm run ledger -- streams
npm run ledger -- compact --keep-latest 250
npm run ledger -- sync --peer E:\SomeOtherHub
npm run ledger -- serve --port 8787
npm run ledger -- sync --peer http://127.0.0.1:8787
```

## Materialized Semantics

- **Deduplication:** materialization indexes by event ID and preserves the first observed event for state generation. Duplicate lines remain in source streams and are reported.
- **Inbox:** `message` events create inbox items. `ack` events acknowledge explicit event IDs by actor identity.
- **Ownership:** `claim`, `release`, and `claim.resolve` events drive ownership. Overlapping active claim paths become conflicts until released or resolved.
- **Status:** `status` events carry low-frequency lane state. V1 intentionally avoids replacing Codex internal heartbeat.
- **Heartbeat/startup:** `start` writes `lane.register` and `heartbeat`, materializes views, and returns unread inbox for that lane.
- **Workers:** `worker.update` events use typed states: `idle`, `started`, `progress`, `working`, `blocked`, `pr_ready`, `done`, `offline`.
- **Tasks:** `task.update` events use typed states: `queued`, `started`, `progress`, `blocked`, `pr_ready`, `done`, `cancelled`.
- **Boss queries:** materialization produces `workers`, `freeWorkers`, and `activeTasks` views so the boss can ask who is free and what is still open.
- **Doctor:** `doctor` validates stream hashes, sequence continuity, malformed lines, materialized warnings, and ownership conflicts.

## Retention And Compaction

Live views are not append-only truth. The default `inbox` command shows unread messages only; use `inbox <lane> --all` when debugging historical or acked items.

Canonical event history can be compacted without deleting truth:

```powershell
npm run ledger -- compact --keep-latest 250
```

Compaction moves cold stream prefixes from `streams/<writer>.ndjson` into immutable archive segments under `archive/streams/<writer>.ndjson/`. The hot stream keeps the most recent suffix so local sync and normal inspection stay small. Materialization and `doctor` read both archive segments and hot streams, so rebuildable truth is preserved.

## V2 HTTP Peer Sync

Every node can expose its local ledger as a peer and command endpoint:

```powershell
npm run ledger -- serve --port 8787
```

For LAN or tunnel exposure, bind explicitly and require a token:

```powershell
$env:LEDGER_HTTP_TOKEN="shared-secret"
npm run ledger -- serve --host 0.0.0.0 --port 8787
```

Peers can then copy missing stream prefixes:

```powershell
npm run ledger -- sync --peer http://127.0.0.1:8787
```

With a token-protected peer:

```powershell
$env:LEDGER_PEER_TOKEN="shared-secret"
npm run ledger -- sync --peer http://OTHER-PC:8787
```

Implemented endpoints:

```txt
GET /health
GET /manifest
GET /streams
GET /streams/:name
GET /inbox/:lane
GET /workers
GET /workers/free
GET /tasks/active
POST /commands/message
POST /commands/start
POST /commands/ack
POST /commands/status
POST /commands/worker
POST /commands/task
POST /commands/report
POST /commands/claim
POST /commands/release
POST /commands/resolve
POST /streams/:name
```

`POST /streams/:name` intentionally returns `405`. Command endpoints append only to the server's local node stream, preserving one-writer-per-stream. V2 sync copies stream bytes from the writer's peer and appends only when the local stream is a byte-for-byte prefix. If a same-name stream diverges, the ledger writes a `*.conflict.*` copy and refuses to merge it into canonical truth.

Boss-to-lane HTTP message:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8787/commands/message `
  -ContentType 'application/json' `
  -Body '{"to":"codex-b","body":"Do the package preview gate next."}'
```

Codex B startup/mail check:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8787/commands/start `
  -ContentType 'application/json' `
  -Body '{"lane":"codex-b","ttlSeconds":180}'
```

Worker task lifecycle:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8787/commands/task `
  -ContentType 'application/json' `
  -Body '{"lane":"codex-b","taskId":"task-preview-gate","state":"progress","summary":"tests passing"}'
```

Boss worker queries:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8787/workers
Invoke-RestMethod -Uri http://127.0.0.1:8787/workers/free
Invoke-RestMethod -Uri http://127.0.0.1:8787/tasks/active
```

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
- HTTP command API for message/start/ack/status/ownership commands
- typed worker/task lifecycle events and boss query views
- hash-chain tamper detection
- cold stream compaction into immutable archive segments
- startup heartbeat and unread inbox check
