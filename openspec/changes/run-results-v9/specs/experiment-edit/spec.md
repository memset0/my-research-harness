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
   `implementation.yaml`, `investigation.yaml` and the description file
   `experiment.json` inside it. When another entry holds the same
   `E<NNNN>` number under a lexically smaller name, this invocation SHALL
   release its directory and retry.
   The README frontmatter SHALL be populated (`id`, `slug`, `title`,
   `hypotheses`, `tags` (`[]` unless the Web caller supplies tags), `runs`
   initially `[]` or seeded from `--from-run`, `created_at=now`,
   `updated_at=now`, plus `status: OPEN` and `archived: false` per
   `lifecycle-frontmatter-v4`). The README body SHALL contain exactly the
   canonical H2 headings in canonical order (Motivation, Design,
   Implementation, Investigation, Results, Findings, Limitations,
   Conclusion, Warnings), with the Implementation, Investigation and
   Results pointers and every other section empty. The two YAML files
   SHALL be the empty `schema_version: 1` documents; `experiment.json`
   SHALL hold `experiment_schema_version: 1` and empty `groups`, `columns`
   and `variants`, except that `--from-run` seeds Variant `V0001`. If any
   file write fails, the created directory SHALL be removed so no
   half-created bundle is discoverable.
5. If `--from-run <run-dir>` is given, validate the run exists and add
   its project-relative path to the new exp's `runs[]` without writing
   any file in the Run directory. The run SHALL NOT already be declared by
   any Experiment (would surface a `BAD_STATE` error). The seeded Variant
   `V0001` SHALL be named `Imported <run name or id>`, carry the
   description ``Imported from an existing Run by `memon experiment create
   --from-run`; refine the Variant definition before launching another
   comparison.``, list the Run path as its only `runs` entry, declare no
   status (its effective status is derived from the Run record, so an
   `INTERRUPTED` Run yields `RUNNING` and never `FAILED`), and record the
   Run's `entry` as provenance when present. These texts SHALL be
   identical on every surface.
6. Append a `[EXPERIMENT]` event with `op=create` to JOURNAL.

The command SHALL be retried up to 5 times if step 4's directory creation
hits `EEXIST` (race against concurrent allocations); after 5 failures,
exit with `BAD_STATE`.

#### Scenario: Successful create on a v5 project root
- **WHEN** the user runs `memon experiment create zero-snr-fix --title
  "Zero-SNR brightness study"` on a project root where no experiments
  exist
- **THEN** `docs/experiments/E0001-zero-snr-fix/README.md` exists with
  valid frontmatter and the canonical body sections, the two
  `schema_version: 1` YAML files and `experiment.json` with
  `experiment_schema_version: 1` exist beside it, and JOURNAL has an
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
- **GIVEN** another writer created `docs/experiments/E0004-aaa/` after
  this invocation computed `E0004` as the next id for slug `zzz`
- **WHEN** this invocation creates `E0004-zzz/` and then sees that the
  number `E0004` is also held by the lexically smaller `E0004-aaa`
- **THEN** it removes its empty `E0004-zzz/`, recomputes the next id and
  retries (as it also does when the directory creation itself fails with
  `EEXIST`), never writing a file into a directory it did not keep

#### Scenario: --from-run binds existing run
- **WHEN** the user runs `memon experiment create foo --from-run
  bar-260501-100000` and that Run lives at `logs/bar-260501-100000`
- **THEN** the new exp's `runs[]` contains `logs/bar-260501-100000`, and no
  file in the Run directory changes
- **AND** `experiment.json` contains Variant `V0001` with the CLI import
  description, `runs: ["logs/bar-260501-100000"]` and no declared status

#### Scenario: --from-run with an interrupted Run
- **GIVEN** `logs/bar-260501-100000` has `status: INTERRUPTED`
- **WHEN** the user runs `memon experiment create foo --from-run bar-260501-100000`
- **THEN** the summary shows `V0001` as `RUNNING`, never `FAILED`

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

### Requirement: `memon experiment delete` cascades unlinks

`memon experiment delete <id> [--force] [--project-root <p>]` SHALL:
1. Read the exp doc.
2. Release its members by removing the declaration itself; no Run
   README or Run result file is rewritten.
3. Delete the exp doc folder (the canonical bundle files `README.md`,
   `implementation.yaml`, `investigation.yaml`, `experiment.json` and the
   `schema-upgrades/` directory; other scratch content only with
   `--force`) and the Experiment's generated Results summary.
4. Append a `[EXPERIMENT]` event with `op=delete` and the deleted
   `runs[]` payload to JOURNAL.

Without `--force`, the command SHALL refuse when the experiment still
declares member runs, naming how many would be released (JSON mode cannot
prompt). With `--force`, the deletion proceeds.

#### Scenario: Delete cascades and prompts
- **GIVEN** an exp `E0001-foo` with three confirmed runs
- **WHEN** the user runs `memon experiment delete E0001-foo` (no
  --force)
- **THEN** the CLI refuses and names the 3 declared runs that `--force`
  would release; nothing is deleted and no Run README changes

#### Scenario: --force skips prompt
- **WHEN** the same command runs with `--force`
- **THEN** the experiment folder and `.memon/index/results/E0001-foo.json` are deleted, the three Runs are no longer
  declared by any Experiment, their README and result file bytes are unchanged, and the
  deletion is recorded with the released `runs[]` payload
