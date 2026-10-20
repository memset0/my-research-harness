---
name: memon-migrate-fs
description: Migrate selected legacy memon experiments or reports using shipped migration guides and scripts when requested.
disable-model-invocation: true
---

# Migrate selected data

Read `.memon/version.json` and the selected files; FS11 may still contain legacy
experiments. Locate the installed checkout from the launcher or the `source`
returned by `memon --project-root . install-skills --dry-run`, then read the
relevant guide in `packages/core/migrations/`. Missing guides or newer data
block conversion; never infer a migration from missing metadata.

Run the guide's executor from `packages/core/migrations/scripts/` on the
file-owning machine. FS10-to-FS11 uses `v10-to-v11.mjs`; Reports use
`reports-to-wiki.mjs` and its guide.
Read the plan, resolve scientific ambiguities with the user, and apply only the
requested scope. Existing authorization covers mechanical steps within it.

Preserve original offset timestamps, raw outputs, useful caveats and historical
links. Keep recoverable preimages and unrelated edits. Do not move running or
queued work, invent measurements, or treat retirement as invalidity. Verify the
result before updating the marker or committing under the project's Git rules.
A partial migration does not convert every legacy experiment. Inspect failures
before retrying; use the guide's recovery instructions.
