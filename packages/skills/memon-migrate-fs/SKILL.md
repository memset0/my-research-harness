---
name: memon-migrate-fs
description: Migrate selected memon data using the shipped version guides when the user requests it.
disable-model-invocation: true
---

# Filesystem migration

Run `memon --project-root . fs-version check` and read the shipped guide for
each required `vN-to-vN+1` step in `packages/core/migrations/` of the installed
checkout. Missing guides or a newer project version block conversion.

For FS11, use `memon --project-root . experiment migrate <E-id>` to prepare a
plan, inspect its paths, times, exclusions and rewritten explanation, then
apply with `--apply <plan.json>` within the agreed scope. Ask about unresolved
scientific boundaries, not mechanical steps already authorized.

Keep recoverable preimages; preserve unrelated edits, raw outputs and historical
links. Never move running/queued executions or silently merge research generations.
Missing extracted metrics are valid. Follow the guide's verification and rollback
steps, write the version marker last with a local-offset time, and use its exact
commit message under the project's Git rules. A new marker does not mean every
legacy experiment was converted. Inspect partial failures before retrying.
