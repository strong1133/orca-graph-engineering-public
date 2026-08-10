# Data Source contract v1

Graph Engineering supports four source modes.

- `local`: GraphStore remains in `runtime/store.json`.
- `folder`: a user-selected local folder or checked-out Git repository stores the complete GraphStore.
- `structured`: a remote workspace is the source of truth for Graph, Domain, Milestone, Task, Todo, prompt lineage, and CAS versions.
- `unstructured`: arbitrary JSON is a read-only catalog; graphs continue to use the local store.

The bridge stores `runtime/data-source.json` and a replaceable `runtime/source-cache.json`. Both are excluded from packages and Git. Authentication is configured as an environment-variable **name** such as `GRAPH_SOURCE_TOKEN`; the token value is read only by the bridge process and is never placed in the config, graph, cache, panel bootstrap, or logs.

## Folder and local Git storage

`folderPath` must identify an existing absolute directory and cannot be the filesystem root. The bridge stores the complete GraphStore at `<folderPath>/.orca-graph-engineering/store.json`. If the file does not exist when the source is connected, the current panel store seeds it once. An existing valid file always wins and is never overwritten during connection.

Writes use an owner-only temporary file followed by an atomic rename. The storage directory and store file cannot be symbolic links, reads are capped at 10 MiB, and bridge terminal IDs, workspace identity, and transient status messages are removed from the portable file. A refresh reloads external edits, including changes obtained by a user-run Git pull. The bridge never invokes Git, commits, pushes, clones, or resolves repository credentials.

Folder storage is intended for personal or otherwise coordinated file ownership. It does not provide distributed CAS or merge concurrent writers; users should serialize edits and resolve Git conflicts before refreshing the panel.

## Structured endpoints

The configured URL is a base URL. A compatible server implements:

```text
GET  {base}/orca-graph-source/v1
GET  {base}/orca-graph-source/v1/snapshot
POST {base}/orca-graph-source/v1/graphs/{graphId}/commit
POST {base}/orca-graph-source/v1/mutations
```

Every response and mutation body carries `contractVersion: 1`. The snapshot returns:

```json
{
  "contractVersion": 1,
  "source": { "id": "workspace", "name": "Workspace" },
  "capabilities": {
    "graphCommit": true,
    "domainMutation": true,
    "milestoneMutation": true,
    "taskMutation": true,
    "todoMutation": true,
    "promptMutation": true,
    "todoTaskBinding": "mutable",
    "taskCatalog": true,
    "todoCatalog": true,
    "execution": { "mode": "remote-claim", "nodeKinds": ["task", "condition"], "claimLeaseSeconds": 900 }
  },
  "store": {
    "schemaVersion": 1,
    "activeGraphId": "graph-id",
    "domains": [],
    "milestones": [],
    "tasks": [],
    "todos": [],
    "graphs": []
  },
  "catalog": { "tasks": [], "todos": [] }
}
```

Mutation-capable providers include all four work collections. Older read-only v1 providers may omit them; the panel then fails closed for work edits. A Milestone always belongs to one Domain, and a Task/Todo `milestoneId` must resolve to the same `domainId`. Todo may additionally carry the provider-neutral free-form fields `groupName` and `subgroupName`; these describe the Todo list hierarchy and are independent of execution scope. Prompt revisions use `kind=draft|meta`; Meta revisions identify the human Draft they refine with `basedOnId` and are append-only.

The plugin sends one full item through the common mutation boundary. `expectedVersion=0` creates an item; later writes send the exact last-read version. `relatedVersions` carries CAS values for coupled records in both directions: a Todo mutation carries its bound Task version, while a Task lifecycle mutation carries its bound Todo version. The server must never silently merge or retry a stale write. After every successful mutation the bridge discards its cache and fetches a canonical snapshot again.

```json
{
  "contractVersion": 1,
  "operation": "upsert",
  "kind": "todo",
  "expectedVersion": 7,
  "relatedVersions": { "task-id": 3 },
  "item": {
    "id": "todo-id",
    "version": 7,
    "title": "Ship contract",
    "groupName": "Delivery",
    "subgroupName": "Release",
    "domainId": "domain-id",
    "milestoneId": "milestone-id",
    "draft": "Human-authored source",
    "metaDraft": "Generated execution-ready form",
    "promptRevisions": []
  }
}
```

