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

### The save terminal

The panel runs inside the Orca plugin API v1 sandbox. That sandbox has no network, no filesystem, and no browser storage. The only way out is `terminal.sendText`, so **saving and running send one command line to a terminal**.

The plugin uses **its own terminal**, a tab named `Graph Engineering` that `corepack npm run build` opens for you at install time. There is nothing to pick and nothing to keep track of.

Close it whenever you like — the next command run opens it again. In a worktree that has no dedicated terminal yet, the panel sends once through a terminal that is not running an agent, and that command opens the dedicated one there. **It never sends into a pane running Codex or Claude** — those terminals are the ones that receive work.

With no terminal open at all the panel has nowhere to send. It cannot open one either: the actions Orca exposes to a sandboxed panel are `workspace.readContext`, `terminal.sendText`, and `notifications.show`, and nothing else. So the panel holds the command instead of dropping it and **sends it the moment a terminal tab appears** (it raises an Orca notification too). Opening one tab is all you have to do.

There is no resident process. Nothing to keep running, no connection state. Pressing save runs one command once.

Commands that follow one another go out **as a single line**. Typing a second line while the first is still running puts that input in the tty's canonical-mode buffer, which is small enough that a long payload is silently truncated — and a truncated line is a shell syntax error, so the run never happens. Saving and running are therefore chained with `&&` in one line, and a failed save stops the run.

```bash
# the shape of what runs in the dedicated terminal — you never type this yourself
node ./scripts/graph-store.mjs save <payload>
```


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

Both the human draft and the Meta draft are edited by hand. The Meta draft is the prompt actually used for execution; leave it empty and the human draft is sent as-is. Every edit appends a new revision.

## 6. Routing

A node's `project`, `branch`, `session`, `model`, and `reasoning` are resolved per field in this order.

1. Node value
2. Graph default
3. Orca or agent default

Choosing an existing session makes that session's project, worktree, and branch the real execution location. The model value is then only checked for compatibility with the session's agent family; it never switches a running model. Choosing a project and branch without a session creates a new agent terminal in that branch's existing Orca worktree. **The plugin never creates a worktree that does not exist.**

Reasoning for a new session is limited to values the model catalog declares. The Claude CLI takes `--effort`; Codex takes `model_reasoning_effort`. Values outside the catalog are rejected before any terminal is created.

## 7. Execution

`▶ Run` **hands the work to an Orca session in the target project**. Pick an existing session and the prompt goes there; pick a worktree and a fresh claude/codex session is started in that checkout and given the prompt.

**Choosing a target** — the run dialog groups targets the way the Orca sidebar does: machine → project → worktree. You pick a worktree, and pinned/active/live-terminal marks appear in the same order Orca uses. Picking a worktree on another machine moves the run there — one run happens on one machine.

**Single vs per-project** — select more than one worktree and you choose how they are assigned. Single runs once in the first worktree with one session and model; per-project gives each worktree its own session, model, and reasoning, and dispatches to each.

**Run without approvals** — sessions the plugin opens skip permission prompts by default (claude `--permission-mode bypassPermissions`, codex `-a never --dangerously-bypass-approvals-and-sandbox`). An unattended session that stops at an approval prompt cannot be driven remotely. Turn it off in the run dialog and that session asks as usual.

From there the agent in that session owns the work — walking the graph node by node, deciding conditions, recording results. **There is no separate executor inside the plugin.**

The reason for this boundary is simple: the panel has no channel back from a session. Estimating progress or inferring completion would mean presenting unverified state as fact.

**Pre-flight blocking** — only real graph structure and link errors block a run. A missing target or model is surfaced separately as a run-configuration problem.

**Result contract** — the prompt asks the agent to make the first line of its final response exactly `RESULT: done` or `RESULT: failed — <reason>`.

**No prompt without a live session** — agents start under `exec`, so a command that dies immediately takes the terminal with it instead of falling back to a shell; the prompt can never be typed into one. The dispatcher checks the session is still alive right before sending and, when it is not, reports the last line of that screen as the reason.

**Execution status** — clicking a card opens the detail for that run: the exact prompt that was sent, each target's session state (working / idle / closed) with the last line on that screen, and earlier runs of the same item. Session state is what was observed at the last `Orca 대상 갱신`.

