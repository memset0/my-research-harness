---
name: memon-migrate-fs
description: Migrate explicitly selected memon project data using the shipped filesystem-version guides and scoped conversion tools. Use when the user requests migration; preserve evidence, unrelated edits and recoverable preimages.
disable-model-invocation: true
---

# Filesystem migration

Follow the user's authorized scope. Read `memon --project-root . fs-version
check`, then the full shipped guide for each required `vN-to-vN+1` step.
Locate guides in the installed memon checkout under `packages/core/migrations/`.
A missing guide or an ahead-of-tooling version blocks conversion. Do not
migrate merely because a project is old, or while deploying the dashboard.

For V11, use `memon experiment migrate <experiment>` to produce a local plan.
Inspect the declaration, Run moves, timestamps, exclusions and proposed README;
resolve scientific ambiguities with the user. A migration request with an
already agreed boundary authorizes that scoped implementation; do not add
repeated approval steps for mechanical work. Use `--apply <plan.json>` only
after completing the review. Follow the guide's layout, snapshot, marker and
verification steps. Never imply that a V11 project marker means all legacy
experiments were converted.

Keep backups and plans outside tracked research files. Check ownership and the
working tree first. Preserve unrelated edits, and never stash/reset them.
Where a guide requires a clean tree or explicit dirty-tree scope, follow that
requirement. Do not move running/queued executions or flatten multiple
research generations without resolving their evidence meaning. Keep native
outputs; missing extracted metrics are not a migration failure.

Verify the selected files, preserved artifacts, historical links, new and old
browser views, and the CLI workflow. Record actual results. Update the marker
last with a timezone-bearing timestamp. Use the guide's exact migration commit
message and rollback instructions; repository Git authorization still applies.
A failed partial write needs inspection and repair, not blind repetition.
