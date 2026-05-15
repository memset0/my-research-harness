## MODIFIED Requirements

### Requirement: `memon experiment create` allocates next E ID

The CLI SHALL expose `memon experiment create <slug> [--title <text>]
[--hypotheses H0001,H0003] [--from-run <run-dir>] [--project-root <p>]`.

The command SHALL:
1. Validate `<slug>` matches `^[a-z0-9][a-z0-9-]*[a-z0-9]$`.
2. Scan `docs/experiments/` to find the highest existing `NNNN`. The
   scan SHALL accept each entry that matches *either* the post-v5
   folder shape `E<NNNN>-<slug>` (`EXPERIMENT_DIR_REGEX`) *or* the
   legacy v4 file shape `E<NNNN>-<slug>.md` (`EXPERIMENT_FILENAME_REGEX`,
   retained for the v4→v5 migration window where both forms may
   coexist briefly). The next id SHALL be computed as `padId('E', max+1)`
   across the union of both forms. When the directory does not exist
   the next id SHALL be `'E0001'`.
3. Refuse if any existing exp doc's slug equals the new slug or is a
   prefix of (or has as prefix) the new slug.
4. Write `docs/experiments/E<NNNN>-<slug>/README.md` (post-v5: an
   `E<NNNN>-<slug>/` folder containing a `README.md`) with frontmatter
   populated (`id`, `slug`, `title`, `hypotheses`, `tags=[]`, `runs`
   initially `[]` or seeded from `--from-run`, `created_at=now`,
   `updated_at=now`, plus `status: OPEN` and `archived: false` per
   `lifecycle-frontmatter-v4`) and empty body sections (`Motivation`,
   `Method`, `Conclusion`, `Caveats`, `Warnings` with the v3 header
   row). The folder is also the experiment's sanctioned local scratch
   space; the create step creates only the folder + README, and
   nothing else inside.
5. If `--from-run <run-dir>` is given, validate the run exists, write
   `experiment: <new-id>` into the run's frontmatter, and add the run dir
   name to the new exp's `runs[]`. The run SHALL NOT already have a
   different `experiment:` value (would surface a `BAD_STATE` error).
6. Append a `[EXPERIMENT]` event with `op=create` to JOURNAL.

The command SHALL be retried up to 5 times if step 4's directory or
file creation hits `EEXIST` (race against concurrent allocations);
after 5 failures, exit with `BAD_STATE`.

#### Scenario: Successful create on a v5 project root
- **WHEN** the user runs `memon experiment create zero-snr-fix --title
  "Zero-SNR brightness study"` on a project root where no experiments
  exist
- **THEN** `docs/experiments/E0001-zero-snr-fix/README.md` exists with
  valid frontmatter, body sections present, and JOURNAL has an
  `op=create` event

#### Scenario: Allocation respects existing v5 folders
- **GIVEN** a project root containing the v5 folders
  `docs/experiments/E0001-foo/README.md`,
  `docs/experiments/E0003-baz/README.md`,
  `docs/experiments/E0007-bar/README.md`
- **WHEN** the user runs `memon experiment create new-thing`
- **THEN** the new experiment is written to
  `docs/experiments/E0008-new-thing/README.md` (NOT `E0001-`,
  `E0002-`, `E0004-`, or `E0008-` if a `.md` legacy file at any of
  those numbers were also present; see next scenario)

#### Scenario: Allocation counts legacy v4 entries during migration
- **GIVEN** a project root mid-migration with both
  `docs/experiments/E0001-foo/README.md` (v5 folder) and
  `docs/experiments/E0002-legacy.md` (v4 file not yet moved)
- **WHEN** the user runs `memon experiment create third`
- **THEN** the new experiment is allocated as `E0003-third` (max+1 over
  the union of both forms), written to
  `docs/experiments/E0003-third/README.md`

#### Scenario: --from-run binds existing run
- **WHEN** the user runs `memon experiment create foo --from-run
  bar-260501-100000`
- **THEN** the new exp's `runs[]` contains `bar-260501-100000`, and the
  run's `experiment:` field equals the new exp's id

#### Scenario: Slug prefix collision rejected
- **GIVEN** `E0001-foo` already exists (as a v5 folder)
- **WHEN** the user runs `memon experiment create foo-bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION` and
  no folder or file is written

## ADDED Requirements

### Requirement: `resolveExperimentId` accepts slug or canonical id under v5

The core library SHALL expose `resolveExperimentId(projectRoot, needle):
Promise<string | null>` that maps a user-supplied `<id-or-slug>`
argument to a canonical `E<NNNN>-<slug>` id by scanning
`docs/experiments/`.

The scan SHALL accept each entry under `docs/experiments/` that matches
*either* `EXPERIMENT_DIR_REGEX` (the v5 folder shape) *or*
`EXPERIMENT_FILENAME_REGEX` (the legacy v4 file shape, retained for
the migration window). For every matching entry the canonical id is
`E<NNNN>-<slug>`, with any `.md` suffix on the legacy form stripped.

Resolution rules:

- When `needle` matches `^E\d{4}-` (i.e. carries a numeric prefix), the
  function SHALL return `needle` only when an entry with that exact
  canonical id exists; otherwise `null`.
- When `needle` is a bare slug (no `E\d{4}-` prefix), the function
  SHALL return the canonical id of the unique entry whose slug equals
  `needle`. Zero matches or multiple matches return `null`.
- When `<projectRoot>/docs/experiments/` does not exist, the function
  SHALL return `null`.

The function SHALL NOT depend on the presence of `README.md` inside
the folder — a folder that matches `EXPERIMENT_DIR_REGEX` is sufficient
to be considered an existing experiment for ID/slug resolution
purposes. (`discoverExperiments` separately surfaces a `MISSING_README`
parse error in that case.)

#### Scenario: Full canonical id resolves to itself when the v5 folder exists
- **GIVEN** `docs/experiments/E0001-fsdp-coll/README.md`
- **WHEN** `resolveExperimentId(root, 'E0001-fsdp-coll')` is called
- **THEN** it returns `'E0001-fsdp-coll'`

#### Scenario: Full canonical id returns null when no matching entry exists
- **GIVEN** `docs/experiments/` contains only `E0002-bar/`
- **WHEN** `resolveExperimentId(root, 'E0099-missing')` is called
- **THEN** it returns `null`

#### Scenario: Unique slug resolves to canonical id under v5
- **GIVEN** `docs/experiments/E0002-attention/README.md`
- **WHEN** `resolveExperimentId(root, 'attention')` is called
- **THEN** it returns `'E0002-attention'`

#### Scenario: Ambiguous slug returns null
- **GIVEN** `docs/experiments/E0001-fsdp-coll/` and
  `docs/experiments/E0003-fsdp-bug/` both exist; no slug exactly equals
  `'fsdp'`
- **WHEN** `resolveExperimentId(root, 'fsdp')` is called
- **THEN** it returns `null`

#### Scenario: Slug resolution works during the v4→v5 migration window
- **GIVEN** a mixed state: `docs/experiments/E0001-foo/README.md` (v5)
  alongside `docs/experiments/E0002-legacy.md` (legacy v4 file)
- **WHEN** `resolveExperimentId(root, 'legacy')` is called
- **THEN** it returns `'E0002-legacy'`

#### Scenario: Missing docs/experiments/ returns null
- **GIVEN** `docs/experiments/` does not exist on disk
- **WHEN** `resolveExperimentId(root, 'anything')` is called
- **THEN** it returns `null`