**Reset** — `↺ Reset run state` rolls back node status while leaving nodes and edges alone. Past run history is preserved. Saving propagates it to the data source.

## 8. Execution status

`Execution status` is a log of **what the panel sent, where, and when**. Each entry records the graph or Task name, the target project and branch, whether it reused a session or opened a new one, and the time it was sent.

The same screen also shows the run history recorded on the graph. When the source keeps per-node results, you get the run number, status, verbatim work input, and each node's status, attempt count, duration, and failure reason.

This screen requires no connection, does not poll, and does not open a separate tab. Dispatch records live only in a local file on this machine, capped at 200, and never mix into graph data or an external source.


## 9. Calling a graph from a graph

A `graph_call` node calls another non-archived graph as its child. Call cycles, missing targets, and archived targets are blocked before execution. The default recursion depth is 8 and can be changed on the root graph.

Three routing-combination policies are available: child settings only, parent fills blanks with child priority, and call-node values win. Inside the child, child node values always take final precedence. The child run records its parent run, graph, and node; the parent run records its child run IDs.

## 10. Connecting a data source

`구조화 Workspace` connects to any HTTP implementation that follows public Data Source contract v1, documented in [docs/data-source-contract.md](docs/data-source-contract.md).

Token values are never stored. Put the token in the environment of the terminal that runs the save command and enter only the **environment variable name** in the UI. The connection snapshot lives in a replaceable `source-cache.json`, excluded from Git and from the distributed package.

Node-level execution contracts (`role`, `maxAttempts`, `permissions`, `dataClass`, `idempotencyKey`, `timeoutSeconds`, and so on) travel inside the Graph aggregate, but the contract allows a provider to ignore them. When a save comes back without them, the panel reports exactly which keys were not preserved — the approval gate, retry, and permission checks for that node will not apply at run time.

## 11. Environment variables

| Name | Default | Meaning |
| --- | --- | --- |
| `ORCA_GRAPH_RUNTIME_DIR` | Orca app data | Where saved state is stored |
| `ORCA_GRAPH_PANEL_PATH` | this package's `dist/panel.html` | Panel file the snapshot is written into |
| `ORCA_GRAPH_LOCAL_ENVIRONMENT_NAME` | host name | Display name for this machine |
| `ORCA_CLI_COMMAND` | platform default | Orca CLI executable |
| `ORCA_GRAPH_WORKSPACE_BASE_URL` | none | Structured source base URL (HTTPS) |
| `ORCA_GRAPH_WORKSPACE_ENVIRONMENT` | host name | This device's execution environment name |
| `ORCA_GRAPH_PRIMARY_ENVIRONMENT` | this device | Reference device for the project registry |
| `ORCA_GRAPH_WORKSPACE_API_PATH` | `/api/plugins/orca-graph-engineering` | Source API path |
| `ORCA_GRAPH_WORKSPACE_CLIENT_HEADER` | `X-Orca-Graph-Client` | Client identity header name |
| `ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR` | none | Global holding the session token on the base page; bootstrap is attempted only when set |
| `ORCA_GRAPH_WORKSPACE_SESSION_HEADER` | `X-Session-Token` | Session token header name |

Everything a source connection needs comes from the variables above. The plugin source carries no address, name, or token convention belonging to any particular deployment, and a feature you do not configure stays off. Device names come from your setting and the source registry, never from a list the code knows.

## 12. Known boundaries

These boundaries follow directly from what Orca plugin API v1 grants a panel.

- **Nothing is observable after handoff** — the panel has no channel back from a session. Check progress and completion in the Orca session itself; execution status records only what was sent.
- **Saving needs a terminal** — the panel iframe runs under `connect-src 'none'` and the `storage` host API is not panel-callable. `terminal.sendText` is the only way out.
- **Fresh data appears when you reopen the panel** — save and refresh rewrite the bootstrap in `dist/panel.html`, and Orca re-reads that file each time the panel opens.
- **There is no cancel** — a prompt already delivered to a session cannot be recalled. Stop it in that Orca session.
- **Routine scheduler** — still metadata.

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