`todoTaskBinding=mutable` means link, unlink, and rebind are supported by the Todo aggregate CAS. Providers preserve those transitions as append-only history instead of deleting prior relationship evidence. Binding or changing a Todo lifecycle synchronizes the selected Task lifecycle; changing a bound Task lifecycle synchronizes the Todo. Archiving a Task unbinds its Todo atomically, bumps the Todo version, and preserves the unbind transition in history.

A graph commit sends the graph's last-read version as `expectedVersion`. A new graph uses version `0`. The server must commit the graph aggregate atomically, return HTTP 409 on stale CAS, and return the canonical graph with its next version. Missing graphs are not interpreted as deletions; archive is an explicit graph lifecycle state.

```json
{
  "contractVersion": 1,
  "expectedVersion": 7,
  "graph": { "id": "graph-id", "version": 7 }
}
```

### Portable editor metadata

Contract v1 does not add a separate presentation endpoint. Optional editor state travels inside the existing Graph aggregate extension:

```json
{
  "engineering": {
    "editor": {
      "groupBy": "domain",
      "edgeWaypoints": { "edge-id": [{ "x": 144, "y": 96 }] }
    }
  },
  "nodes": [{ "engineering": { "layoutPinned": true } }]
}
```

`groupBy` is one of `none`, `domain`, `milestone`, `superstep`, or `loop`. Waypoints are finite canvas coordinates keyed by edge ID; clients cap each edge at 24 points. These fields do not affect execution semantics. A provider may ignore them, but a provider that claims lossless Graph aggregate round-tripping should preserve them unchanged in the canonical response and subsequent snapshot. Group membership is derived from existing Domain/Milestone relations or graph analysis and is not duplicated in the payload.

### Optional process and device-project aggregate API

Some structured providers expose an authenticated aggregate API beside contract v1. This additive surface does not change the four contract-v1 endpoints and older providers remain valid.

- Graph payload: `process_enabled`; current and recent runs include nullable `input_prompt`.
- Start a run: `POST /graphs/{graphId}/runs` with `{ expected_version, trigger_kind, input_prompt? }`.
- Device repo registry: `PUT /orca-projects/{environment}` with the mapped `orca repo list --json` projects; `GET /orca-projects` reads all device mirrors; `POST /orca-projects/{environment}/provision` prepares a missing Git project/worktree from a versioned source registry entry.
- Task target project: the existing Task project relation is used with `role=target`, `locator_kind=folder`, the published local path, and an optional normalized `branch`. No plugin-owned duplicate relation is created.
- Ordered quick graph: `POST /graphs/quick` receives `{ source_task_id, expected_task_version, name, summary?, task_ids }`. The source Task is first, IDs are unique, and the list contains 2–100 active Tasks with the exact same Domain and Milestone. The server creates the draft graph, ordered Task nodes, and sequence edges atomically. A stale source Task returns 409; the client re-reads the Task and never retries the write with a guessed version.

The structured snapshot projects these source fields directly to portable `processEnabled`, `GraphRunRecord.inputPrompt`, and Task `projects`. The bridge accepts that projection without aggregate fan-out; its aggregate graph reads remain a compatibility fallback for older adapters. A new process run requires a non-blank input, but the string sent in `input_prompt` is not trimmed or normalized by the client. A resume does not create another run and uses the stored input. Each local loop iteration carries the same run input.

Registry publication is event-driven: bridge startup and explicit Orca target refresh are triggers, and an in-memory canonical payload comparison skips an unchanged second PUT. The mapped registry is validated against the server's count and field-size bounds before PUT. A rolling-deployment compatibility path recognizes only a v31 `extra_forbidden` response for the additive `worktrees` field, publishes the project-only shape once, and leaves the full-payload signature unset so the next explicit refresh probes v32 again. The Task picker can commit up to 100 project/branch bundles at once. A missing target device project or branch is provisioned only from the exact canonical source path and `expected_source_version`; the server-returned `target_path` is then included in the same Task relation update. Linking projects or changing branches begins by reading the latest Task aggregate, preserves every existing relation, applies the confirmed change, and patches with that exact version. Branch values remove `refs/heads/` and enforce the safe Git ref subset as well as the 255-character bound. HTTP 409 causes a canonical re-read and a visible conflict; it is not an automatic write retry.

