# Orca Graph Engineering

[한국어](README.md) · English

## 1. Quick start

### Requirements

| Item | Version |
| --- | --- |
| Orca | `1.4.176` or newer |
| Node.js | `22` or newer |

### Install

```bash
git clone https://github.com/strong1133/orca-graph-engineering-public.git
cd orca-graph-engineering-public
corepack enable
corepack npm ci
corepack npm run build
```

`corepack npm run build` produces `dist/panel.html`. Orca cannot open the panel without it.

### Add it to Orca

1. Enable the plugin system in Orca settings.
2. Point a Development plugin path at this repository directory. The manifest is `orca-plugin.json` at the top level.
3. Installation is done when the `Graph Engineering` panel appears in the sidebar.

For a distributable archive run `corepack npm run package:plugin` and verify it with `corepack npm run verify:plugin`. The extracted `package/` directory works directly as a Development plugin path.

### Prerequisite — the bridge

The panel runs inside the Orca plugin API v1 sandbox. Saving files and creating agent terminals require a **local bridge**.

1. Open one Orca terminal in this repository directory.
2. Start the bridge in it.

```bash
node ./bridge/index.mjs
```

3. Select that terminal as the bridge at the top of the panel.
4. You are ready when `Graph Engineering bridge ready` appears. Keep the terminal open while you use the plugin.

You can draw and inspect graphs without the bridge, but saving, executing, and Meta Prompt generation will not work.

### Choose where your data lives

Pick one of three modes under `데이터 원천` (Data source) in the panel. Everything works without an external server.

| Mode | Storage | Use it when |
| --- | --- | --- |
| **Local JSON** (default) | `plugin-runtime/orca-graph-engineering/store.json` in Orca app data | Working alone, or starting immediately |
| **Folder** | `.orca-graph-engineering/store.json` in a directory you choose | Keeping work data beside an ordinary repository or folder, tracked in Git |
| **Structured workspace** | An external HTTP source | Several people or machines share the same graphs with CAS writes |

Folder mode accepts any Git repository or plain directory. On first connection it seeds the file once from the current panel contents; an existing file always wins.

## 2. What this is

A plugin that lets you **design multiple agent tasks as one execution graph inside Orca and run it, routing each node to a real Orca project, worktree, session, and model**. Work definitions (Domain, Milestone, Task, Todo) and execution history live in the same surface.

## 3. What it aims for

**It never runs on a guess.** If a routing target is ambiguous or a safety contract is unmet, it stops before executing. It does not invent worktrees that do not exist, and it does not send work to a session you did not choose.

**It records what happened.** For every node it keeps which session ran it, how many attempts it took, how long it ran, and what it returned. Failures keep their verbatim reason, and something you stopped is recorded as cancelled rather than failed.

**It puts a person in front of irreversible work.** An irreversible node only passes when an approved human gate dominates its execution path, and an agent cannot pass that gate on your behalf.

**It is complete locally.** Everything works with local JSON and no external service. An external source is optional and can be any implementation that follows the public contract.

**It does not destroy.** Archiving replaces hard delete. Resetting execution state never removes past runs.

## 4. Graph editing

- Create Task nodes, diamond condition nodes, and graph-call nodes, and connect them by dragging four-sided ports.
- Obstacle-avoiding orthogonal connectors, editable waypoints, per-branch colours and Y/N badges.
- Shift-area and modifier multi-select, align and distribute, copy/paste/duplicate, 100-step undo/redo.
- Auto-layout preview that preserves pinned nodes and the current selection.
- Grid that tracks zoom and pan, semantic zoom, alignment guides, vector minimap.
- `path`, `diamond`, `router`, `star`, `cycle`, `tree`, and `tool-bipartite` topology templates.
- Node search, graph-call breadcrumb navigation, shortcut help.

Edges are `sequence`, `blocks`, `informs`, and `loop`, with conditional branches and AND/OR joins.

## 5. Work management — Domain, Milestone, Task, Todo

The management screens work without connecting any data source.

- A Domain carries goals, constraints, and an owner, and contains Milestones. A Milestone always belongs to exactly one Domain.
- Tasks and Todos can stand alone or belong to a Domain or Milestone.
- Search covers title, ID, tags, human draft, and meta draft; results group by status or priority and collapse.
- Editing a human draft appends a new immutable revision and marks the previous meta draft stale instead of deleting it.
- One Task can be reused by several graph nodes; changing its title or effective instruction updates every linked node.
- `빠른 그래프 구성` (Quick graph) chains Tasks from the same scope in the order you pick them.
- Archiving replaces hard delete: Domain/Milestone archive, restorable Task archive, Todo cancel.

`Meta Prompt 만들기` creates a new agent session in the selected bridge worktree and generates an execution prompt using the plugin's built-in public prompt contract. It is stored only when the result passes the fixed nine-section structure and the human draft did not change meanwhile.

## 6. Routing

A node's `project`, `branch`, `session`, `model`, and `reasoning` are resolved per field in this order.

1. Node value
2. Graph default
3. Orca or agent default

Choosing an existing session makes that session's project, worktree, and branch the real execution location. The model value is then only checked for compatibility with the session's agent family; it never switches a running model. Choosing a project and branch without a session creates a new agent terminal in that branch's existing Orca worktree. **The plugin never creates a worktree that does not exist.**

