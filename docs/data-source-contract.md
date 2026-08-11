# Data Source contract v1

Graph Engineering supports four source modes.

- `local`: GraphStore remains in Orca app data at `plugin-runtime/orca-graph-engineering/store.json`.
- `folder`: a user-selected local folder or checked-out Git repository stores the complete GraphStore.
- `structured`: a remote workspace is the source of truth for Graph, Domain, Milestone, Task, Todo, prompt lineage, and CAS versions.
- `unstructured`: arbitrary JSON is a read-only catalog; graphs continue to use the local store.

The save CLI stores `data-source.json` and a replaceable `source-cache.json` outside the plugin directory in Orca app data. `ORCA_GRAPH_RUNTIME_DIR` can override that directory. A legacy repository-local `runtime/` is copied once when the new location is empty, and remains excluded from packages and Git. Authentication is configured as an environment-variable **name** such as `GRAPH_SOURCE_TOKEN`; the token value is read only by the save CLI process and is never placed in the config, graph, cache, panel bootstrap, or logs. When the dedicated `ORCA_GRAPH_SOURCE_TOKEN` variable is missing after a restart and `ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR` names the global that carries it, the save CLI may reacquire the advertised session token from the configured source's same origin. Without that variable the bootstrap is not attempted at all. It retains the value only in the current process. Arbitrary authentication variables never use this bootstrap path.

## Folder and local Git storage

`folderPath` must identify an existing absolute directory and cannot be the filesystem root. The save CLI stores the complete GraphStore at `<folderPath>/.orca-graph-engineering/store.json`. If the file does not exist when the source is connected, the current panel store seeds it once. An existing valid file always wins and is never overwritten during connection.

Writes use an owner-only temporary file followed by an atomic rename. The storage directory and store file cannot be symbolic links, reads are capped at 10 MiB, and the save terminal id, dispatch log, and transient status messages are removed from the portable file. A refresh reloads external edits, including changes obtained by a user-run Git pull. The plugin never invokes Git, commits, pushes, clones, or resolves repository credentials.

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

The plugin sends one full item through the common mutation boundary. `expectedVersion=0` creates an item; later writes send the exact last-read version. `relatedVersions` carries CAS values for coupled records in both directions: a Todo mutation carries its bound Task version, while a Task lifecycle mutation carries its bound Todo version. The server must never silently merge or retry a stale write. After every successful mutation the save CLI discards its cache and fetches a canonical snapshot again.

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

### Optional process aggregate API

Some structured providers expose an authenticated aggregate API beside contract v1. This additive surface does not change the four contract-v1 endpoints and older providers remain valid.

- Graph payload: `process_enabled`; current and recent runs include nullable `input_prompt`.
- Task target project: the existing Task project relation is used with `role=target`, `locator_kind=folder`, the local path, and an optional normalized `branch`. No plugin-owned duplicate relation is created.

The structured snapshot projects these source fields directly to portable `processEnabled`, `GraphRunRecord.inputPrompt`, and Task `projects`. The save CLI accepts that projection without aggregate fan-out; its aggregate graph reads remain a compatibility fallback for older adapters. Branch values remove `refs/heads/` and enforce the safe Git ref subset as well as the 255-character bound. HTTP 409 causes a canonical re-read and a visible conflict; it is not an automatic write retry.

**No longer used by this client.** The device repo registry (`PUT/GET /orca-projects`, `POST /orca-projects/{environment}/provision`), the ordered quick-graph endpoint (`POST /graphs/quick`), and run-start (`POST /graphs/{graphId}/runs`) were removed together with the resident helper process. Each needed a response back into the panel, which Orca's panel sandbox does not provide. Task project relations and quick graphs are now built locally and committed through the ordinary save path; runs are started by the agent in the target Orca session. Providers may keep serving those endpoints for other clients.


### Remote execution capability

**No longer used by this client.** The panel hands work to an Orca session and the agent there owns execution, so the plugin no longer chooses between a local and a remote executor. A source that advertises `capabilities.execution` is accepted and ignored; a source that omits it behaves identically. A replaceable panel cache is never execution state.

## Unstructured projection

The save CLI accepts a JSON array or object. With no mapping it finds the largest nested array and recognizes common `id`, `title`, and body fields. `recordsPath`, `idField`, `titleField`, and `bodyField` make the mapping deterministic. The result is capped at 500 candidates and cannot be written back because the source exposes no mutation or concurrency contract. Projection keeps only the selected fields and source path; the raw source object is not copied into the Graph or panel bootstrap.

Remote requests allow only HTTP(S), reject credentials embedded in URLs and redirects, time out, and reject responses larger than 5 MiB.
