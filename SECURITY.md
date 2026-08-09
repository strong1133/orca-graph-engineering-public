# Security policy

## Supported code

Security fixes target the current `main` branch and the latest published release. Older snapshots may be used for diagnosis but do not receive backports unless a maintainer explicitly announces them.

## Reporting a vulnerability

Do not include exploit details, tokens, local paths, or user graph data in a public issue. Use the repository's [private vulnerability report](https://github.com/strong1133/orca-graph-engineering-public/security/advisories/new) with:

- the affected version or commit;
- a minimal reproduction using synthetic data;
- impact and required attacker access;
- whether the panel, bridge, wide-view loopback server, or generated bundle is affected;
- any suggested mitigation.

If private reporting is unavailable, contact the maintainer through the repository owner profile and request a private channel before sharing details.

## Security boundaries

- The plugin panel is sandboxed and uses only declared Orca capabilities.
- The bridge runs in a visible, user-selected shell and writes local runtime JSON with owner-only permissions.
- Folder sources write only `.orca-graph-engineering/store.json` below an explicitly selected existing absolute directory, reject filesystem-root and symbolic-link storage targets, and never run Git or persist bridge/session identity in the portable store.
- The optional wide view binds to `127.0.0.1`, uses an unguessable per-process route, disables caching, and does not enable CORS.
- Live graph execution can create or write to Orca terminals. Structural, permission, budget, branch, and loop checks therefore fail closed before terminal dispatch.

Never attach real credentials, session transcripts, runtime stores, or private graph exports to a report.