Reasoning for a new session is limited to values the model catalog declares. The Claude CLI takes `--effort`; Codex takes `model_reasoning_effort`. Values outside the catalog are rejected before any terminal is created.

## 7. Execution

`▶ 실행` (Run) checks routing and safety contracts first and only dispatches what passes. A dry-run plan touches neither Orca nor the source.

**Blocked before running** — structural errors, unlabelled condition branches, unsafe permission combinations, network policy violations for sensitive data, missing idempotency keys, missing approval gates, exceeded token budgets, unavailable worktrees or sessions.

**Agent result contract** — the assigned agent makes the first line of its final response exactly `RESULT: done` or `RESULT: failed — <reason>`. Bold text or list markers read the same. An answer with no result line counts as success by default; set `ORCA_GRAPH_REQUIRE_RESULT_CONTRACT=1` to close those as failures too.

**Transient failure recovery** — interactive agent terminals can only be created while the Orca main window renderer is ready. The bridge checks `orca status` first and retries only transient failures with exponential backoff (90 seconds by default). Non-transient failures are reported immediately.

**Retries** — a node is redispatched up to its attempt budget. A session that already carries a failed turn is not reused; only that route's session is recreated, leaving other routes and their context continuity intact.

**Guards** — the run wall-time limit is checked at node boundaries. An approval gate never passes without human approval.

**Cancellation** — a running execution offers `■ 실행 중단` (Stop). It is observed at node boundaries, so it stops after the current node finishes and never rescinds work already sent to an agent; interrupting a turn mid-flight would leave a remote node claimed. A stopped execution is recorded as cancelled rather than failed, and a child graph entered through `graph_call` stops at the same boundary.

**Reset** — `↺ 실행 초기화` returns execution state while leaving nodes, edges, and past runs untouched. It is refused while an execution is running; stop it first.

## 8. Execution status and history

`실행 현황` (Execution status) shows execution records together with **per-node progress**. Each run carries its number, status, counters, and verbatim work input; each node row shows status, attempt count, duration, the Orca session that ran it, and its result or verbatim failure reason. Hovering a canvas node shows the same in a tooltip.

Execution records live only in `executions.json` in app data and never mix into graph data or an external source. Restarting the bridge closes unfinished records as failed so no ghost state remains.

## 9. Calling a graph from a graph

A `graph_call` node calls another non-archived graph as its child. Call cycles, missing targets, and archived targets are blocked before execution. The default recursion depth is 8 and can be changed on the root graph.

Three routing-combination policies are available: child settings only, parent fills blanks with child priority, and call-node values win. Inside the child, child node values always take final precedence. The child run records its parent run, graph, and node; the parent run records its child run IDs.

## 10. Connecting a data source

`구조화 Workspace` connects to any HTTP implementation that follows public Data Source contract v1, documented in [docs/data-source-contract.md](docs/data-source-contract.md).

Token values are never stored. Put the token in the environment of the terminal that runs the bridge and enter only the **environment variable name** in the UI. The connection snapshot lives in a replaceable `source-cache.json`, excluded from Git and from the distributed package.

Node-level execution contracts (`role`, `maxAttempts`, `permissions`, `dataClass`, `idempotencyKey`, `timeoutSeconds`, and so on) travel inside the Graph aggregate, but the contract allows a provider to ignore them. When a save comes back without them, the panel reports exactly which keys were not preserved — the approval gate, retry, and permission checks for that node will not apply at run time.

## 11. Environment variables

| Name | Default | Meaning |
| --- | --- | --- |
| `ORCA_GRAPH_RUNTIME_DIR` | Orca app data | Where bridge state is stored |
| `ORCA_GRAPH_TERMINAL_CREATE_TIMEOUT_MS` | `90000` | Terminal creation retry budget |
| `ORCA_GRAPH_AGENT_READY_TIMEOUT_MS` | `60000` | Wait for a new agent session to report ready |
| `ORCA_GRAPH_WORK_ITEM_TIMEOUT_SECONDS` | `900` | Standalone Task/Todo execution limit |
| `ORCA_GRAPH_REQUIRE_RESULT_CONTRACT` | off | Treat an answer with no result line as a failure |
| `ORCA_GRAPH_LOCAL_ENVIRONMENT_NAME` | host name | Display name for this machine |
| `ORCA_CLI_COMMAND` | platform default | Orca CLI executable |

## 12. Known boundaries

- **Loop edge execution** — editing, checking, and planning only; live execution is blocked. The routine scheduler is still metadata.
- **Remote `graph_call`** — blocked during structured-source execution because there is no child-run contract yet. Run the child graph directly, or use a local or folder source.
- **Cancellation points** — observed only at node boundaries. A standalone Task or Todo run has a single dispatch and therefore no cancellation point.
- **Wide view tab** — not an official editor contribution but a compatibility layer where the local bridge you started opens a loopback address in an Orca browser tab.

## Development

```bash
corepack npm run check      # typecheck + test + build
corepack npm run typecheck
corepack npm test
corepack npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute, [SECURITY.md](SECURITY.md) to report a vulnerability, and [docs/architecture.md](docs/architecture.md) for internals.

## License

MIT
