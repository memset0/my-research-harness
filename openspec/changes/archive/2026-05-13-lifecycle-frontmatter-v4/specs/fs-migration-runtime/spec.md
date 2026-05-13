## ADDED Requirements

### Requirement: v3→v4 transform fills exp-side fields and migrates run-side archive sidecar

The `migrate-fs` runtime SHALL recognise `FS_CONVENTION_VERSION === 4` as the current version and SHALL apply the v3→v4 transform per `packages/core/migrations/v3-to-v4.md`. The transform SHALL be NOT a no-op — it walks both experiment docs and run dirs.

For each `docs/experiments/E*.md` file:
1. Parse the YAML frontmatter.
2. If `status:` is missing, insert `status: OPEN` (in canonical key order between `title` and `archived`); preserve any user-set value if present.
3. If `archived:` is missing, insert `archived: false` (in canonical key order between `status` and `runs`); preserve any user-set value if present.
4. If either field was inserted, atomically rewrite the doc and bump `updated_at` to the migration's ISO timestamp. If neither field changed (idempotent re-run), do not rewrite and do not bump `updated_at`.

For each run dir under the project's discovered roots:
1. Parse the run README's frontmatter.
2. If `archived:` is missing, compute `<derived> = exists('<runDir>/.archived')` and insert `archived: <derived>` (in canonical key order between `gpus` and `entry`); preserve any user-set value if present.
3. If `archived:` was inserted, atomically rewrite the README and bump `updated_at`.
4. After the README write succeeds AND the README's `archived` reflects the sidecar's prior signal, `unlink('<runDir>/.archived')` if the sidecar exists. The sidecar deletion is **strictly after** the README rewrite; if anything fails between, the sidecar remains and a re-run can retry idempotently.

The transform SHALL stamp `.memon/version.json` to `fs_convention_version: 4` after both walks succeed (and ONLY after both walks succeed). On any per-file failure within either walk, the transform SHALL surface the failure to the user without stamping the version (per the existing migration runtime's per-step protocol).

The transform SHALL preserve user-added custom frontmatter keys verbatim and SHALL NOT reorder existing keys (only insert the new ones in their canonical position).

#### Scenario: Migration writes status + archived on a v3 exp doc
- **GIVEN** a v3 exp doc whose frontmatter has `id`, `slug`, `title`, `runs`, `created_at`, `updated_at` (no `status` or `archived` keys)
- **WHEN** the v3→v4 migration runs against the project
- **THEN** the doc's frontmatter now has `status: OPEN` and `archived: false` inserted in their canonical positions
- **AND** the doc's `updated_at` is bumped to the migration's timestamp
- **AND** the doc's other fields are unchanged in value and order

#### Scenario: Migration converts run-side sidecar to frontmatter
- **GIVEN** a v3 run dir with README having no `archived` field AND `<runDir>/.archived` present
- **WHEN** the v3→v4 migration runs
- **THEN** the run README's frontmatter has `archived: true` inserted between `gpus` and `entry`
- **AND** the README's `updated_at` is bumped
- **AND** `<runDir>/.archived` no longer exists (`unlink`ed after the README write)

#### Scenario: Migration fills archived: false on non-archived run
- **GIVEN** a v3 run dir with README having no `archived` field AND no `<runDir>/.archived` sidecar
- **WHEN** the v3→v4 migration runs
- **THEN** the run README's frontmatter has `archived: false` inserted
- **AND** no sidecar deletion happens (none existed)

#### Scenario: Idempotent re-run is a no-op
- **GIVEN** a project where the v3→v4 migration has already run successfully
- **WHEN** the migration runs again
- **THEN** no exp doc is rewritten (all already have `status` and `archived`)
- **AND** no run README is rewritten
- **AND** the version stamp file shows `fs_convention_version: 4` (unchanged)
- **AND** no `updated_at` fields are bumped

#### Scenario: Custom frontmatter key preserved
- **GIVEN** a v3 exp doc whose frontmatter includes a custom user-added key like `wandb_project: "rad-ai"`
- **WHEN** the v3→v4 migration runs
- **THEN** the custom key is preserved verbatim in the migrated doc
- **AND** the new `status: OPEN` and `archived: false` keys are inserted in their canonical positions without disturbing the custom key

#### Scenario: Sidecar deletion fails but README write succeeded
- **GIVEN** a partial-failure scenario where the README rewrite committed `archived: true` but the subsequent `unlink('<runDir>/.archived')` failed
- **WHEN** the migration's per-step protocol completes
- **THEN** the version stamp is NOT bumped to 4 (since not all per-file work succeeded)
- **AND** the user is shown the per-file failure with instructions to clean up
- **AND** a subsequent re-run finds the README already has `archived: true` (skip the rewrite) and re-attempts the sidecar `unlink` (idempotent)
