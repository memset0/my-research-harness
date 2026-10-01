## MODIFIED Requirements

### Requirement: `memon experiment create` allocates next E ID

The CLI SHALL expose `memon experiment create <slug> [--title <text>]
[--hypotheses H0001,H0003] [--from-run <run-dir>] [--project-root <p>]`.
The Web `POST /api/experiments` (standalone and central) SHALL apply the
same creation rules and produce the same bundle bytes.

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
4. Allocate the id by atomically creating the directory
   `docs/experiments/E<NNNN>-<slug>/` (a non-recursive directory creation
   that fails when the directory already exists). Only after the directory
   has been created by this invocation SHALL it write `README.md`,
   `implementation.yaml`, `investigation.yaml` and `results.yaml` inside it.
   The README frontmatter SHALL be populated (`id`, `slug`, `title`,
   `hypotheses`, `tags` (`[]` unless the Web caller supplies tags), `runs`
   initially `[]` or seeded from `--from-run`, `created_at=now`,
   `updated_at=now`, plus `status: OPEN` and `archived: false` per
   `lifecycle-frontmatter-v4`). The README body SHALL contain exactly the
   canonical H2 headings in canonical order (Motivation, Design,
   Implementation, Investigation, Results, Findings, Limitations,
   Conclusion, Warnings), with the Implementation, Investigation and
   Results pointers and every other section empty. The three YAML files
   SHALL be the empty `schema_version: 1` documents, except that
   `--from-run` seeds Results with Variant `V0001`. If any file write
   fails, the created directory SHALL be removed so no half-created bundle
   is discoverable.
5. If `--from-run <run-dir>` is given, validate the run exists and add
   its project-relative path to the new exp's `runs[]` without writing
   the Run README. The run SHALL NOT already be declared by any
   Experiment (would surface a `BAD_STATE` error). The seeded Variant
   `V0001` SHALL be named `Imported <run name or id>`, carry the
   description ``Imported from an existing Run by `memon experiment create
   --from-run`; refine the Variant definition before launching another
   comparison.``, map the Run status to a Variant status (`FINISHED` →
   `COMPLETED`, `RUNNING` → `RUNNING`, `FAILED`/`INTERRUPTED` → `FAILED`,
   `UNKNOWN` → `INCONCLUSIVE`, otherwise `PLANNED`), list the Run in
   `attempts[]` when it is `FAILED`, `INTERRUPTED` or `UNKNOWN` and in
   `runs[]` otherwise, and record the Run's `entry` as provenance when
   present. These texts SHALL be identical on every surface.
6. Append a `[EXPERIMENT]` event with `op=create` to JOURNAL.

The command SHALL be retried up to 5 times if step 4's directory creation
hits `EEXIST` (race against concurrent allocations); after 5 failures,
exit with `BAD_STATE`.

#### Scenario: Successful create on a v5 project root
- **WHEN** the user runs `memon experiment create zero-snr-fix --title
  "Zero-SNR brightness study"` on a project root where no experiments
  exist
- **THEN** `docs/experiments/E0001-zero-snr-fix/README.md` exists with
  valid frontmatter and the canonical body sections, the three
  `schema_version: 1` YAML files exist beside it, and JOURNAL has an
  `op=create` event

#### Scenario: Allocation respects existing v5 folders
- **GIVEN** a project root containing the v5 folders
  `docs/experiments/E0001-foo/README.md`,
  `docs/experiments/E0003-baz/README.md`,
  `docs/experiments/E0007-bar/README.md`
- **WHEN** the user runs `memon experiment create new-thing`
- **THEN** the new experiment is written to
  `docs/experiments/E0008-new-thing/README.md`

#### Scenario: Allocation counts legacy v4 entries during migration
- **GIVEN** a project root mid-migration with both
  `docs/experiments/E0001-foo/README.md` (v5 folder) and
  `docs/experiments/E0002-legacy.md` (v4 file not yet moved)
- **WHEN** the user runs `memon experiment create third`
- **THEN** the new experiment is allocated as `E0003-third` (max+1 over
  the union of both forms), written to
  `docs/experiments/E0003-third/README.md`

#### Scenario: Concurrent allocation retries on an existing directory
- **GIVEN** another writer created `docs/experiments/E0004-other/` after
  this invocation computed `E0004` as the next id
- **WHEN** this invocation's directory creation for `E0004-<slug>` fails
  because the id is taken
- **THEN** it recomputes the next id and retries, never writing a file into
  a directory it did not create

#### Scenario: --from-run binds existing run
- **WHEN** the user runs `memon experiment create foo --from-run
  bar-260501-100000` and that Run lives at `logs/bar-260501-100000`
- **THEN** the new exp's `runs[]` contains `logs/bar-260501-100000`, and the
  Run README bytes and mtime are unchanged
- **AND** `results.yaml` contains Variant `V0001` with the CLI import
  description

#### Scenario: Slug prefix collision rejected
- **GIVEN** `E0001-foo` already exists (as a v5 folder)
- **WHEN** the user runs `memon experiment create foo-bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION` and
  no folder or file is written

