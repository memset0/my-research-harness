# Preflight — FS convention version

Every memon skill that reads or writes spec files (Experiment bundles, Run
READMEs, `docs/hypotheses.md`, `docs/journal.md`, anything under
`docs/digests/` or `docs/reports/`) checks the project root's on-disk schema
version before doing any work. The check is a single CLI call; the agent
branches on its result to either proceed, stop with a recommendation, or
surface a fatal mismatch.

This doc is the canonical source for the protocol. Project-aware skills point
here instead of duplicating the branch table. `memon-notify` has no project
tree, and `memon-migrate-fs` is exempt because it resolves version mismatch.

## How

Run, as the first executable step in the skill workflow:

```sh
memon --project-root . --format json fs-version check
```

Branch on the `status` field:

- `match` → proceed with the rest of the skill.
- `behind` → STOP. Tell the user: "Project FS convention is at v<current>;
  current memon expects v<available>. Please run the `memon-migrate-fs`
  skill to upgrade before continuing." Do NOT read or write any spec file
  (`README.md`, `implementation.yaml`, `investigation.yaml`, `results.yaml`,
  `docs/hypotheses.md`, `docs/journal.md`, `docs/digests/*`, `docs/reports/*`).
- `uninitialised` → STOP. Tell the user: "This project root has not had
  memon installed yet. Run `memon --project-root . install-skills` first."
  Do NOT read or write any spec file.
- `ahead` → the CLI already exited 11 (`MEMON_TOO_OLD`). Forward the
  error: "Project FS convention is at v<current>; this memon supports up
  to v<available>. Upgrade memon to a release that supports v<current> or
  later." Do NOT proceed.

## Migration runtime exemption

`memon-migrate-fs` is exempt from this preflight. It IS the migration
runtime, and reads `<projectRoot>/.memon/version.json` directly as
part of its own state-determination step. If `memon-migrate-fs` ran
the preflight first, an `uninitialised` or `behind` project would
short-circuit the migration before it could fix the gap.

## Read compatibility is not write compatibility

The web app and document parser intentionally render legacy/unsupported
sections so users can review old projects. That tolerant UI behavior does not
authorize an ordinary skill to operate on a `behind` project. Only the migration
skill may transform old content, and review-required migrations do so in local
staging before touching production files.