### Remote execution capability

A structured source owns execution state. A source that offers no execution capability keeps the original boundary: the local bridge fails closed for live execution and the user starts the run in the source workspace. A replaceable panel cache is never execution state.

A source that owns a distributed claim protocol may say so. The capability is additive; clients that do not understand it, and sources that omit it, behave exactly as before.

```json
"execution": {
  "mode": "remote-claim",
  "nodeKinds": ["task", "condition"],
  "claimLeaseSeconds": 900
}
```

`mode` is the only defined value `remote-claim`. `nodeKinds` lists the kinds a remote client may claim; every other kind stays with the source. This is how a source keeps `graph_call` run lineage and loop re-entry to itself while still letting a client route ordinary work.

```text
GET  {base}/orca-graph-source/v1/graphs/{graphId}/execution
POST {base}/orca-graph-source/v1/graphs/{graphId}/nodes/{nodeId}/claim
POST {base}/orca-graph-source/v1/graphs/{graphId}/nodes/{nodeId}/complete
```

The execution endpoint returns the runnable frontier, not the design document. Readiness, branch closure, and run identity are derived state the source recomputes on every read; they never travel inside the Graph aggregate.

```json
{
  "contractVersion": 1,
  "graph": { "id": "graph-id", "version": 12, "status": "running" },
  "run": { "id": "run-id", "runNo": 3, "status": "running", "startedAt": "2026-08-09T00:00:00Z" },
  "claimLeaseSeconds": 900,
  "nodes": [
    {
      "id": "node-id", "kind": "task", "label": "Ship it", "status": "pending",
      "ready": true, "branchClosed": false, "joinMode": "all", "executable": true,
      "task": { "id": "task-id", "title": "Ship it", "prompt": "…", "version": 4 }
    },
    {
      "id": "other-id", "kind": "graph_call", "status": "pending",
      "ready": true, "branchClosed": false, "joinMode": "all",
      "executable": false, "reason": "graph_call run lineage stays with the source"
    }
  ],
  "warnings": []
}
```

A client takes one `ready` and `executable` node at a time and claims it with the graph version it last read.

```json
{ "contractVersion": 1, "expectedVersion": 12 }
```

A claim is a lease, not a lock the client can release. The source transitions the node only from its pending state, so two executors racing the same node produce exactly one winner and one HTTP 409. On 409 the client re-reads the frontier; it never retries blindly and never writes the node state it wanted. If the client dies mid-node, the lease expires and the source reclaims the attempt — silence is not a claim held forever.

Completion reports the outcome and returns the graph the source now holds.

```json
{
  "contractVersion": 1,
  "expectedVersion": 13,
  "result": "done",
  "branch": "y",
  "note": "routed to session abc",
  "sessionId": "abc"
}
```

`result` is `done`, `failed`, or `skipped`. A condition node completing as `done` requires `branch`; every other kind rejects it. `note` and `sessionId` are optional provenance the source may record with the attempt. `branchClosed` nodes are completed as `skipped`.

A client must not claim a node whose `executable` is false, and should refuse a run before its first claim when the graph's reachable frontier needs one — a run that stalls halfway is worse than a run that never started. The source remains free to execute those nodes itself.

## Unstructured projection

The bridge accepts a JSON array or object. With no mapping it finds the largest nested array and recognizes common `id`, `title`, and body fields. `recordsPath`, `idField`, `titleField`, and `bodyField` make the mapping deterministic. The result is capped at 500 candidates and cannot be written back because the source exposes no mutation or concurrency contract. Projection keeps only the selected fields and source path; the raw source object is not copied into the Graph or panel bootstrap.

Remote requests allow only HTTP(S), reject credentials embedded in URLs and redirects, time out, and reject responses larger than 5 MiB.