#### Scenario: CLI and Web create identical bundles
- **GIVEN** two copies of the same project root and the same clock
- **WHEN** one copy runs `memon experiment create` and the other receives
  the equivalent `POST /api/experiments` (with and without `fromRun`)
- **THEN** the four bundle files are byte-identical between the copies

### Requirement: `memon experiment status set` writes status + appends [EXP_STATUS] atomically

`memon experiment status set <exp-id-or-slug> --project-root <path> --to <STATUS> --expected-mtime <ms>` with an Experiment identifier (`E<NNNN>-<slug>` or a slug resolvable per `resolveExperimentId`) SHALL:
1. Resolve the Experiment and read its bundle README at `docs/experiments/E<NNNN>-<slug>/README.md`
2. Verify the README's mtime matches `--expected-mtime`; if not, exit 9 with `CONFLICT` and emit the current content to stdout
3. Apply `<STATUS>` (a value from the `ExperimentStatus` enum: `OPEN` / `RESOLVED` / `ABANDONED`) to the frontmatter, preserving every other frontmatter field and the body
4. Atomically write the README (temp file + rename), bumping `updated_at` to the current time with offset
5. When the status actually changed, record the transition (`<FROM>` → `<TO>`) as a detail of this invocation's automatic activity receipt per `journal`; the legacy `docs/journal.md` file SHALL NOT be appended to or rewritten
6. If the on-disk README has `archived: true`, emit the soft warning per `archive-frontmatter`

When the requested status equals the current status, steps 3–5 SHALL be skipped: the README SHALL NOT be rewritten, the reported `mtime` SHALL be the current on-disk mtime, and the Web `PATCH /api/experiments/:id/status` SHALL behave the same way.

If `<STATUS>` is not in the `ExperimentStatus` enum, the command SHALL exit 2 with `BAD_REQUEST`. If the Experiment cannot be resolved, the command SHALL exit 4 with `NOT_FOUND`. A Run directory id (`<slug>-<YYMMDD>-<HHMMSS>`) SHALL instead be handled as the deprecated alias of `memon run status set` (with its deprecation banner); an identifier matching neither form SHALL exit 2 with `BAD_REQUEST`.

#### Scenario: Successful status set
- **GIVEN** an Experiment bundle `docs/experiments/E0001-zero-snr-fix/` whose README has `status: OPEN`
- **WHEN** the user runs `memon experiment status set E0001-zero-snr-fix --project-root <p> --to RESOLVED --expected-mtime <current>`
- **THEN** the bundle README's frontmatter has `status: RESOLVED` and a refreshed `updated_at`
- **AND** the invocation's activity receipt records the `OPEN` → `RESOLVED` transition for `E0001-zero-snr-fix`
- **AND** stdout is JSON containing `"ok":true`, the new `mtime`, `"prevStatus":"OPEN"` and `"nextStatus":"RESOLVED"`
- **AND** `docs/journal.md` is not modified

#### Scenario: Status unchanged → no JOURNAL event
- **WHEN** the requested status equals the current status
- **THEN** the README is not rewritten, the current mtime is returned, no status transition is recorded and `docs/journal.md` is not touched; stdout has `journalAppended: false`

#### Scenario: Out-of-enum value rejected
- **WHEN** the user runs `... --to CONCLUDED`
- **THEN** the command exits 2 with `BAD_REQUEST` naming the allowed values `OPEN`, `RESOLVED`, `ABANDONED`, and nothing is written

#### Scenario: Status set on archived exp emits warning
- **GIVEN** an Experiment README with `status: OPEN, archived: true`
- **WHEN** the user runs `memon experiment status set <id> --to ABANDONED --expected-mtime <current>`
- **THEN** stderr contains `warning: <id> is archived; modifying anyway`
- **AND** stdout JSON additionally contains `"warning":"archived"`
- **AND** the status transitions to ABANDONED

## ADDED Requirements

### Requirement: Experiment and Run writes have one implementation across surfaces

Experiment create, link, unlink, delete, status, archive, README write and
Warning writes, and Run status, archive, README write and rename SHALL each
be implemented once and shared by the CLI, central Web and standalone Web.
For the same inputs, on-disk state and clock, every surface SHALL produce the
same file bytes. Surfaces MAY differ only in how they resolve targets, which
optimistic-lock values they require, how they report errors (exit codes or
HTTP statuses), and how they record activity. Single-file document rewrites
SHALL replace the file atomically and keep its file mode. Experiment delete
SHALL first move the bundle to a hidden quarantine name and then remove it.
Link SHALL replace a legacy bare-id entry for the same Run, append the Run's
project-relative path only when absent, and leave every other `runs[]`
entry verbatim.

#### Scenario: Same sequence, same bytes
- **GIVEN** two copies of the same project root and a fixed clock
- **WHEN** the CLI and the Backend each run the same create, create
  `--from-run`, link, Experiment status set and Run status set sequence
- **THEN** every resulting Experiment and Run file is byte-identical between
  the two copies

#### Scenario: Link keeps unrelated duplicate entries
- **GIVEN** an Experiment whose `runs[]` already lists another Run twice
- **WHEN** a new Run is linked from any surface
- **THEN** the other Run's two entries remain and the new path is appended
