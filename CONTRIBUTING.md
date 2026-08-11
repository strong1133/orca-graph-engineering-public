# Contributing

Thanks for improving Graph Engineering. Changes should stay inside Orca's documented plugin API and keep the save command inspectable, user-triggered, and least-privileged.

## Development setup

Requirements:

- Node.js 22 or newer
- Corepack (the repository pins npm 10.9.4; CI also checks npm 11 compatibility)
- Orca 1.4.176 or newer for optional manual plugin checks

Install exactly from the lockfile and run the same gate as CI:

```bash
corepack enable
corepack install
corepack npm ci
corepack npm run check
corepack npm pack --dry-run --json
corepack npm run package:plugin -- --dry-run
```

`corepack npm run check` runs strict TypeScript checking, deterministic Vitest tests, and the production panel build. `corepack npm pack` verifies the source-only surface; `package:plugin -- --dry-run` verifies that the separate Orca bundle contains the manifest entry without creating a release artifact. For an actual bundle, run `corepack npm run package:plugin` followed by `corepack npm run verify:plugin -- release/orca-graph-engineering-plugin-0.2.0.tgz`. The explicit `corepack npm` form is required because some Node distributions keep their preinstalled bare `npm` binary after Corepack is enabled. The verifier opens the tgz, parses its manifest against the pinned official Orca panel schema snapshot, checks archive metadata and forbidden paths, then runs the extracted save CLI without installing dependencies and verifies a realistic save plus the panel-bootstrap refresh. Tests must not require a signed-in Orca session, network access, or a browser preview.

## Change workflow

1. Read [Architecture](docs/architecture.md) and identify whether the change belongs to the panel model, the sandboxed UI, or the save CLI.
2. Add a failing deterministic test for graph semantics, protocol behavior, or the public plugin contract.
3. Make the smallest change that passes the test. Do not add manifest fields or capabilities outside Orca plugin API v1.
4. Run `corepack npm run check`, `corepack npm pack --dry-run --json`, and `corepack npm run package:plugin -- --dry-run`. The source package must exclude `runtime/` and generated `dist/`; the complete plugin bundle must contain the manifest entry, tests, CI, and its locked check toolchain. Both must exclude credentials, absolute local paths, editor state, and internal planning artifacts.
5. Explain behavior and safety-boundary changes in README or architecture docs.

Graph execution changes need tests for both dry-run and live-run boundaries. Unsupported semantics must fail closed instead of being silently ignored. Live preflight tests must prove graph-call depth and every selected downstream route fail before run creation; identity tests must prove shell, busy, stale, and unproven sessions cause zero terminal sends. Keep fixtures portable and do not couple the public schema to a private task service or a contributor's local environment.

Validation changes must update `fixtures/graph-validation-matrix.json` and pass both the model unit suite and the save-CLI child-process suite. Panel interaction changes must keep the DOM tests for keyboard operation, dialog focus, and live regions passing.

## Pull requests

Keep pull requests focused and include:

- the user-visible outcome and failure mode addressed;
- tests added or updated;
- `npm run check` output;
- plugin API/capability impact, or “none”;
- manual Orca checks when the change depends on host UI behavior.

Do not commit generated `dist/` or `runtime/` files. Maintainers own version bumps and releases unless a change request explicitly says otherwise.

Security-sensitive findings should follow [SECURITY.md](SECURITY.md), not a public issue.
